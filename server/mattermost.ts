import type { DeliveryLog } from '../src/domain/models';
import type { TransactionAdapter } from '../src/data/previewService';

export interface MattermostConfig {
  baseUrl: string;
  token: string;
  botId: string;
  appUrl: string;
  users: Record<string, string>;
}
// Only server configuration supplies destinations. No request can supply a URL or token.
export function mattermostConfig(
  env: Record<string, string | undefined>,
): MattermostConfig | undefined {
  if (env.MATTERMOST_ENABLED !== 'true') return;
  const base = new URL(env.MATTERMOST_URL ?? '');
  const app = new URL(env.ROBOT_BUTLER_URL ?? '');
  for (const url of [base, app]) {
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
      )
    )
      throw new Error('Invalid Mattermost URL configuration');
  }
  const users: unknown = JSON.parse(env.MATTERMOST_USER_MAP ?? '{}');
  if (
    !users ||
    typeof users !== 'object' ||
    Array.isArray(users) ||
    Object.values(users).some((id) => typeof id !== 'string' || !/^[a-z0-9]{26}$/.test(id)) ||
    !env.MATTERMOST_BOT_TOKEN ||
    !/^[a-z0-9]{26}$/.test(env.MATTERMOST_BOT_ID ?? '')
  )
    throw new Error('Invalid Mattermost account configuration');
  return {
    baseUrl: base.href.replace(/\/$/, ''),
    appUrl: app.href.replace(/\/$/, ''),
    token: env.MATTERMOST_BOT_TOKEN,
    botId: env.MATTERMOST_BOT_ID!,
    users: users as Record<string, string>,
  };
}
const labels = {
  created: '회의 생성·초대',
  changed: '회의 변경',
  cancelled: '회의 취소',
  materials: '자료 변경',
  summary: '요약 완료',
};
const plain = (value: string) =>
  value
    .replace(/[\r\n]/g, ' ')
    .replace(/@/g, '＠')
    .replace(/[\\`*_{}\[\]()<>#!|~]/g, '\\$&');
const date = (value: string) =>
  new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
export function notificationMessage(log: DeliveryLog, appUrl: string) {
  const p = log.payload!;
  const schedule = (v: { start: string; end: string; room: string }) =>
    `${date(v.start)} ~ ${date(v.end)} (한국 시간) / ${plain(v.room)}`;
  if (p.removed)
    return `**[로봇집사] 회의 참가 제외**\n\n회의: ${plain(p.previous?.title ?? p.title)}\n이 회의의 참가 대상에서 제외되었습니다.`;
  return [
    `**[로봇집사] ${labels[log.event]}**`,
    `회의: ${plain(p.title)}`,
    ...(p.previous
      ? [`변경 전: ${plain(p.previous.title)} / ${schedule(p.previous)}`, `변경 후: ${schedule(p)}`]
      : [`일시·장소: ${schedule(p)}`]),
    ...(log.event === 'cancelled' ? ['회의가 취소되었습니다.'] : []),
    `[회의 상세 보기](${appUrl}/meetings/${encodeURIComponent(log.meetingId)})`,
  ].join('\n\n');
}
class DeliveryError extends Error {
  constructor(
    readonly uncertain: boolean,
    message: string,
  ) {
    super(message);
  }
}
export function createMattermostDelivery(
  transaction: TransactionAdapter,
  config: MattermostConfig,
  fetcher: typeof fetch = fetch,
) {
  let queue: Promise<unknown> = Promise.resolve();
  async function call(path: string, body: unknown, post = false) {
    let response: Response;
    try {
      response = await fetcher(`${config.baseUrl}/api/v4${path}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(4000),
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new DeliveryError(
        post,
        post
          ? '전송 응답을 확인하지 못했습니다. 중복 방지를 위해 자동 재전송하지 않습니다.'
          : '매터모스트 서버에 연결하지 못했습니다.',
      );
    }
    if (!response.ok)
      throw new DeliveryError(
        post && response.status >= 500,
        `매터모스트 요청 실패 (HTTP ${response.status}).`,
      );
    try {
      return (await response.json()) as { id: string; user_id?: string; channel_id?: string };
    } catch {
      throw new DeliveryError(post, '매터모스트 응답을 확인하지 못했습니다.');
    }
  }
  async function deliver(actor: string, id: string) {
    const log = await transaction(
      actor,
      (state) => {
        const log = state.logs.find((entry) => entry.id === id);
        if (!log || log.result !== 'pending') return;
        log.result = 'sending';
        log.attemptedAt = new Date().toISOString();
        log.detail = '매터모스트 전송 중입니다.';
        return structuredClone(log);
      },
      true,
    );
    if (!log) return;
    let result: DeliveryLog['result'] = 'failed',
      detail = '',
      postId: string | undefined;
    try {
      const recipient = config.users[log.recipientId];
      if (!recipient)
        throw new DeliveryError(false, '참가자의 매터모스트 계정이 연결되지 않았습니다.');
      const channel = await call('/channels/direct', [config.botId, recipient]);
      if (!/^[a-z0-9]{26}$/.test(channel.id))
        throw new DeliveryError(false, 'DM 채널을 확인하지 못했습니다.');
      const post = await call(
        '/posts',
        {
          channel_id: channel.id,
          message: notificationMessage(log, config.appUrl),
          props: { robot_butler_delivery_id: log.id },
        },
        true,
      );
      if (!post.id || post.user_id !== config.botId || post.channel_id !== channel.id)
        throw new DeliveryError(true, '발송 결과를 확인하지 못했습니다.');
      result = 'sent';
      postId = post.id;
      detail = '매터모스트 DM 발송 완료';
    } catch (error) {
      result = error instanceof DeliveryError && error.uncertain ? 'unknown' : 'failed';
      detail = error instanceof DeliveryError ? error.message : '알림 처리 중 오류가 발생했습니다.';
    }
    await transaction(
      actor,
      (state) => {
        const entry = state.logs.find((item) => item.id === id);
        if (entry)
          Object.assign(entry, {
            result,
            detail,
            postId,
            ...(result === 'sent' ? { deliveredAt: new Date().toISOString() } : {}),
          });
      },
      true,
    );
  }
  function enqueue(actor: string, ids: string[]) {
    const work = queue.then(async () => {
      await Promise.all(ids.map((id) => deliver(actor, id)));
    });
    // A delivery/status-storage failure must never turn a committed meeting into an API failure.
    queue = work.catch(() => {});
    return queue;
  }
  const wrapped: TransactionAdapter = async (actor, mutate, write) => {
    const ids: string[] = [];
    const value = await transaction(
      actor,
      (state) => {
        const existing = new Set(state.logs.map((log) => log.id));
        const value = mutate(state);
        if (write)
          for (const log of state.logs) {
            if (
              existing.has(log.id) ||
              !log.payload ||
              !['created', 'changed', 'cancelled'].includes(log.event)
            )
              continue;
            log.result = 'pending';
            log.detail = '발송 대기';
            ids.push(log.id);
          }
        return value;
      },
      write,
    );
    if (ids.length) await enqueue(actor, ids);
    return value;
  };
  return {
    transaction: wrapped,
    async recover(actor: string) {
      const ids = await transaction(
        actor,
        (state) => {
          for (const log of state.logs)
            if (log.result === 'sending') {
              log.result = 'unknown';
              log.detail =
                '서버가 종료되어 발송 결과를 확인할 수 없습니다. 자동 재전송하지 않습니다.';
            }
          return state.logs.filter((log) => log.result === 'pending').map((log) => log.id);
        },
        true,
      );
      await enqueue(actor, ids);
    },
  };
}
