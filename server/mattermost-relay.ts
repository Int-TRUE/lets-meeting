import { timingSafeEqual } from 'node:crypto';
import type { TransactionAdapter } from '../src/data/previewService.js';
import type { DeliveryLog } from '../src/domain/models.js';

export interface RelayConfig {
  token: string;
  recipients: Set<string>;
}
export function relayConfig(env = process.env): RelayConfig | undefined {
  if (env.MATTERMOST_RELAY_ENABLED !== 'true') return;
  const token = env.MATTERMOST_RELAY_TOKEN ?? '';
  const recipients = new Set((env.MATTERMOST_RELAY_RECIPIENTS ?? '').split(',').filter(Boolean));
  if (!/^[a-f0-9]{64}$/.test(token) || !recipients.size)
    throw new Error('Invalid relay configuration');
  return { token, recipients };
}
export function queueForRelay(
  transaction: TransactionAdapter,
  config: RelayConfig,
): TransactionAdapter {
  return (actor, mutate, write) =>
    transaction(
      actor,
      (state) => {
        const existing = new Set(state.logs.map((log) => log.id));
        let sequence = Math.max(0, ...state.logs.map((log) => log.relay?.sequence ?? 0));
        const result = mutate(state);
        if (write)
          for (const log of state.logs) {
            if (
              existing.has(log.id) ||
              !log.payload ||
              !['created', 'changed', 'cancelled'].includes(log.event)
            )
              continue;
            if (!config.recipients.has(log.recipientId)) {
              log.result = 'failed';
              log.detail = '중계 시연 대상에 등록되지 않은 참가자입니다.';
              continue;
            }
            log.relay = { sequence: ++sequence };
            log.result = 'pending';
            log.detail = '맥 중계 프로그램의 발송을 기다리고 있습니다.';
          }
        return result;
      },
      write,
    );
}
const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v);
export async function handleRelayRequest(
  request: Request,
  getTransaction: () => Promise<TransactionAdapter>,
  config: RelayConfig | undefined,
  now = Date.now(),
) {
  if (!config) return json(503, { error: '중계 연결이 비활성화되어 있습니다.' });
  const supplied = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${config.token}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return json(401, { error: '중계 인증이 필요합니다.' });
  if (
    request.method !== 'POST' ||
    !request.headers.get('content-type')?.startsWith('application/json')
  )
    return json(405, { error: 'JSON POST가 필요합니다.' });
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) {
          await reader.cancel();
          return json(413, { error: '요청이 너무 큽니다.' });
        }
        chunks.push(value);
      }
    const input = JSON.parse(Buffer.concat(chunks).toString());
    if (!input || !uuid(input.claimId) || !['claim', 'ack'].includes(input.action))
      return json(400, { error: '잘못된 중계 요청입니다.' });
    if (
      input.action === 'ack' &&
      (!uuid(input.id) ||
        !['sent', 'failed', 'unknown'].includes(input.result) ||
        (input.result === 'sent' && !/^[a-z0-9]{26}$/.test(input.postId ?? '')))
    )
      return json(400, { error: '잘못된 발송 결과입니다.' });
    const transaction = await getTransaction();
    const result = await transaction(
      'taeheon',
      (state) => {
        if (input.action === 'ack') {
          const log = state.logs.find(
            (log) => log.id === input.id && log.relay?.claimId === input.claimId,
          );
          if (!log) return { conflict: true };
          // A repeated acknowledgement is harmless; a finished result cannot be overwritten.
          if (['sent', 'failed'].includes(log.result))
            return { ok: log.result === input.result && log.postId === input.postId };
          Object.assign(log, {
            result: input.result,
            detail:
              input.result === 'sent'
                ? '맥 중계기를 통해 매터모스트 DM 발송 완료'
                : input.result === 'unknown'
                  ? '전송 결과를 확인할 수 없습니다. 실제 DM을 확인해주세요. 자동 재전송하지 않습니다.'
                  : '맥 중계기에서 발송하지 못했습니다. 계정 연결과 매터모스트 상태를 확인해주세요.',
            ...(input.result === 'sent'
              ? { postId: input.postId, deliveredAt: new Date(now).toISOString() }
              : {}),
          });
          return { ok: true };
        }
        for (const log of state.logs)
          if (log.relay && log.result === 'sending' && (log.relay.expiresAt ?? 0) <= now) {
            log.result = 'unknown';
            log.detail =
              '중계 응답 시간이 만료되었습니다. 중복 방지를 위해 자동 재전송하지 않습니다.';
          }
        const active = state.logs.find((log) => log.relay && log.result === 'sending');
        if (active)
          return { jobs: active.relay?.claimId === input.claimId ? [structuredClone(active)] : [] };
        const next = state.logs
          .filter((log) => log.relay && log.result === 'pending')
          .sort((a, b) => a.relay!.sequence - b.relay!.sequence)[0];
        if (!next) return { jobs: [] };
        // Recheck the allowlist when the job is claimed, including after configuration changes.
        if (!config.recipients.has(next.recipientId)) {
          next.result = 'failed';
          next.detail = '중계 시연 대상에서 제외된 참가자입니다.';
          return { jobs: [] };
        }
        next.result = 'sending';
        next.attemptedAt = new Date(now).toISOString();
        next.detail = '맥 중계기에서 전송 중입니다.';
        next.relay!.claimId = input.claimId;
        next.relay!.expiresAt = now + 120_000;
        return { jobs: [structuredClone(next)] as DeliveryLog[] };
      },
      true,
    );
    return json('conflict' in result || ('ok' in result && !result.ok) ? 409 : 200, result);
  } catch {
    return json(503, { error: '중계 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.' });
  }
}
