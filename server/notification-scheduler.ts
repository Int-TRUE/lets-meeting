import type { PreviewDatabase } from '../src/domain/models.js';
import { directNotificationEvents } from './direct-notifications.js';

// Called after a processing pass. Past slots are handled by scheduleReminders,
// including its offline/stale-message rules; only future deadlines are armed.
export function nextNotificationAt(state: PreviewDatabase, now: number): number | undefined {
  if (
    state.logs.some(
      (log) => log.result === 'pending' && log.payload && directNotificationEvents.has(log.event),
    )
  )
    return now;
  let next = Infinity;
  const consider = (at: number, key: string) => {
    if (Number.isFinite(at) && at > now && !state.requests[key]) next = Math.min(next, at);
  };
  for (const meeting of state.meetings) {
    if (meeting.cancelled || meeting.completed) continue;
    const start = Date.parse(meeting.start),
      end = Date.parse(meeting.end);
    if (end <= now) continue;
    for (const minutes of meeting.reminderMinutes ?? [])
      consider(
        start - minutes * 60000,
        `reminder:before:${meeting.id}:${meeting.start}:${minutes}`,
      );
    consider(start, `reminder:start-check:${meeting.id}:${meeting.start}`);
    consider(
      Math.max(start, end - 5 * 60000),
      `reminder:end-reminder:${meeting.id}:${meeting.end}`,
    );
  }
  return Number.isFinite(next) ? next : undefined;
}

// One process owns the DB notification lock. Writes wake this scheduler only
// after commit. There is no periodic DB poll, including when no meetings exist.
export function createNotificationScheduler({
  process,
  now = Date.now,
  onError = () => {},
}: {
  process: () => Promise<number | undefined>;
  now?: () => number;
  onError?: () => void;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  let dirty = false;
  let stopped = false;
  let failed = false;
  let failures = 0;
  function arm(at: number | undefined) {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (stopped || at === undefined) return;
    // Node timers overflow at ~25 days. Intermediate rearming stays in memory.
    timer = setTimeout(
      () => {
        timer = undefined;
        if (now() < at) arm(at);
        else run();
      },
      Math.min(2_147_483_647, Math.max(0, at - now())),
    );
    timer.unref?.();
  }
  function run() {
    if (stopped) return;
    if (active) {
      dirty = true;
      return;
    }
    active = (async () => {
      dirty = false;
      try {
        const next = await process();
        failed = false;
        failures = 0;
        arm(dirty ? now() : next);
      } catch {
        failed = true;
        failures++;
        onError();
        // Retry only failed work, exponentially backing off to fifteen minutes.
        arm(now() + Math.min(900_000, 30_000 * 2 ** Math.min(failures - 1, 5)));
      } finally {
        active = undefined;
      }
    })();
  }
  return {
    wake() {
      if (stopped) return;
      if (active) dirty = true;
      else arm(now());
    },
    healthy: () => !failed && !stopped,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await active;
    },
  };
}
