import type { Meeting, MeetingStatus, Topic, Workspace } from './models';
export const TIME_ZONE = 'Asia/Seoul';
export function meetingStatus(meeting: Meeting, now: string): MeetingStatus {
  if (meeting.cancelled) return 'cancelled';
  if (meeting.completed) return 'completed';
  return Date.parse(meeting.end) <= Date.parse(now) ? 'summary-needed' : 'scheduled';
}
export function visibleWorkspace(data: Workspace): Workspace {
  const topics = data.topics.filter((t) => t.roles[data.user.id]);
  const meetings = data.meetings.filter((m) => {
    const role = topics.find((t) => t.id === m.topicId)?.roles[data.user.id];
    return (
      role === 'Owner' ||
      role === 'Master' ||
      (role === 'Attendee' && m.participantIds.includes(data.user.id))
    );
  });
  const permittedPeople = new Set([
    data.user.id,
    ...meetings.flatMap((m) => m.participantIds),
    ...topics.flatMap((topic) =>
      Object.keys(topic.roles).filter((id) => topic.roles[id] !== 'Attendee'),
    ),
  ]);
  return {
    ...data,
    topics,
    meetings,
    people: data.people.filter((p) => permittedPeople.has(p.id)),
  };
}
export function dateKey(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}
export function time(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
export function fullDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(value));
}
export function homeData(workspace: Workspace) {
  const data = visibleWorkspace(workspace);
  const sorted = [...data.meetings].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return {
    ...data,
    next: sorted.find((m) => meetingStatus(m, data.now) === 'scheduled'),
    today: sorted.filter((m) => dateKey(m.start) === dateKey(data.now) && !m.cancelled),
    summaries: sorted.filter(
      (m) => meetingStatus(m, data.now) === 'summary-needed' && m.creatorId === data.user.id,
    ),
  };
}
export function topicMeetings(topic: Topic, data: Workspace) {
  return visibleWorkspace(data).meetings.filter((m) => m.topicId === topic.id);
}
export function searchWorkspace(data: Workspace, query: string) {
  const visible = visibleWorkspace(data);
  const normalized = query.trim().toLocaleLowerCase('ko');
  if (!normalized) return { topics: [], meetings: [] };
  const includes = (values: string[]) =>
    values.join(' ').toLocaleLowerCase('ko').includes(normalized);
  return {
    topics: visible.topics.filter((t) =>
      includes([
        t.title,
        t.description,
        ...Object.keys(t.roles)
          .filter((id) => t.roles[id] !== 'Attendee')
          .map((id) => visible.people.find((p) => p.id === id)?.name ?? ''),
      ]),
    ),
    meetings: visible.meetings.filter((m) =>
      includes([
        m.title,
        m.description,
        m.start,
        fullDate(m.start),
        time(m.start),
        m.room,
        ...m.files,
        ...m.participantIds.map((id) => visible.people.find((p) => p.id === id)?.name ?? ''),
      ]),
    ),
  };
}
