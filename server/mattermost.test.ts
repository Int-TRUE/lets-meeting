import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDemoDatabase } from './database';
import { configureTransactionAdapter, localService } from '../src/data/previewService';
import { createMattermostDelivery, mattermostConfig, type MattermostConfig } from './mattermost';
let db: ReturnType<typeof openDemoDatabase>;
const botId = 'b'.repeat(26),
  recipient = 'r'.repeat(26),
  channelId = 'c'.repeat(26);
const config: MattermostConfig = {
  baseUrl: 'http://localhost:8065',
  token: 'secret',
  botId,
  appUrl: 'http://localhost:5173',
  users: { juhyung: recipient, me: 'm'.repeat(26), jin: 'j'.repeat(26) },
};
const input = {
  topicId: 'equipment-2026',
  title: 'DM 검증 @all',
  description: '내용',
  roomId: 'it-room',
  start: '2026-10-24T10:00:00+09:00',
  end: '2026-10-24T11:00:00+09:00',
  participantIds: ['me'],
  material: 'none' as const,
  attachments: [],
};
const posts: { message: string; channel_id: string }[] = [];
const success = vi.fn<typeof fetch>(async (url, init) => {
  const body = JSON.parse(String(init?.body));
  if (String(url).endsWith('/channels/direct')) return Response.json({ id: channelId });
  posts.push(body);
  return Response.json({ id: `post-${posts.length}`, user_id: botId, channel_id: body.channel_id });
});
beforeEach(async () => {
  db = openDemoDatabase(':memory:', 'reference');
  await db.seed();
  posts.length = 0;
  success.mockClear();
});
afterEach(() => db.close());
const connect = (fetcher = success) => {
  const delivery = createMattermostDelivery(db.transaction, config, fetcher);
  configureTransactionAdapter(delivery.transaction);
  return delivery;
};
test('commits creation/change/cancel and sends once per recipient, including removed participants', async () => {
  connect();
  const [id, duplicate] = await Promise.all([
    localService.createMeeting('juhyung', input, 'same'),
    localService.createMeeting('juhyung', input, 'same'),
  ]);
  expect(id).toBe(duplicate);
  expect(posts).toHaveLength(2);
  expect(db.load().logs.every((log) => log.result === 'sent' && log.postId)).toBe(true);
  expect(posts[0].message).toContain('＠all');
  expect(posts[0].message).not.toContain('@all');
  await localService.updateMeeting(
    'juhyung',
    id,
    {
      ...input,
      participantIds: [],
      title: '변경',
      start: '2026-10-24T11:00:00+09:00',
      end: '2026-10-24T12:00:00+09:00',
    },
    0,
  );
  expect(posts).toHaveLength(4);
  expect(posts[2].message).toContain('변경 전');
  expect(posts[2].message).toContain('변경 후');
  expect(posts[3].message).toContain('참가 제외');
  expect(posts[3].message).not.toContain('11:00');
  expect(posts[3].message).not.toContain('회의 상세 보기');
  await localService.cancelMeeting('juhyung', id, 1);
  expect(posts).toHaveLength(5);
  expect(posts[4].message).toContain('회의 취소');
  expect(await localService.meetingDelivery('juhyung', id)).toEqual([
    { result: 'sent', event: 'cancelled' },
  ]);
  const logs = await localService.adminLogs('ops');
  expect(logs.every((log) => !Object.hasOwn(log, 'payload'))).toBe(true);
});
test('rejects unauthorized writes and stale revisions without sending', async () => {
  connect();
  await expect(localService.createMeeting('me', input, 'no')).rejects.toThrow();
  expect(success).not.toHaveBeenCalled();
  const id = await localService.createMeeting('juhyung', input, 'ok');
  await expect(localService.cancelMeeting('me', id, 0)).rejects.toThrow();
  await expect(localService.updateMeeting('juhyung', id, input, 99)).rejects.toThrow();
  expect(posts).toHaveLength(2);
  await expect(localService.meetingDelivery('jin', id)).rejects.toThrow();
});
test('records missing accounts and HTTP rejection separately from successful meeting storage', async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response('secret upstream message', { status: 401 }),
  );
  const delivery = createMattermostDelivery(
    db.transaction,
    { ...config, users: { juhyung: recipient } },
    fetcher,
  );
  configureTransactionAdapter(delivery.transaction);
  const id = await localService.createMeeting('juhyung', input, 'failed');
  expect(db.load().meetings.some((meeting) => meeting.id === id)).toBe(true);
  const logs = db.load().logs;
  expect(logs.map((log) => log.result)).toEqual(['failed', 'failed']);
  expect(logs[0].detail).toContain('401');
  expect(logs[1].detail).toContain('계정');
  expect(JSON.stringify(logs)).not.toContain('secret');
  await localService.createMeeting('juhyung', input, 'failed');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test('marks uncertain POST outcome and does not retry on recovery', async () => {
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (String(url).endsWith('/channels/direct')) return Response.json({ id: channelId });
    throw new Error('token-secret');
  });
  const delivery = connect(fetcher);
  await localService.createMeeting('juhyung', input, 'unknown');
  expect(db.load().logs.every((log) => log.result === 'unknown')).toBe(true);
  const calls = fetcher.mock.calls.length;
  await delivery.recover('juhyung');
  expect(fetcher).toHaveBeenCalledTimes(calls);
});
test('startup recovers pending jobs but marks interrupted sends uncertain without replaying historical records', async () => {
  configureTransactionAdapter(db.transaction);
  await localService.createMeeting('juhyung', input, 'legacy');
  const delivery = connect();
  await delivery.recover('juhyung');
  expect(posts).toHaveLength(0);
  await db.transaction(
    'juhyung',
    (state) => {
      state.logs[0].result = 'pending';
      state.logs[1].result = 'sending';
    },
    true,
  );
  await delivery.recover('juhyung');
  expect(posts).toHaveLength(1);
  expect(db.load().logs[1].result).toBe('unknown');
});
test('requires explicit enablement and rejects unsafe configured URLs and invalid account IDs', () => {
  expect(mattermostConfig({})).toBeUndefined();
  expect(() =>
    mattermostConfig({ MATTERMOST_ENABLED: 'true', MATTERMOST_URL: 'http://external.test' }),
  ).toThrow();
  expect(() =>
    mattermostConfig({
      MATTERMOST_ENABLED: 'true',
      MATTERMOST_URL: 'https://a.test',
      ROBOT_BUTLER_URL: 'https://b.test',
      MATTERMOST_BOT_ID: botId,
      MATTERMOST_BOT_TOKEN: 'secret',
      MATTERMOST_USER_MAP: '{"x":"bad"}',
    }),
  ).toThrow();
});

test('Docker network permits only the fixed Mattermost service, never arbitrary HTTP or an internal app link', () => {
  const env = {
    MATTERMOST_ENABLED: 'true',
    MATTERMOST_URL: 'http://mattermost:8065',
    MATTERMOST_BOT_TOKEN: 'secret',
    MATTERMOST_BOT_ID: botId,
    MATTERMOST_USER_MAP: '{}',
    ROBOT_BUTLER_URL: 'https://robot-butler.vercel.app',
  };
  expect(() => mattermostConfig(env)).toThrow();
  expect(mattermostConfig({ ...env, MATTERMOST_DOCKER_NETWORK: 'true' })?.baseUrl).toBe(
    'http://mattermost:8065',
  );
  expect(() =>
    mattermostConfig({
      ...env,
      MATTERMOST_DOCKER_NETWORK: 'true',
      MATTERMOST_URL: 'http://elsewhere:8065',
    }),
  ).toThrow();
  expect(() =>
    mattermostConfig({
      ...env,
      MATTERMOST_DOCKER_NETWORK: 'true',
      ROBOT_BUTLER_URL: 'http://mattermost:8065',
    }),
  ).toThrow();
});
