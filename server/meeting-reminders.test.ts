import { expect, test } from 'vitest';
import type { PreviewDatabase, DeliveryLog, Meeting } from '../src/domain/models';
import { scheduleReminders, meetingInteraction, availableExtensions } from './meeting-reminders';
import {
  notificationProps,
  notificationMessage,
  signInteraction,
  verifyInteraction,
} from './mattermost';
const start = '2026-10-26T10:00:00+09:00',
  end = '2026-10-26T11:00:00+09:00';
const at = (s: string) => Date.parse(`2026-10-26T${s}:00+09:00`);
function fixture(): PreviewDatabase {
  const m: Meeting = {
    id: 'meeting',
    topicId: 'topic',
    title: '주간 회의',
    description: '',
    start,
    end,
    roomId: 'bd-3',
    room: '분당 · 3층 회의실',
    creatorId: 'sujin',
    participantIds: ['sujin', 'taeheon', 'wooseok'],
    files: [],
    material: 'none',
    cancelled: false,
    completed: false,
  };
  return {
    version: 1,
    meetings: [m],
    topics: [
      {
        id: 'topic',
        title: '',
        description: '',
        icon: 'people',
        tone: 'blue',
        roles: { sujin: 'Owner', taeheon: 'Master', wooseok: 'Attendee' },
      },
    ],
    logs: [],
    preferences: {},
    requests: {},
  };
}
function prompt(db: PreviewDatabase, event: DeliveryLog['event'], now: number) {
  scheduleReminders(db, now);
  const log = db.logs.find((l) => l.event === event)!;
  log.result = 'sent';
  return log;
}
test('clock events fire once per schedule, only inside their window and suppress stale pending events', () => {
  const db = fixture();
  scheduleReminders(db, at('09:59'));
  expect(db.logs).toHaveLength(0);
  scheduleReminders(db, at('10:00'));
  scheduleReminders(db, at('10:01'));
  expect(db.logs.map((l) => [l.event, l.recipientId])).toEqual([['start-check', 'sujin']]);
  scheduleReminders(db, at('10:55'));
  scheduleReminders(db, at('10:56'));
  expect(db.logs).toHaveLength(2);
  db.logs.forEach((l) => {
    l.result = 'pending';
  });
  db.meetings[0].cancelled = true;
  scheduleReminders(db, at('10:57'));
  expect(db.logs.every((l) => l.result === 'failed')).toBe(true);
  const offline = fixture();
  scheduleReminders(offline, at('10:10'));
  expect(offline.logs).toHaveLength(0);
  scheduleReminders(offline, at('11:01'));
  expect(offline.logs).toHaveLength(0);
});
test('only the creator selects current attendees, duplicate late sends and replies are idempotent', () => {
  const db = fixture(),
    log = prompt(db, 'start-check', at('10:00'));
  const input = {
    logId: log.id,
    actor: 'sujin',
    command: 'late' as const,
    selected: ['taeheon', 'wooseok'],
  };
  expect(() => meetingInteraction(db, { ...input, actor: 'taeheon' }, at('10:01'))).toThrow();
  expect(() => meetingInteraction(db, { ...input, selected: ['outsider'] }, at('10:01'))).toThrow();
  meetingInteraction(db, input, at('10:01'));
  meetingInteraction(db, input, at('10:02'));
  expect(db.logs.filter((l) => l.event === 'late')).toHaveLength(2);
  const late = db.logs.find((l) => l.event === 'late')!;
  late.result = 'sent';
  const reply = { logId: late.id, actor: late.recipientId, command: 'reply' as const, reply: 0 };
  meetingInteraction(db, reply, at('10:02'));
  meetingInteraction(db, { ...reply, reply: 2 }, at('10:03'));
  expect(db.logs.filter((l) => l.event === 'late-reply')).toHaveLength(1);
  expect(db.logs.at(-1)?.payload?.response).toContain('지금 바로');
  db.meetings[0].participantIds = ['sujin'];
  expect(() => meetingInteraction(db, reply, at('10:04'))).toThrow();
});
test('extension checks intervening reservations, original end, business hours and repeated clicks', () => {
  const db = fixture(),
    log = prompt(db, 'end-reminder', at('10:55'));
  expect(availableExtensions(db, db.meetings[0], at('10:55'))).toEqual([30, 60]);
  db.meetings.push({
    ...db.meetings[0],
    id: 'next',
    start: '2026-10-26T11:30:00+09:00',
    end: '2026-10-26T12:00:00+09:00',
  });
  expect(availableExtensions(db, db.meetings[0], at('10:55'))).toEqual([30]);
  const input = { logId: log.id, actor: 'sujin', command: 'extend' as const, minutes: 60 };
  expect(() => meetingInteraction(db, input, at('10:55'))).toThrow();
  meetingInteraction(db, { ...input, minutes: 30 }, at('10:55'));
  meetingInteraction(db, { ...input, minutes: 30 }, at('10:56'));
  expect(db.meetings[0].end).toBe('2026-10-26T11:30:00+09:00');
  expect(db.meetings[0].revision).toBe(1);
  expect(db.logs.filter((l) => l.event === 'changed')).toHaveLength(3);
  const late = fixture();
  late.meetings[0].end = '2026-10-26T18:00:00+09:00';
  expect(availableExtensions(late, late.meetings[0], at('17:55'))).toEqual([]);
});
test('text stays accessible, banners are limited, tickets cannot be altered or used after expiry', () => {
  const db = fixture(),
    log = prompt(db, 'start-check', at('10:00'));
  const config = {
    baseUrl: 'https://mm.example',
    appUrl: 'https://app.example',
    botId: 'b'.repeat(26),
    token: 'test',
    users: { sujin: 's'.repeat(26) },
    interaction: { url: 'http://relay:8066', secret: 'secret' },
  };
  expect(notificationMessage(log, config.appUrl)).toContain(
    '· **일시**: 2026.10.26(월) 10:00~11:00',
  );
  expect(JSON.stringify(notificationProps(log, config))).not.toContain('image_url');
  log.event = 'late';
  expect(JSON.stringify(notificationProps(log, config))).toContain('/late.jpg');
  const ticket = signInteraction({ expires: Date.now() + 10000, actor: 'sujin' }, 'secret');
  expect(verifyInteraction(ticket, 'secret').actor).toBe('sujin');
  expect(() => verifyInteraction(ticket + 'x', 'secret')).toThrow();
  expect(() => verifyInteraction(ticket, 'wrong')).toThrow();
  expect(() => verifyInteraction(signInteraction({ expires: 0 }, 'secret'), 'secret')).toThrow();
});

test('a queued start prompt expires when the relay backlog exceeds five minutes', () => {
  const db = fixture();
  scheduleReminders(db, at('10:00'));
  db.logs[0].result = 'pending';
  scheduleReminders(db, at('10:06'));
  expect(db.logs[0].result).toBe('failed');
  expect(db.logs).toHaveLength(1);
});

test('selected pre-meeting slots fire once for participants and invalidate cancelled or disabled work', () => {
  const db = fixture();
  db.meetings[0].reminderMinutes = [30, 10, 5, 3];
  scheduleReminders(db, at('09:29'));
  expect(db.logs).toHaveLength(0);
  for (const clock of ['09:30', '09:50', '09:55', '09:57']) {
    scheduleReminders(db, at(clock));
    scheduleReminders(db, at(clock));
  }
  expect(db.logs).toHaveLength(12);
  expect(db.logs.map((l) => l.payload?.reminderMinutes)).toEqual([
    30, 30, 30, 10, 10, 10, 5, 5, 5, 3, 3, 3,
  ]);
  db.logs.forEach((l) => (l.result = 'pending'));
  db.meetings[0].reminderMinutes = [];
  scheduleReminders(db, at('09:58'));
  expect(db.logs.every((l) => l.result === 'failed')).toBe(true);
  const offline = fixture();
  offline.meetings[0].reminderMinutes = [30, 10, 5, 3];
  scheduleReminders(offline, at('09:54'));
  expect(offline.logs).toHaveLength(0);
  scheduleReminders(offline, at('09:55'));
  expect(offline.logs).toHaveLength(3);
});

test('invitation format contains topic, host, participants, materials and a safe detail link', () => {
  const db = fixture();
  const log = prompt(db, 'start-check', at('10:00'));
  log.event = 'created';
  Object.assign(log.payload!, {
    topicTitle: '정기 점검',
    host: '최승호 차장',
    participants: ['정수진', '김태헌'],
    material: 'pending',
  });
  const message = notificationMessage(log, 'https://app.example');
  for (const text of [
    '**[회의 초대] 정기 점검 > 주간 회의**',
    '· **주최**: 최승호 차장',
    '· 참가자: 정수진, 김태헌',
    '· 자료: 등록예정',
    '[회의상세보기](https://app.example/meetings/meeting)',
  ])
    expect(message).toContain(text);
});

test('24-hour and 1-hour reminders each fire once at their own exact window', () => {
  const db = fixture();
  db.meetings[0].reminderMinutes = [1440, 60];
  const startMs = Date.parse(start);
  scheduleReminders(db, startMs - 1440 * 60000 - 1);
  expect(db.logs).toHaveLength(0);
  for (const minutes of [1440, 60]) {
    scheduleReminders(db, startMs - minutes * 60000);
    scheduleReminders(db, startMs - minutes * 60000 + 1000);
    expect(db.logs.filter((l) => l.payload?.reminderMinutes === minutes)).toHaveLength(3);
    expect(
      notificationMessage(
        db.logs.find((l) => l.payload?.reminderMinutes === minutes)!,
        'https://robot-butler.vercel.app',
      ),
    ).toContain(minutes === 1440 ? '하루 전' : '1시간 전');
  }
  const offline = fixture();
  offline.meetings[0].reminderMinutes = [1440, 60];
  scheduleReminders(offline, startMs - 1440 * 60000 + 60000);
  expect(offline.logs).toHaveLength(0);
});
