import type { DeliveryLog } from '../src/domain/models';
import type { TransactionAdapter } from '../src/data/previewService';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface MattermostConfig {
  baseUrl: string;
  token: string;
  botId: string;
  appUrl: string;
  users: Record<string, string>;
  interaction?: { url: string; secret: string };
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
        (url.protocol === 'http:' &&
          (['localhost', '127.0.0.1'].includes(url.hostname) ||
            (url === base &&
              env.MATTERMOST_DOCKER_NETWORK === 'true' &&
              url.hostname === 'mattermost' &&
              url.port === '8065')))
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
  'start-check': '회의가 시작되었어요. 지각자가 있나요?',
  late: '모두가 기다리고 있어요!',
  'late-reply': '참가자의 응답이 도착했어요',
  'end-reminder': '회의 종료 5분 전 · 회의실 연장이 필요하신가요?',
};
const plain = (value: string) =>
  value
    .replace(/[\r\n]/g, ' ')
    .replace(/@/g, '＠')
    .replace(/[\\`*_{}\[\]()<>#!|~]/g, '\\$&');
const date = (value: string) =>
  new Date(value).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
export function notificationMessage(log: DeliveryLog, appUrl: string) {
  const p = log.payload!;
  const schedule = (v: { start: string; end: string; room: string }) =>
    `${date(v.start)} ~ ${date(v.end)} (한국 시간) / ${plain(v.room)}`;
  if (p.removed)
    return `**[로봇집사] 회의 참가 제외**\n\n- 📋 회의: ${plain(p.previous?.title ?? p.title)}\n이 회의의 참가 대상에서 제외되었습니다.`;
  return [
    `**[로봇집사] ${labels[log.event]}**`,
    `- 📋 회의: ${plain(p.title)}`,
    ...(p.previous
      ? [
          `- 🔄 변경 전: ${plain(p.previous.title)} / ${schedule(p.previous)}`,
          `- 📅 변경 후: ${schedule(p)}`,
        ]
      : [`- 📅 일시·장소: ${schedule(p)}`]),
    ...(log.event === 'cancelled' ? ['회의가 취소되었습니다.'] : []),
    ...(log.event === 'late-reply'
      ? [`- 🙋 ${plain(p.responder ?? '참가자')}: ${plain(p.response ?? '')}`]
      : []),
    ...(log.event === 'end-reminder'
      ? [
          ...[30, 60]
            .filter((n) => !p.extensions?.includes(n))
            .map((n) => `- ⛔ ${n}분 연장 불가 · 다음 예약 또는 운영시간 제한`),
          '연장 버튼을 누르면 예약을 다시 확인하고 참가자에게 변경을 알립니다.',
          `[회의 변경 페이지](${appUrl}/meetings/${encodeURIComponent(log.meetingId)}/edit)`,
        ]
      : []),
    `[회의 상세 보기](${appUrl}/meetings/${encodeURIComponent(log.meetingId)})`,
  ].join('\n\n');
}
export const lateReplies = [
  '지금 바로 출발하겠습니다. 조금만 기다려주세요!',
  '시간이 걸릴 것 같으니 먼저 회의를 시작해주세요.',
  '죄송합니다. 불참해야할 것 같습니다.',
];
export function signInteraction(value: object, secret: string) {
  const data = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${data}.${createHmac('sha256', secret).update(data).digest('hex')}`;
}
export function verifyInteraction(
  value: unknown,
  secret: string,
): {
  logId: string;
  actor: string;
  userId: string;
  command: string;
  expires: number;
  minutes?: number;
  postId?: string;
  channelId?: string;
} {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid action');
  const [data, signature, extra] = value.split('.');
  const expected = createHmac('sha256', secret).update(data).digest('hex');
  if (
    extra ||
    !signature ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw new Error('Invalid signature');
  const result = JSON.parse(Buffer.from(data, 'base64url').toString());
  if (!Number.isFinite(result.expires) || result.expires <= Date.now())
    throw new Error('Expired action');
  return result;
}
export function notificationProps(log: DeliveryLog, config: MattermostConfig) {
  const message = notificationMessage(log, config.appUrl);
  const banner =
    !log.payload?.removed && ['created', 'changed', 'cancelled', 'late'].includes(log.event);
  const actions: object[] = [];
  const interaction = config.interaction;
  if (interaction && !log.payload?.removed) {
    const action = (id: string, name: string, command: string, extra = {}) => ({
      id,
      name,
      type: 'button',
      integration: {
        url: interaction.url + '/action',
        context: {
          ticket: signInteraction(
            {
              logId: log.id,
              actor: log.recipientId,
              userId: config.users[log.recipientId],
              command,
              expires: Date.parse(log.payload!.end),
              ...extra,
            },
            interaction.secret,
          ),
        },
      },
    });
    if (log.event === 'start-check')
      actions.push(action('attendees', '지각자 선택하기', 'options'));
    if (log.event === 'late')
      actions.push({
        ...action('reply', '응답을 선택해주세요', 'reply'),
        type: 'select',
        options: lateReplies.map((text, i) => ({ text, value: String(i) })),
      });
    if (log.event === 'end-reminder')
      for (const minutes of log.payload?.extensions ?? [])
        actions.push(action(`extend${minutes}`, `${minutes}분 연장하기`, 'extend', { minutes }));
  }
  return {
    robot_butler_delivery_id: log.id,
    ...(banner || actions.length
      ? {
          attachments: [
            ...(banner
              ? [
                  {
                    fallback: labels[log.event],
                    image_url: `${config.appUrl}/notification-banners/${log.event}.jpg`,
                  },
                ]
              : []),
            { fallback: message, text: message, ...(actions.length ? { actions } : {}) },
          ],
        }
      : {}),
  };
}
class DeliveryError extends Error {
  readonly uncertain: boolean;
  constructor(uncertain: boolean, message: string) {
    super(message);
    this.uncertain = uncertain;
  }
}
export function createMattermostSender(config: MattermostConfig, fetcher: typeof fetch = fetch) {
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
  return async (log: DeliveryLog) => {
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
          message: notificationProps(log, config).attachments
            ? ''
            : notificationMessage(log, config.appUrl),
          props: notificationProps(log, config),
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
    return {
      result,
      detail,
      postId,
      ...(result === 'sent' ? { deliveredAt: new Date().toISOString() } : {}),
    };
  };
}
export function createMattermostDelivery(
  transaction: TransactionAdapter,
  config: MattermostConfig,
  fetcher: typeof fetch = fetch,
) {
  let queue: Promise<unknown> = Promise.resolve();
  const send = createMattermostSender(config, fetcher);
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
    const outcome = await send(log);
    await transaction(
      actor,
      (state) => {
        const entry = state.logs.find((item) => item.id === id);
        if (entry) Object.assign(entry, outcome);
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
