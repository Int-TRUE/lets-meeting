import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildDataset, DATASET_PREFIX, SUPPRESSION_VALUE } from './judging-dataset.mjs';

const people = [
  { id: 'taeheon', name: '이전담당', position: '담당', isTestAccount: true },
  { id: 'sujin', name: '새담당', position: '담당', isTestAccount: true },
  { id: 'wooseok', name: '참가하나', isTestAccount: true },
  { id: 'jooyoung', name: '참가둘', isTestAccount: true },
];
const rooms = [
  { id: 'bd-3', name: '보존할 회의실', location: '분당', floor: '3층', capacity: 8, active: true },
  { id: 'small', name: '작은 회의실', location: '명동', floor: '2층', capacity: 2, active: true },
  {
    id: 'inactive',
    name: '비활성 회의실',
    location: '명동',
    floor: '1층',
    capacity: 20,
    active: false,
  },
];
const make = (overrides = {}) =>
  buildDataset({ baseDate: '2026-10-28', people, rooms, ...overrides });
const entityId = (key) => DATASET_PREFIX + key;

test('builds one coherent handover story with five topics, thirteen meetings and an empty topic', () => {
  const data = make();
  assert.equal(data.topics.length, 5);
  assert.equal(data.meetings.length, 13);
  const main = data.topics.find((topic) => topic.id === entityId('equipment'));
  assert.deepEqual(main.roles, {
    taeheon: 'Owner',
    sujin: 'Master',
    wooseok: 'Attendee',
    jooyoung: 'Attendee',
  });
  assert.match(main.description, /이전담당.*새담당/);
  const meetings = data.meetings.filter((meeting) => meeting.topicId === main.id);
  assert.equal(meetings.length, 5);
  assert.equal(meetings.filter((meeting) => meeting.completed).length, 3);
  assert(
    meetings
      .filter((meeting) => meeting.completed)
      .every((meeting) => meeting.participantIds.includes('sujin')),
  );
  for (const key of ['equipment-summary-needed', 'equipment-upcoming']) {
    assert.equal(meetings.find((meeting) => meeting.id === entityId(key)).creatorId, 'sujin');
  }
  assert.equal(
    data.meetings.filter((meeting) => meeting.topicId === entityId('new-project')).length,
    0,
  );
  assert.equal(
    meetings.find((meeting) => meeting.id === entityId('equipment-survey')).summary.decisions,
    '노후 장비부터 우선 교체합니다.',
  );
  assert.equal(
    meetings.find((meeting) => meeting.id === entityId('equipment-pilot')).summary.decisions,
    '업무 중단을 피하도록 부서별로 나누어 진행합니다.',
  );
  assert.equal(
    meetings.find((meeting) => meeting.id === entityId('equipment-upcoming')).title,
    '교체 일정 확정',
  );
  const pendingSummary = meetings.find(
    (meeting) => meeting.id === entityId('equipment-summary-needed'),
  );
  assert.equal(pendingSummary.completed, false);
  assert.equal(pendingSummary.summary.discussion, '부서별 준비 항목과 교체 순서를 점검했습니다.');
  assert.equal(pendingSummary.summary.decisions, '1차 교체는 정보개발팀부터 진행한다.');
  assert.deepEqual(
    pendingSummary.summary.tasks.map(({ text, done }) => [text, done]),
    [
      ['1차 교체 대상 목록 확인', true],
      ['정보개발팀 사전 안내', false],
      ['교체 일정 등록', false],
    ],
  );
  assert(data.meetings.some((meeting) => meeting.cancelled));
  assert(data.meetings.some((meeting) => !meeting.completed && meeting.summary));
  assert(
    data.meetings.some(
      (meeting) => !meeting.completed && !meeting.cancelled && meeting.end < '2026-10-28',
    ),
  );
  assert.deepEqual(
    new Set(data.meetings.map((meeting) => meeting.material)),
    new Set(['uploaded', 'none', 'pending']),
  );
});

test('roles and participation support the protagonist and preserve an excluded attendee example', () => {
  const data = make();
  for (const topic of data.topics) {
    assert.equal(Object.values(topic.roles).filter((role) => role === 'Owner').length, 1);
    assert(Object.keys(topic.roles).every((id) => people.some((person) => person.id === id)));
    assert(
      Object.values(topic.roles).every((role) => ['Owner', 'Master', 'Attendee'].includes(role)),
    );
  }
  for (const meeting of data.meetings) {
    const topic = data.topics.find((candidate) => candidate.id === meeting.topicId);
    assert(['Owner', 'Master'].includes(topic.roles[meeting.creatorId]));
    assert(meeting.participantIds.includes(meeting.creatorId));
    assert.equal(new Set(meeting.participantIds).size, meeting.participantIds.length);
    assert(meeting.participantIds.every((id) => topic.roles[id]));
  }
  const excluded = data.meetings.find((meeting) => meeting.id === entityId('equipment-pilot'));
  assert(!excluded.participantIds.includes('jooyoung'));
  assert(excluded.participantIds.includes('sujin'));
  assert.deepEqual(
    Object.keys(data.topics.find((topic) => topic.id === entityId('restricted')).roles),
    ['taeheon', 'sujin'],
  );
});

test('four real UTF-8 attachments match material states, byte sizes and summary checklists', () => {
  const data = make();
  assert.equal(data.attachments.length, 4);
  for (const attachment of data.attachments) {
    const meeting = data.meetings.find((candidate) => candidate.id === attachment.meetingId);
    assert(Buffer.isBuffer(attachment.bytes));
    assert(attachment.bytes.length > 0);
    assert.equal(attachment.data.size, attachment.bytes.length);
    assert.deepEqual(Buffer.from(attachment.bytes.toString('utf8'), 'utf8'), attachment.bytes);
    assert(['text/plain', 'text/csv'].includes(attachment.data.type));
    assert(attachment.bytes.toString('utf8').trim().length > 0);
    assert.equal(attachment.data.authorId, meeting.creatorId);
  }
  for (const meeting of data.meetings) {
    const files = data.attachments.filter((attachment) => attachment.meetingId === meeting.id);
    assert.deepEqual(
      meeting.files,
      files.map((file) => file.data.name),
    );
    assert.equal(meeting.material === 'uploaded', files.length > 0);
    if (meeting.summary) {
      assert.equal(
        meeting.summary.nextSteps,
        meeting.summary.tasks.map((task) => task.text).join('\n'),
      );
      assert(
        meeting.summary.tasks.every((task) => task.text.trim() && typeof task.done === 'boolean'),
      );
      assert.equal(
        new Set(meeting.summary.tasks.map((task) => task.id)).size,
        meeting.summary.tasks.length,
      );
    }
  }
});

test('adds three exact Bundang rooms, uses two of them and preserves every input object', () => {
  const input = {
    baseDate: '2026-10-28',
    people: structuredClone(people),
    rooms: structuredClone(rooms),
  };
  const before = structuredClone(input);
  for (const person of input.people) Object.freeze(person);
  for (const room of input.rooms) Object.freeze(room);
  Object.freeze(input.people);
  Object.freeze(input.rooms);
  const data = buildDataset(input);
  assert.deepEqual(input, before);
  assert.deepEqual(
    data.addedRooms.map(({ id, location, capacity }) => ({ id, location, capacity })),
    [
      { id: 'final-judging-room-bd-4a', location: '분당', capacity: 8 },
      { id: 'final-judging-room-bd-4b', location: '분당', capacity: 12 },
      { id: 'final-judging-room-bd-5l', location: '분당', capacity: 20 },
    ],
  );
  assert.equal(
    data.meetings.find((meeting) => meeting.id === entityId('cms-upcoming')).roomId,
    'final-judging-room-bd-4a',
  );
  assert.equal(
    data.meetings.find((meeting) => meeting.id === entityId('operations-upcoming')).roomId,
    'final-judging-room-bd-4b',
  );
  const reused = make({ rooms: [...rooms, ...data.addedRooms] });
  assert.deepEqual(reused.addedRooms, []);
  assert.deepEqual(reused.meetings, data.meetings);
  assert.throws(
    () => make({ rooms: [...rooms, { ...data.addedRooms[0], name: '다른 회의실' }] }),
    /Existing judging room differs/,
  );
  assert.throws(
    () => make({ rooms: [...rooms, { ...data.addedRooms[0], capacity: 10 }] }),
    /Existing judging room differs/,
  );
  assert.throws(
    () => make({ rooms: [...rooms, { ...data.addedRooms[0], photoUrl: 'existing-photo' }] }),
    /Existing judging room differs/,
  );
});

test('all meetings fit active rooms and business hours without overlapping active reservations', () => {
  const data = make();
  const catalog = [...rooms, ...data.addedRooms];
  for (const meeting of data.meetings) {
    const room = catalog.find((candidate) => candidate.id === meeting.roomId);
    assert(room.active && room.capacity >= meeting.participantIds.length);
    assert.equal(meeting.room, `${room.location} · ${room.name}`);
    assert.equal(meeting.start.slice(0, 10), meeting.end.slice(0, 10));
    assert(Number(meeting.start.slice(11, 13)) >= 9 && Number(meeting.end.slice(11, 13)) <= 18);
    assert(Date.parse(meeting.start) < Date.parse(meeting.end));
    assert(![0, 6].includes(new Date(Date.parse(meeting.start) + 9 * 3_600_000).getUTCDay()));
    for (const other of data.meetings) {
      if (
        meeting.id === other.id ||
        meeting.cancelled ||
        other.cancelled ||
        meeting.roomId !== other.roomId
      )
        continue;
      assert(
        !(
          Date.parse(meeting.start) < Date.parse(other.end) &&
          Date.parse(other.start) < Date.parse(meeting.end)
        ),
        `${meeting.id} overlaps ${other.id}`,
      );
    }
  }
  const smallExisting = make({ rooms: [{ ...rooms[0], capacity: 1 }] });
  assert(smallExisting.meetings.every((meeting) => meeting.roomId !== 'bd-3'));
});

test('silences every future scheduled event with explicit suppression, never fake sent receipts', () => {
  const data = make();
  assert.deepEqual(data.logs, []);
  assert.equal(Object.keys(data.requests).length, 15);
  assert(Object.values(data.requests).every((value) => value === SUPPRESSION_VALUE));
  assert.equal(SUPPRESSION_VALUE, 'suppressed:judging-fixture');
  const future = data.meetings.filter(
    (meeting) => meeting.start > '2026-10-28T23:59:59+09:00' && !meeting.cancelled,
  );
  assert.equal(future.length, 4);
  for (const meeting of future) {
    assert.equal(
      data.requests[`reminder:start-check:${meeting.id}:${meeting.start}`],
      SUPPRESSION_VALUE,
    );
    assert.equal(
      data.requests[`reminder:end-reminder:${meeting.id}:${meeting.end}`],
      SUPPRESSION_VALUE,
    );
    for (const minutes of meeting.reminderMinutes) {
      assert.equal(
        data.requests[`reminder:before:${meeting.id}:${meeting.start}:${minutes}`],
        SUPPRESSION_VALUE,
      );
    }
  }
  assert.equal(
    data.requests[
      'reminder:start-check:final-judging-v1-restricted-upcoming:2026-11-02T15:00:00+09:00'
    ],
    SUPPRESSION_VALUE,
  );
  assert.equal(
    data.requests[
      'reminder:before:final-judging-v1-equipment-upcoming:2026-10-29T10:00:00+09:00:1440'
    ],
    SUPPRESSION_VALUE,
  );
  assert(Object.keys(data.requests).every((key) => key.startsWith('reminder:')));
});

test('actual scheduler emits nothing across all fixture deadlines and detects an unsuppressed control', async () => {
  const bundle = await build({
    stdin: {
      contents:
        "export { scheduleReminders } from './server/meeting-reminders.ts'; export { nextNotificationAt } from './server/notification-scheduler.ts';",
      resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const { scheduleReminders, nextNotificationAt } = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
  );
  const data = make();
  const state = {
    version: 1,
    people,
    rooms: [...rooms, ...data.addedRooms],
    topics: data.topics,
    meetings: data.meetings,
    preferences: {},
    requests: { ...data.requests },
    logs: [],
  };
  const base = Date.parse(`${data.baseDate}T00:00:00+09:00`);
  const deadlines = data.meetings
    .filter((meeting) => Date.parse(meeting.start) > base && !meeting.cancelled)
    .flatMap((meeting) => [
      Date.parse(meeting.start),
      Date.parse(meeting.end) - 5 * 60_000,
      Date.parse(meeting.end),
      ...meeting.reminderMinutes.map((minutes) => Date.parse(meeting.start) - minutes * 60_000),
    ]);
  const timeline = [
    ...new Set([base, ...deadlines.flatMap((deadline) => [deadline - 1, deadline, deadline + 1])]),
  ].sort((a, b) => a - b);
  for (const instant of timeline) {
    scheduleReminders(state, instant);
    assert.deepEqual(
      state.logs,
      [],
      `Unexpected notification at ${new Date(instant).toISOString()}`,
    );
    assert.equal(nextNotificationAt(state, instant), undefined);
  }
  assert.deepEqual(state.requests, data.requests);

  const meeting = data.meetings.find(
    (candidate) => candidate.id === entityId('equipment-upcoming'),
  );
  const control = structuredClone(state);
  delete control.requests[`reminder:start-check:${meeting.id}:${meeting.start}`];
  assert.equal(nextNotificationAt(control, base), Date.parse(meeting.start));
  scheduleReminders(control, Date.parse(meeting.start));
  assert.equal(control.logs.length, 1);
  assert.equal(control.logs[0].event, 'start-check');
  assert.equal(control.logs[0].recipientId, 'sujin');
});

test('entity IDs stay inside the dataset namespace and are unique across meetings, files and tasks', () => {
  const data = make();
  const ids = [
    ...data.topics.map((topic) => topic.id),
    ...data.meetings.flatMap((meeting) => [
      meeting.id,
      ...(meeting.summary?.tasks.map((task) => task.id) ?? []),
    ]),
    ...data.attachments.map((attachment) => attachment.data.id),
  ];
  assert(ids.every((id) => id.startsWith('final-judging-v1-')));
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(data.prefix, 'final-judging-v1-');
});

test('visible business content has natural labels without test or judging instructions', () => {
  const data = make();
  const visible = [
    ...data.topics.flatMap((topic) => [topic.title, topic.description]),
    ...data.meetings.flatMap((meeting) => [
      meeting.title,
      meeting.description,
      meeting.hostAtTime,
      ...(meeting.summary
        ? [meeting.summary.discussion, meeting.summary.decisions, meeting.summary.nextSteps]
        : []),
    ]),
    ...data.addedRooms.map((room) => room.name),
    ...data.attachments.flatMap((attachment) => [
      attachment.data.name,
      attachment.bytes.toString('utf8'),
    ]),
  ];
  assert(visible.every((text) => !/시연|체험|테스트|심사|가상|권한 비교|억제|촬영/.test(text)));
  assert.equal(
    data.topics.find((topic) => topic.id === entityId('restricted')).title,
    '보안 점검 실무 협의',
  );
  assert.equal(
    data.topics.find((topic) => topic.id === entityId('new-project')).title,
    '차세대 업무환경 개선',
  );
});

test('uses an explicit Seoul calendar date deterministically across month, year and leap-day boundaries', () => {
  const data = make();
  assert.deepEqual(data, make());
  assert.deepEqual(data, make({ rooms: [...rooms].reverse(), people: [...people].reverse() }));
  assert.equal(
    make({ baseDate: '2026-12-31' }).meetings.find(
      (meeting) => meeting.id === entityId('equipment-upcoming'),
    ).start,
    '2027-01-01T10:00:00+09:00',
  );
  assert.equal(
    make({ baseDate: '2024-03-01' }).meetings.find(
      (meeting) => meeting.id === entityId('equipment-summary-needed'),
    ).start,
    '2024-02-29T10:00:00+09:00',
  );
  assert.equal(
    data.meetings.find((meeting) => meeting.id === entityId('equipment-survey')).start,
    '2026-08-28T10:00:00+09:00',
  );
  assert.equal(
    data.meetings.find((meeting) => meeting.id === entityId('equipment-upcoming')).start,
    '2026-10-29T10:00:00+09:00',
  );
});

test('derives all person labels from the supplied directory and isolates returned data between builds', () => {
  const renamed = people.map((person, index) => ({ ...person, name: `가상담당${index + 1}` }));
  const data = make({ people: renamed });
  assert.match(data.topics[0].description, /가상담당1.*가상담당2/);
  assert(
    data.meetings.every((meeting) =>
      meeting.hostAtTime.startsWith(renamed.find((person) => person.id === meeting.creatorId).name),
    ),
  );
  assert(!JSON.stringify(data).includes('이전담당'));
  const original = make();
  original.topics[0].roles.sujin = 'Attendee';
  original.attachments[0].bytes.fill(0);
  original.addedRooms[0].capacity = 1;
  assert.equal(make().topics[0].roles.sujin, 'Master');
  assert(make().attachments[0].bytes[0] !== 0);
  assert.equal(make().addedRooms[0].capacity, 8);
});

test('rejects ambiguous directories, invalid dates and conflicting room identities before producing data', () => {
  for (const baseDate of [
    undefined,
    '',
    '2026-2-1',
    '2026-02-30',
    '2026-13-01',
    '2026-10-28T00:00:00Z',
  ]) {
    assert.throws(() => make({ baseDate }), /baseDate/);
  }
  assert.throws(() => make({ people: people.slice(1) }), /Missing named test account/);
  assert.throws(
    () =>
      make({
        people: people.map((person) =>
          person.id === 'sujin' ? { ...person, isTestAccount: false } : person,
        ),
      }),
    /Missing named test account/,
  );
  assert.throws(() => make({ people: [...people, people[0]] }), /Duplicate people ID/);
  assert.throws(() => make({ rooms: [...rooms, rooms[0]] }), /Duplicate rooms ID/);
  assert.throws(() => make({ rooms: [{ ...rooms[0], capacity: 0 }] }), /Invalid room/);
  assert.throws(() => make({ rooms: null }), /rooms must be an array/);
});
