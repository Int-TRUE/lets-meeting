import type { DeliveryLog, Meeting, PreviewDatabase } from '../src/domain/models.js';
import {
  recordEvent,
  requireMeeting,
  RuleError,
  validateSchedule,
} from '../src/domain/workflows.js';
import { people } from '../src/data/workspace.js';

import { lateReplies } from './mattermost.js';
const seoul = (time: number) => new Date(time + 9 * 3600000).toISOString().slice(0, 19) + '+09:00';
function add(
  db: PreviewDatabase,
  m: Meeting,
  event: DeliveryLog['event'],
  recipientId: string,
  now: number,
) {
  const log: DeliveryLog = {
    id: crypto.randomUUID(),
    meetingId: m.id,
    event,
    recipientId,
    time: new Date(now).toISOString(),
    channel: 'Mattermost',
    result: 'not-connected',
    detail: '발송 대기',
    payload: { title: m.title, start: m.start, end: m.end, room: m.room, removed: false },
  };
  db.logs.push(log);
  return log;
}
export function extensionEnd(db: PreviewDatabase, m: Meeting, minutes: number, now: number) {
  if (
    ![30, 60].includes(minutes) ||
    !m.roomId ||
    m.cancelled ||
    m.completed ||
    now < Date.parse(m.start) ||
    now >= Date.parse(m.end)
  )
    throw new RuleError('진행 중인 회의만 연장할 수 있어요.');
  const end = seoul(Date.parse(m.end) + minutes * 60000);
  // Validate only the additional interval: the original start is already in the past.
  validateSchedule(db, m.roomId, m.end, end, new Date(now).toISOString(), m.id);
  return end;
}
export function availableExtensions(db: PreviewDatabase, m: Meeting, now: number) {
  return [30, 60].filter((minutes) => {
    try {
      extensionEnd(db, m, minutes, now);
      return true;
    } catch {
      return false;
    }
  });
}
export function scheduleReminders(db: PreviewDatabase, now: number) {
  for (const m of db.meetings) {
    if (m.cancelled || m.completed || now < Date.parse(m.start) || now >= Date.parse(m.end))
      continue;
    for (const event of ['start-check', 'end-reminder'] as const) {
      const due = event === 'start-check' ? Date.parse(m.start) : Date.parse(m.end) - 5 * 60000;
      // Do not send stale start prompts after a long offline period.
      if (now < due || (event === 'start-check' && now >= due + 5 * 60000)) continue;
      const key = `reminder:${event}:${m.id}:${event === 'start-check' ? m.start : m.end}`;
      if (db.requests[key]) continue;
      db.requests[key] = add(db, m, event, m.creatorId, now).id;
    }
  }
  for (const log of db.logs) {
    if (!['start-check', 'end-reminder', 'late'].includes(log.event) || log.result !== 'pending')
      continue;
    const m = db.meetings.find((m) => m.id === log.meetingId);
    if (
      !m ||
      m.cancelled ||
      m.completed ||
      now >= Date.parse(m.end) ||
      (log.event === 'start-check' && now >= Date.parse(m.start) + 5 * 60000) ||
      m.start !== log.payload?.start ||
      (log.event === 'end-reminder' && m.end !== log.payload?.end) ||
      (log.event === 'late' && !m.participantIds.includes(log.recipientId))
    ) {
      log.result = 'failed';
      log.detail = '일정 변경·종료로 더 이상 유효하지 않은 알림입니다.';
    }
  }
}
export interface MeetingInteraction {
  logId: string;
  actor: string;
  command: 'options' | 'late' | 'reply' | 'extend';
  selected?: string[];
  reply?: number;
  minutes?: number;
}
export function meetingInteraction(db: PreviewDatabase, input: MeetingInteraction, now: number) {
  const log = db.logs.find((l) => l.id === input.logId && l.recipientId === input.actor);
  if (!log?.payload || !['sent', 'sending', 'unknown'].includes(log.result))
    throw new RuleError('이 알림을 사용할 수 없어요.');
  const { meeting: m } = requireMeeting(db, log.meetingId, input.actor);
  if (
    m.cancelled ||
    m.completed ||
    now < Date.parse(m.start) ||
    now >= Date.parse(m.end) ||
    m.start !== log.payload.start
  )
    throw new RuleError('회의가 변경되었거나 종료되어 이 알림을 사용할 수 없어요.');
  if (input.command === 'reply') {
    if (
      log.event !== 'late' ||
      !m.participantIds.includes(input.actor) ||
      !Number.isInteger(input.reply) ||
      !lateReplies[input.reply!]
    )
      throw new RuleError('응답을 다시 선택해주세요.');
    const key = `reply:${log.id}`;
    if (db.requests[key]) return { message: '이미 응답을 전달했어요.' };
    const reply = add(db, m, 'late-reply', m.creatorId, now);
    reply.payload!.response = lateReplies[input.reply!];
    reply.payload!.responder =
      (db.people ?? people).find((p) => p.id === input.actor)?.name ?? '참가자';
    db.requests[key] = reply.id;
    return { message: '회의 생성자에게 응답을 전달했어요.' };
  }
  if (m.creatorId !== input.actor) throw new RuleError('회의 생성자만 사용할 수 있어요.');
  if (input.command === 'options' || input.command === 'late') {
    if (log.event !== 'start-check') throw new RuleError('참석 확인 알림에서 선택해주세요.');
    const eligible = m.participantIds.filter((id) => id !== m.creatorId);
    if (input.command === 'options')
      return {
        participants: eligible.map((id) => ({
          id,
          name: (db.people ?? people).find((p) => p.id === id)?.name ?? id,
        })),
      };
    if (
      !Array.isArray(input.selected) ||
      !input.selected.length ||
      input.selected.some((id) => !eligible.includes(id))
    )
      throw new RuleError('현재 회의 참가자를 선택해주세요.');
    let count = 0;
    for (const id of new Set(input.selected)) {
      const key = `late:${m.id}:${m.start}:${id}`;
      if (db.requests[key]) continue;
      db.requests[key] = add(db, m, 'late', id, now).id;
      count++;
    }
    return {
      message: count
        ? `${count}명에게 지각 알림을 요청했어요.`
        : '선택한 참가자에게 이미 알림을 요청했어요.',
    };
  }
  if (input.command !== 'extend' || log.event !== 'end-reminder')
    throw new RuleError('올바른 연장 알림을 선택해주세요.');
  const key = `extend:${log.id}`;
  if (db.requests[key]) return { message: '이 알림에서 이미 회의를 연장했어요.' };
  if (m.end !== log.payload.end)
    throw new RuleError('종료 시각이 변경되었어요. 최신 회의를 확인해주세요.');
  const end = extensionEnd(db, m, input.minutes!, now);
  const previous = structuredClone(m);
  m.end = end;
  m.revision = (m.revision ?? 0) + 1;
  m.updatedAt = new Date(now).toISOString();
  recordEvent(db, m, 'changed', m.updatedAt, [], previous);
  db.requests[key] = end;
  return { message: `${input.minutes}분 연장했어요. 참가자들에게 변경 알림을 보냅니다.` };
}
