import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { openDemoDatabase } from './database';
import { createDirectNotifications } from './direct-notifications';
import { createNotificationScheduler, nextNotificationAt } from './notification-scheduler';
import { recordEvent } from '../src/domain/workflows';
import type { MattermostConfig } from './mattermost';
import type { TransactionAdapter } from '../src/data/previewService';

let db: ReturnType<typeof openDemoDatabase>;
let clock: number;
const config: MattermostConfig = {
  baseUrl: 'http://mattermost:8065',
  appUrl: 'https://test.ts.net',
  token: 'test',
  botId: 'b'.repeat(26),
  users: { taeheon: 't'.repeat(26), sujin: 's'.repeat(26) },
  interaction: { url: 'http://robot-butler:8066', secret: 'a'.repeat(64) },
};
let posts: Record<string, any>[];
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
function worker(transaction: TransactionAdapter = db.transaction) {
  return createDirectNotifications({
    transaction: db.transaction,
    notificationTransaction: transaction,
    config,
    fetcher,
    now: () => clock,
  });
}
beforeEach(async () => {
  db = openDemoDatabase(':memory:');
  await db.seed();
  posts = [];
  clock = Date.parse('2026-10-26T09:30:10+09:00');
  fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/system/ping')) return Response.json({ status: 'OK' });
    if (String(url).endsWith('/channels/direct')) return Response.json({ id: 'c'.repeat(26) });
    const body = JSON.parse(String(options?.body));
    posts.push(body);
    return Response.json({
      id: String(posts.length).padStart(26, 'p'),
      user_id: config.botId,
      channel_id: 'c'.repeat(26),
    });
  });
  await db.transaction(
    'taeheon',
    (state) => {
      state.topics.push({
        id: 'topic',
        title: 'Test',
        description: 'Test',
        icon: 'people',
        tone: 'blue',
        roles: { taeheon: 'Owner', sujin: 'Attendee' },
      });
      state.meetings.push({
        id: 'meeting',
        topicId: 'topic',
        title: 'Test',
        description: '',
        creatorId: 'taeheon',
        participantIds: ['taeheon', 'sujin'],
        start: '2026-10-26T10:00:00+09:00',
        end: '2026-10-26T11:00:00+09:00',
        roomId: 'bd-3',
        room: 'Test room',
        files: [],
        material: 'none',
        cancelled: false,
        completed: false,
        reminderMinutes: [30],
      });
    },
    true,
  );
});
afterEach(() => db.close());
test('offline Mattermost leaves invitations pending until connectivity returns', async () => {
  clock = Date.parse('2026-10-26T09:00:00+09:00');
  const w = worker();
  await w.transaction(
    'taeheon',
    (state) => recordEvent(state, state.meetings[0], 'created', new Date(clock).toISOString()),
    true,
  );
  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(w.tick()).rejects.toThrow('unavailable');
  expect(db.load().logs.every((log) => log.result === 'pending')).toBe(true);
  expect(posts).toHaveLength(0);
  await w.tick();
  expect(posts).toHaveLength(2);
});
test('timer sends due reminders once, then handles start, late reply and extension directly', async () => {
  const w = worker();
  await w.recover();
  await w.tick();
  await w.tick();
  expect(posts).toHaveLength(2);
  clock = Date.parse('2026-10-26T10:00:10+09:00');
  await w.tick();
  const start = db.load().logs.find((l) => l.event === 'start-check')!;
  expect(posts.at(-1)?.props.attachments[0].actions[0].integration.url).toBe(
    'http://robot-butler:8066/action',
  );
  const input = {
    logId: start.id,
    actor: 'taeheon',
    command: 'late' as const,
    selected: ['sujin'],
  };
  await w.interact(input);
  await w.interact(input);
  await w.tick();
  expect(db.load().logs.filter((l) => l.event === 'late')).toHaveLength(1);
  const late = db.load().logs.find((l) => l.event === 'late')!;
  await w.interact({ logId: late.id, actor: 'sujin', command: 'reply', reply: 0 });
  await w.tick();
  expect(db.load().logs.filter((l) => l.event === 'late-reply')).toHaveLength(1);
  clock = Date.parse('2026-10-26T10:55:10+09:00');
  await w.tick();
  const end = db.load().logs.find((l) => l.event === 'end-reminder')!;
  await w.interact({ logId: end.id, actor: 'taeheon', command: 'extend', minutes: 30 });
  await w.interact({ logId: end.id, actor: 'taeheon', command: 'extend', minutes: 30 });
  await w.tick();
  expect(db.load().meetings[0].end).toBe('2026-10-26T11:30:00+09:00');
  expect(db.load().logs.filter((l) => l.event === 'changed')).toHaveLength(2);
  expect(db.load().logs.every((l) => l.result === 'sent')).toBe(true);
});
test('new events are committed before delivery; repeated ticks and restart do not resend', async () => {
  clock = Date.parse('2026-10-26T09:00:00+09:00');
  const w = worker();
  await w.transaction(
    'taeheon',
    (state) => recordEvent(state, state.meetings[0], 'created', new Date(clock).toISOString()),
    true,
  );
  expect(posts).toHaveLength(0);
  expect(db.load().logs.every((l) => l.result === 'pending')).toBe(true);
  await Promise.all([w.tick(), w.tick()]);
  expect(posts).toHaveLength(2);
  const next = worker();
  await next.recover();
  await next.tick();
  expect(posts).toHaveLength(2);
});
test('a crash after send but before receipt persistence never causes an automatic resend', async () => {
  clock = Date.parse('2026-10-26T09:00:00+09:00');
  let writes = 0;
  const fail: TransactionAdapter = (actor, mutate, write) => {
    if (++writes === 2) throw new Error('DB disconnected');
    return db.transaction(actor, mutate, write);
  };
  const w = worker(fail);
  await w.transaction(
    'taeheon',
    (state) => {
      state.meetings[0].participantIds = ['taeheon'];
      recordEvent(state, state.meetings[0], 'created', new Date(clock).toISOString());
    },
    true,
  );
  await expect(w.tick()).rejects.toThrow('DB disconnected');
  expect(posts).toHaveLength(1);
  const next = worker();
  await next.recover();
  await next.tick();
  expect(posts).toHaveLength(1);
  expect(db.load().logs[0].result).toBe('unknown');
});
test('network-ambiguous sends are not retried and cancelled reminders are suppressed', async () => {
  fetcher.mockImplementation(async (url) => {
    if (String(url).endsWith('/system/ping')) return Response.json({ status: 'OK' });
    if (String(url).endsWith('/channels/direct')) return Response.json({ id: 'c'.repeat(26) });
    throw new Error('lost response');
  });
  const w = worker();
  await w.tick();
  const calls = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/posts')).length;
  await w.recover();
  await w.tick();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/posts'))).toHaveLength(calls);
  expect(db.load().logs.every((l) => l.result === 'unknown')).toBe(true);
  await db.transaction(
    'taeheon',
    (state) => {
      state.meetings[0].cancelled = true;
    },
    true,
  );
  clock = Date.parse('2026-10-26T10:00:10+09:00');
  await w.tick();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/posts'))).toHaveLength(calls);
});

test('event scheduler sends reservation once, resumes after restart, and stays idle after cancellation', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-10-26T09:00:00+09:00'));
  let transactions = 0;
  const tx: TransactionAdapter = (...args) => {
    transactions++;
    return db.transaction(...args);
  };
  const make = async () => {
    const w = createDirectNotifications({
      transaction: db.transaction,
      notificationTransaction: tx,
      config,
      fetcher,
    });
    await w.recover();
    const scheduler = createNotificationScheduler({
      process: async () => {
        const started = Date.now();
        await w.tick();
        return tx('taeheon', (state) => nextNotificationAt(state, started), false);
      },
    });
    scheduler.wake();
    return { w, scheduler };
  };
  let runtime = await make();
  try {
    await vi.advanceTimersByTimeAsync(1);
    const initialReads = transactions;
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(transactions).toBe(initialReads);
    expect(posts).toHaveLength(0);
    await runtime.scheduler.stop();
    await runtime.w.stop();
    runtime = await make();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(posts).toHaveLength(2);
    await runtime.w.transaction(
      'taeheon',
      (state) => {
        state.meetings[0].cancelled = true;
      },
      true,
    );
    runtime.scheduler.wake();
    await vi.advanceTimersByTimeAsync(1);
    const cancelledReads = transactions;
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(transactions).toBe(cancelledReads);
    expect(posts).toHaveLength(2);
  } finally {
    await runtime.scheduler.stop();
    await runtime.w.stop();
    vi.useRealTimers();
  }
});
