import type { TransactionAdapter } from '../src/data/previewService.js';
import type { PreviewDatabase } from '../src/domain/models.js';
import { createMattermostSender, type MattermostConfig } from './mattermost.js';
import {
  scheduleReminders,
  availableExtensions,
  meetingInteraction,
  type MeetingInteraction,
} from './meeting-reminders.js';

const events = new Set([
  'created',
  'changed',
  'cancelled',
  'reminder',
  'start-check',
  'late',
  'late-reply',
  'end-reminder',
]);
function queueNew(state: PreviewDatabase, existing: Set<string>) {
  for (const log of state.logs) {
    if (existing.has(log.id) || !log.payload || !events.has(log.event)) continue;
    log.result = 'pending';
    log.detail = '발송 대기';
  }
}

// Exactly one worker holds the database's session advisory lock in the server entry point.
// Claim is committed before network I/O; an ambiguous send is never automatically replayed.
export function createDirectNotifications({
  transaction,
  notificationTransaction,
  config,
  fetcher = fetch,
  now = Date.now,
}: {
  transaction: TransactionAdapter;
  notificationTransaction: TransactionAdapter;
  config: MattermostConfig;
  fetcher?: typeof fetch;
  now?: () => number;
}) {
  const send = createMattermostSender(config, fetcher);
  const wrapped: TransactionAdapter = (actor, mutate, write) =>
    transaction(
      actor,
      (state) => {
        const existing = new Set(state.logs.map((log) => log.id));
        const result = mutate(state);
        if (write) queueNew(state, existing);
        return result;
      },
      write,
    );
  let busy = false;
  let stopped = false;
  let active: Promise<void> = Promise.resolve();
  let lastSuccess = now();
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      // Keep safe pending work unclaimed while Mattermost is offline.
      const ping = await fetcher(`${config.baseUrl}/api/v4/system/ping`, {
        redirect: 'error',
        signal: AbortSignal.timeout(4000),
      });
      if (!ping.ok) throw new Error('Mattermost unavailable');
      // Bound each pass so the process can shut down promptly even with a large queue.
      for (let i = 0; i < 25 && !stopped; i++) {
        const job = await notificationTransaction(
          'taeheon',
          (state) => {
            const existing = new Set(state.logs.map((log) => log.id));
            scheduleReminders(state, now());
            queueNew(state, existing);
            const log = state.logs.find(
              (log) => log.result === 'pending' && log.payload && events.has(log.event),
            );
            if (!log) return;
            if (log.event === 'end-reminder') {
              const meeting = state.meetings.find((m) => m.id === log.meetingId)!;
              log.payload!.extensions = availableExtensions(state, meeting, now());
            }
            log.result = 'sending';
            log.attemptedAt = new Date(now()).toISOString();
            return structuredClone(log);
          },
          true,
        );
        lastSuccess = now();
        if (!job) break;
        const outcome = await send(job);
        await notificationTransaction(
          'taeheon',
          (state) => {
            const log = state.logs.find((log) => log.id === job.id);
            if (log?.result === 'sending') Object.assign(log, outcome);
          },
          true,
        );
      }
    } finally {
      busy = false;
    }
  }
  return {
    transaction: wrapped,
    async recover() {
      await notificationTransaction(
        'taeheon',
        (state) => {
          for (const log of state.logs)
            if (log.result === 'sending') {
              log.result = 'unknown';
              log.detail =
                '서버가 종료되어 전송 결과를 확인하지 못했습니다. 중복 방지를 위해 재전송하지 않습니다.';
            }
        },
        true,
      );
    },
    interact(input: MeetingInteraction) {
      return notificationTransaction(
        input.actor,
        (state) => {
          const existing = new Set(state.logs.map((log) => log.id));
          const result = meetingInteraction(state, input, now());
          queueNew(state, existing);
          return result;
        },
        input.command !== 'options',
      );
    },
    tick() {
      if (!busy) active = tick();
      return active;
    },
    healthy: () => now() - lastSuccess < 90_000,
    async stop() {
      stopped = true;
      await active;
    },
  };
}
