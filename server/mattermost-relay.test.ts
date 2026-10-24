import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { openDemoDatabase } from './database';
import { configureTransactionAdapter, localService } from '../src/data/previewService';
import { handleRelayRequest, queueForRelay, relayConfig } from './mattermost-relay';
const config = { token: 'a'.repeat(64), recipients: new Set(['sujin', 'taeheon']) };
let db: ReturnType<typeof openDemoDatabase>;
let topicId: string;
beforeEach(async () => {
  db = openDemoDatabase(':memory:');
  await db.seed();
  configureTransactionAdapter(queueForRelay(db.transaction, config));
  topicId = await localService.createTopic(
    'sujin',
    { title: '중계 검증', description: '검증', managerIds: ['taeheon', 'wooseok'] },
    randomUUID(),
  );
});
afterEach(() => db.close());
const rpc = (body: unknown, token = config.token, now = Date.now()) =>
  handleRelayRequest(
    new Request('https://demo.example/api/mattermost-relay', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    async () => db.transaction,
    config,
    now,
  );
async function create() {
  const start = new Date(Date.now() + 7 * 86400000);
  start.setUTCHours(1, 0, 0, 0);
  return localService.createMeeting(
    'sujin',
    {
      topicId,
      title: '중계 회의',
      description: '중계 검증용 회의',
      roomId: 'it-room',
      start: start.toISOString().slice(0, 10) + 'T10:00:00+09:00',
      end: start.toISOString().slice(0, 10) + 'T10:30:00+09:00',
      participantIds: ['taeheon', 'wooseok'],
      material: 'none',
      attachments: [],
    },
    'request-once',
  );
}
test('queues only new authorized recipients, keeps duplicate meeting request idempotent and requires relay authentication', async () => {
  const id = await create();
  expect(await create()).toBe(id);
  expect(db.load().logs.map((log) => log.result)).toEqual(['pending', 'pending', 'failed']);
  expect((await rpc({ action: 'claim', claimId: randomUUID() }, 'wrong')).status).toBe(401);
  expect(db.load().logs.filter((log) => log.result === 'sending')).toHaveLength(0);
  expect(relayConfig({ MATTERMOST_RELAY_ENABLED: 'false' })).toBeUndefined();
  expect(() => relayConfig({ MATTERMOST_RELAY_ENABLED: 'true' })).toThrow();
});
test('concurrent claims cannot send the same job; repeated claim and ack are idempotent and ordered', async () => {
  await create();
  const claimId = randomUUID(),
    other = randomUUID();
  const responses = await Promise.all([
    rpc({ action: 'claim', claimId }),
    rpc({ action: 'claim', claimId: other }),
  ]);
  const bodies = await Promise.all(responses.map((r) => r.json()));
  expect(bodies.map((b) => b.jobs.length).sort()).toEqual([0, 1]);
  const job = bodies.flatMap((b) => b.jobs)[0];
  const owner = job.relay.claimId;
  expect((await (await rpc({ action: 'claim', claimId: owner })).json()).jobs[0].id).toBe(job.id);
  expect(
    (
      await rpc({
        action: 'ack',
        claimId: other === owner ? claimId : other,
        id: job.id,
        result: 'sent',
        postId: 'p'.repeat(26),
      })
    ).status,
  ).toBe(409);
  const ack = { action: 'ack', claimId: owner, id: job.id, result: 'sent', postId: 'p'.repeat(26) };
  expect((await rpc(ack)).status).toBe(200);
  expect((await rpc(ack)).status).toBe(200);
  expect((await rpc({ ...ack, result: 'failed' })).status).toBe(409);
  const next = (await (await rpc({ action: 'claim', claimId: randomUUID() })).json()).jobs[0];
  expect(next.relay.sequence).toBeGreaterThan(job.relay.sequence);
});
test('expired sends become unknown, are not reclaimed, and late receipts can finish the same claim', async () => {
  await create();
  const claimId = randomUUID(),
    now = Date.now();
  const job = (await (await rpc({ action: 'claim', claimId }, config.token, now)).json()).jobs[0];
  const next = (
    await (await rpc({ action: 'claim', claimId: randomUUID() }, config.token, now + 121000)).json()
  ).jobs[0];
  expect(next.id).not.toBe(job.id);
  expect(db.load().logs.find((l) => l.id === job.id)?.result).toBe('unknown');
  expect(
    (await rpc({ action: 'ack', claimId, id: job.id, result: 'sent', postId: 'p'.repeat(26) }))
      .status,
  ).toBe(200);
});
test('old unconnected events stay untouched and newest event is selected despite reversed DB row order', async () => {
  configureTransactionAdapter(db.transaction);
  const id = await create();
  configureTransactionAdapter(queueForRelay(db.transaction, config));
  await localService.cancelMeeting('sujin', id, 0);
  expect(
    db
      .load()
      .logs.filter((l) => l.event === 'created')
      .every((l) => l.result === 'not-connected'),
  ).toBe(true);
  await db.transaction(
    'sujin',
    (state) => {
      state.logs.reverse();
    },
    true,
  );
  const logs = await localService.meetingDelivery('sujin', id);
  expect(logs.every((log) => log.event === 'cancelled')).toBe(true);
});

test('scheduler claims start/end prompts and concurrent extension actions commit once with participant notifications', async () => {
  const id = await create();
  const meeting = db.load().meetings.find((m) => m.id === id)!;
  // Creation events are already covered above; mark them delivered to isolate the clock.
  await db.transaction(
    'sujin',
    (state) => {
      for (const log of state.logs) log.result = 'sent';
    },
    true,
  );
  const due = Date.parse(meeting.end) - 5 * 60_000;
  const claimId = randomUUID();
  const job = (await (await rpc({ action: 'claim', claimId }, config.token, due)).json()).jobs[0];
  expect(job.event).toBe('end-reminder');
  expect(job.payload.extensions).toEqual([30, 60]);
  await rpc(
    { action: 'ack', claimId, id: job.id, result: 'sent', postId: 'p'.repeat(26) },
    config.token,
    due,
  );
  const action = {
    action: 'interact',
    logId: job.id,
    actor: 'sujin',
    command: 'extend',
    minutes: 30,
  };
  const responses = await Promise.all([
    rpc(action, config.token, due),
    rpc(action, config.token, due),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(db.load().meetings.find((m) => m.id === id)?.revision).toBe(1);
  const logs = db.load().logs.filter((l) => l.event === 'changed');
  expect(logs).toHaveLength(3);
  expect(logs.filter((l) => l.result === 'pending')).toHaveLength(2);
});
