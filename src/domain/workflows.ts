import { createId } from './id';
import { people } from '../data/workspace.js';
import type {
  DeliveryLog,
  Meeting,
  NotificationSettings,
  PreviewDatabase,
  Room,
  Summary,
  Topic,
} from './models.js';
export class RuleError extends Error {}
export const rooms: Room[] = [
  { id: 'md-9', name: '9층 대회의실', location: '명동', floor: '9층', capacity: 8, active: true },
  { id: 'md-3', name: '3층 회의실 A', location: '명동', floor: '3층', capacity: 6, active: true },
  { id: 'bd-3', name: '3층 회의실', location: '분당', floor: '3층', capacity: 10, active: true },
  {
    id: 'it-room',
    name: 'IT운영팀 회의실',
    location: '명동',
    floor: '11층',
    capacity: 12,
    active: true,
  },
  {
    id: 'floor-12',
    name: '12층 회의실',
    location: '명동',
    floor: '12층',
    capacity: 16,
    active: true,
  },
];
// Preview configuration, not a decision about the external reservation service.
export const previewPolicy = { slotMinutes: 30, startHour: 9, endHour: 18 };
export const reminderChoices = ['전일 17시', '1시간 전', '30분 전', '10분 전'];
export const defaultPreferences: NotificationSettings = {
  materials: true,
  summary: true,
  reminders: ['전일 17시', '30분 전'],
};
export function canManageTopic(topic: Topic, userId: string) {
  return topic.roles[userId] === 'Owner';
}
export function canCreateMeeting(topic: Topic, userId: string) {
  return ['Owner', 'Master'].includes(topic.roles[userId]);
}
export function canEditMeeting(topic: Topic, meeting: Meeting, userId: string) {
  return (
    topic.roles[userId] === 'Owner' ||
    (topic.roles[userId] === 'Master' && meeting.creatorId === userId)
  );
}
export function canReadMeeting(topic: Topic, meeting: Meeting, userId: string) {
  return (
    canCreateMeeting(topic, userId) ||
    (topic.roles[userId] === 'Attendee' && meeting.participantIds.includes(userId))
  );
}
export function roomLabel(id: string, catalog = rooms) {
  const room = catalog.find((r) => r.id === id);
  if (!room) throw new RuleError('회의실을 다시 선택해주세요.');
  return `${room.location} · ${room.name}`;
}
export function overlaps(start: string, end: string, otherStart: string, otherEnd: string) {
  return Date.parse(start) < Date.parse(otherEnd) && Date.parse(otherStart) < Date.parse(end);
}
export function roomConflicts(
  db: Pick<PreviewDatabase, 'meetings' | 'rooms'>,
  roomId: string,
  start: string,
  end: string,
  exceptId?: string,
) {
  return db.meetings.some(
    (m) =>
      m.id !== exceptId &&
      !m.cancelled &&
      (m.roomId === roomId || m.room === roomLabel(roomId, db.rooms)) &&
      overlaps(start, end, m.start, m.end),
  );
}
export function validateSchedule(
  db: PreviewDatabase,
  roomId: string,
  start: string,
  end: string,
  now: string,
  exceptId?: string,
) {
  if (!(db.rooms ?? rooms).some((r) => r.id === roomId && r.active))
    throw new RuleError('선택할 수 없는 회의실입니다.');
  const canonical = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/;
  if (!canonical.test(start) || !canonical.test(end))
    throw new RuleError('회의 시각은 Asia/Seoul 기준으로 선택해주세요.');
  const a = Date.parse(start),
    b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b || a < Date.parse(now))
    throw new RuleError('현재 시각 이후의 올바른 시작·종료 시간을 선택해주세요.');
  const date = (s: string) => s.slice(0, 10);
  const mins = (s: string) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
  if (
    date(start) !== date(end) ||
    mins(start) < previewPolicy.startHour * 60 ||
    mins(end) > previewPolicy.endHour * 60 ||
    mins(start) % previewPolicy.slotMinutes ||
    mins(end) % previewPolicy.slotMinutes
  )
    throw new RuleError('미리보기 예약 범위와 시간 단위에 맞춰 선택해주세요.');
  if (roomConflicts(db, roomId, start, end, exceptId))
    throw new RuleError(
      '선택한 시간이 다른 예약과 겹칩니다. 입력은 유지됩니다. 다른 시간을 선택해주세요.',
    );
}
export function requireRevision(meeting: Meeting, revision: number) {
  if ((meeting.revision ?? 0) !== revision)
    throw new RuleError(
      '다른 창에서 회의가 변경되었습니다. 최신 정보를 확인하고 다시 시도해주세요.',
    );
}
export function requireTopic(db: PreviewDatabase, id: string, userId: string) {
  const t = db.topics.find((t) => t.id === id);
  if (!t?.roles[userId]) throw new RuleError('이 정보에 접근할 수 없어요.');
  return t;
}
export function requireMeeting(db: PreviewDatabase, id: string, userId: string) {
  const m = db.meetings.find((m) => m.id === id);
  const t = m && db.topics.find((t) => t.id === m.topicId);
  if (!m || !t || !canReadMeeting(t, m, userId)) throw new RuleError('이 정보에 접근할 수 없어요.');
  return { meeting: m, topic: t };
}
export const meetingReminderChoices = [1440, 60, 30, 10, 5, 3];
export function meetingPayload(db: PreviewDatabase, meeting: Meeting) {
  const directory = db.people ?? people;
  const host = directory.find((p) => p.id === meeting.creatorId);
  return {
    title: meeting.title,
    start: meeting.start,
    end: meeting.end,
    room: meeting.room,
    removed: false,
    topicTitle: db.topics.find((t) => t.id === meeting.topicId)?.title ?? '',
    host: host
      ? [host.name, host.position].filter(Boolean).join(' ')
      : (meeting.hostAtTime ?? '주최자'),
    participants: meeting.participantIds.map(
      (id) => directory.find((p) => p.id === id)?.name ?? id,
    ),
    material: meeting.material,
  };
}
export function summaryTasks(summary?: Summary) {
  return (
    summary?.tasks ??
    (summary?.nextSteps ?? '')
      .split('\n')
      .filter((t) => t.trim())
      .map((text, i) => ({ id: `legacy-${i}`, text, done: false }))
  );
}
export function recordEvent(
  db: PreviewDatabase,
  meeting: Meeting,
  event: DeliveryLog['event'],
  time: string,
  previousParticipants: string[] = [],
  previousMeeting?: Meeting,
) {
  const batchId = createId();
  for (const id of new Set([...meeting.participantIds, ...previousParticipants])) {
    const preferences = db.preferences[id] ?? defaultPreferences;
    if (
      (event === 'materials' && !preferences.materials) ||
      (event === 'summary' && !preferences.summary)
    )
      continue;
    db.logs.push({
      id: createId(),
      meetingId: meeting.id,
      event,
      recipientId: id,
      time,
      channel: 'Mattermost',
      result: 'not-connected',
      batchId,
      payload: {
        ...meetingPayload(db, meeting),
        title: meeting.title,
        start: meeting.start,
        end: meeting.end,
        room: meeting.room,
        removed: !meeting.participantIds.includes(id),
        ...(previousMeeting
          ? {
              previous: {
                title: previousMeeting.title,
                start: previousMeeting.start,
                end: previousMeeting.end,
                room: previousMeeting.room,
              },
            }
          : {}),
      },
      detail: '외부 채널에 연결되지 않아 전송하지 않았습니다. 미리보기 이벤트 기록입니다.',
    });
  }
}
export function canEditSummary(meeting: Meeting, userId: string, now: string) {
  return (
    !meeting.cancelled &&
    Date.parse(meeting.end) <= Date.parse(now) &&
    (meeting.creatorId === userId || meeting.participantIds.includes(userId))
  );
}
export function saveSummary(
  db: PreviewDatabase,
  meetingId: string,
  userId: string,
  summary: Omit<Summary, 'savedAt'>,
  complete: boolean,
  now: string,
  revision: number,
) {
  const { meeting } = requireMeeting(db, meetingId, userId);
  requireRevision(meeting, revision);
  if (!canEditSummary(meeting, userId, now))
    throw new RuleError('종료된 회의의 참가자만 요약을 작성·수정할 수 있어요.');
  if (complete && (meeting.creatorId !== userId || meeting.completed))
    throw new RuleError('미완료 회의의 생성자만 회의를 완료할 수 있어요.');
  if (
    summary.tasks !== undefined &&
    (!Array.isArray(summary.tasks) ||
      summary.tasks.some(
        (t) =>
          !t ||
          typeof t.id !== 'string' ||
          !t.id ||
          typeof t.text !== 'string' ||
          !t.text.trim() ||
          typeof t.done !== 'boolean',
      ) ||
      new Set(summary.tasks.map((t) => t.id)).size !== summary.tasks.length)
  )
    throw new RuleError('후속 작업 내용을 확인해주세요.');
  if (
    complete &&
    ![
      summary.discussion,
      summary.decisions,
      summary.tasks ? summary.tasks.map((t) => t.text).join('\n') : summary.nextSteps,
    ].some((v) => v.trim()) &&
    !summary.tasks?.length
  )
    throw new RuleError(
      '빈 요약 완료 기준은 아직 정해지지 않았어요. 내용을 작성하거나 임시 저장해주세요.',
    );
  meeting.summary = {
    ...summary,
    ...(summary.tasks ? { nextSteps: summary.tasks.map((t) => t.text).join('\n') } : {}),
    savedAt: now,
  };
  meeting.revision = revision + 1;
  if (complete) {
    meeting.completed = true;
    recordEvent(db, meeting, 'summary', now);
  }
  return meeting.id;
}
