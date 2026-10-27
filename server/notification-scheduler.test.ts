import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createNotificationScheduler, nextNotificationAt } from './notification-scheduler';
import { openDemoDatabase } from './database';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T00:00:00Z'));
});
afterEach(() => vi.useRealTimers());

test('idle scheduler does no work for a day, including health checks', async () => {
  const process = vi.fn(async () => undefined);
  const scheduler = createNotificationScheduler({ process });
  scheduler.wake();
  await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync(86_400_000);
  expect(scheduler.healthy()).toBe(true);
  expect(process).toHaveBeenCalledTimes(1);
  await scheduler.stop();
});

test('executes at deadline and replaces a cancelled reservation after a write', async () => {
  let deadline: number | undefined = Date.now() + 60_000;
  const process = vi.fn(async () => deadline);
  const scheduler = createNotificationScheduler({ process });
  scheduler.wake();
  await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync(59_998);
  expect(process).toHaveBeenCalledTimes(1);
  deadline = undefined;
  await vi.advanceTimersByTimeAsync(1);
  expect(process).toHaveBeenCalledTimes(2);
  deadline = Date.now() + 60_000;
  scheduler.wake();
  await vi.advanceTimersByTimeAsync(1);
  deadline = undefined;
  scheduler.wake();
  await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(process).toHaveBeenCalledTimes(4);
  await scheduler.stop();
});

test('writes during a pass coalesce into one follow-up without concurrent processing', async () => {
  let finish!: (value: undefined) => void;
  const process = vi
    .fn<() => Promise<number | undefined>>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const scheduler = createNotificationScheduler({ process });
  scheduler.wake();
  await vi.advanceTimersByTimeAsync(1);
  scheduler.wake();
  scheduler.wake();
  scheduler.wake();
  expect(process).toHaveBeenCalledTimes(1);
  finish(undefined);
  await vi.advanceTimersByTimeAsync(1);
  expect(process).toHaveBeenCalledTimes(2);
  await scheduler.stop();
});

test('failures retry after 30 seconds then 60 seconds and recover', async () => {
  const process = vi
    .fn<() => Promise<number | undefined>>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined);
  const scheduler = createNotificationScheduler({ process });
  scheduler.wake();
  await vi.advanceTimersByTimeAsync(1);
  expect(scheduler.healthy()).toBe(false);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(process).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(process).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(process).toHaveBeenCalledTimes(3);
  expect(scheduler.healthy()).toBe(true);
  await scheduler.stop();
  scheduler.wake();
  await vi.advanceTimersByTimeAsync(86_400_000);
  expect(process).toHaveBeenCalledTimes(3);
});

test('long timers rearm in memory without processing', async () => {
  const deadline = Date.now() + 3_000_000_000;
  const process = vi.fn(async () => deadline);
  const scheduler = createNotificationScheduler({ process });
  scheduler.wake();
  await vi.advanceTimersByTimeAsync(2_147_483_649);
  expect(process).toHaveBeenCalledTimes(1);
  await scheduler.stop();
});

test('planner respects changed dates, completion and processed reminder slots', async () => {
  const db = openDemoDatabase(':memory:');
  await db.seed();
  try {
    await db.transaction(
      'taeheon',
      (state) => {
        state.logs = [];
        state.requests = {};
        state.meetings = [
          {
            id: 'm',
            topicId: 't',
            title: 'Test',
            description: '',
            creatorId: 'taeheon',
            participantIds: ['taeheon'],
            start: '2026-10-26T01:00:00Z',
            end: '2026-10-26T02:00:00Z',
            roomId: 'r',
            room: 'Room',
            files: [],
            material: 'none',
            cancelled: false,
            completed: false,
            reminderMinutes: [30],
          },
        ];
        expect(nextNotificationAt(state, Date.now())).toBe(Date.parse('2026-10-26T00:30:00Z'));
        state.requests['reminder:before:m:2026-10-26T01:00:00Z:30'] = 'processed';
        expect(nextNotificationAt(state, Date.now())).toBe(Date.parse('2026-10-26T01:00:00Z'));
        state.meetings[0].cancelled = true;
        expect(nextNotificationAt(state, Date.now())).toBeUndefined();
        state.meetings[0].cancelled = false;
        state.meetings[0].completed = true;
        expect(nextNotificationAt(state, Date.now())).toBeUndefined();
      },
      false,
    );
  } finally {
    db.close();
  }
});
