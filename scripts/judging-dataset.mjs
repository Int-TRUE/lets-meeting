import assert from 'node:assert/strict';

export const DATASET_PREFIX = 'final-judging-v1-';
export const SUPPRESSION_VALUE = 'suppressed:judging-fixture';

const ACTORS = ['taeheon', 'sujin', 'wooseok', 'jooyoung'];
const DAY = 86_400_000;
const SEOUL_OFFSET = 9 * 3_600_000;
const NEW_ROOMS = [
  {
    id: 'final-judging-room-bd-4a',
    name: '4층 회의실 A',
    location: '분당',
    floor: '4층',
    capacity: 8,
    active: true,
  },
  {
    id: 'final-judging-room-bd-4b',
    name: '4층 회의실 B',
    location: '분당',
    floor: '4층',
    capacity: 12,
    active: true,
  },
  {
    id: 'final-judging-room-bd-5l',
    name: '5층 대회의실',
    location: '분당',
    floor: '5층',
    capacity: 20,
    active: true,
  },
];

function calendarDate(epoch) {
  const value = new Date(epoch + SEOUL_OFFSET).toISOString().slice(0, 10);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value), 'Date is outside the supported calendar range');
  return value;
}

function indexById(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  const result = new Map();
  for (const value of values) {
    assert(value && typeof value.id === 'string' && value.id, `${label} needs stable IDs`);
    assert(!result.has(value.id), `Duplicate ${label} ID: ${value.id}`);
    result.set(value.id, value);
  }
  return result;
}

function canonical(value) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
}

/**
 * Build a deterministic, silent fixture; never reads a database or sends a message.
 * people and rooms are directory objects, not SQL rows. Existing rooms are immutable.
 * The caller must separately check room conflicts with any meetings it preserves.
 * Attachment rows contain real Buffer bytes; no delivery receipts are fabricated.
 */
export function buildDataset({ baseDate, people, rooms } = {}) {
  assert(
    typeof baseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(baseDate),
    'baseDate must be YYYY-MM-DD in Asia/Seoul',
  );
  const base = Date.parse(`${baseDate}T00:00:00+09:00`);
  assert(
    Number.isFinite(base) && calendarDate(base) === baseDate,
    'baseDate must be a real calendar date',
  );
  const directory = indexById(people, 'people');
  for (const id of ACTORS) {
    const person = directory.get(id);
    assert(
      person?.isTestAccount === true && typeof person.name === 'string' && person.name.trim(),
      `Missing named test account: ${id}`,
    );
  }
  const catalog = indexById(rooms, 'rooms');
  for (const room of catalog.values()) {
    assert(
      typeof room.name === 'string' && room.name && typeof room.floor === 'string' && room.floor,
      `Invalid room label: ${room.id}`,
    );
    assert(
      ['명동', '분당'].includes(room.location) &&
        Number.isInteger(room.capacity) &&
        room.capacity > 0 &&
        typeof room.active === 'boolean',
      `Invalid room: ${room.id}`,
    );
  }
  const addedRooms = [];
  for (const definition of NEW_ROOMS) {
    const existing = catalog.get(definition.id);
    if (existing)
      assert.equal(
        canonical(existing),
        canonical(definition),
        `Existing judging room differs: ${definition.id}`,
      );
    else {
      const room = { ...definition };
      addedRooms.push(room);
      catalog.set(room.id, room);
    }
  }
  const day = (offset) => {
    const epoch = base + offset * DAY;
    const weekday = new Date(epoch + SEOUL_OFFSET).getUTCDay();
    const adjustment =
      offset < 0
        ? weekday === 0
          ? -2
          : weekday === 6
            ? -1
            : 0
        : offset > 0
          ? weekday === 0
            ? 1
            : weekday === 6
              ? 2
              : 0
          : 0;
    return calendarDate(epoch + adjustment * DAY);
  };
  const at = (offset, hour) => `${day(offset)}T${String(hour).padStart(2, '0')}:00:00+09:00`;
  const stamp = at(0, 8);
  const id = (key) => DATASET_PREFIX + key;
  const roles = (
    owner,
    master,
    attendees = ACTORS.filter((actor) => actor !== owner && actor !== master),
  ) =>
    Object.fromEntries([
      [owner, 'Owner'],
      [master, 'Master'],
      ...attendees.map((actor) => [actor, 'Attendee']),
    ]);
  const topic = (key, title, description, icon, tone, members) => ({
    id: id(key),
    title,
    description,
    icon,
    tone,
    roles: members,
  });
  const topics = [
    topic(
      'equipment',
      '전산기기 교체',
      `${directory.get('taeheon').name}의 검토 기록을 ${directory.get('sujin').name}이 이어받아 교체 준비와 후속 점검을 진행합니다.`,
      'monitor',
      'blue',
      roles('taeheon', 'sujin'),
    ),
    topic(
      'cms',
      'CMS 서비스 점검',
      '화면 점검 결과를 정리하고 다음 확인 항목을 함께 준비합니다.',
      'chart',
      'mint',
      roles('jooyoung', 'sujin'),
    ),
    topic(
      'operations',
      '부서 간 운영 협의',
      '공통 점검표와 인계 방식을 합의하고 후속 작업을 확인합니다.',
      'people',
      'blue',
      roles('taeheon', 'sujin'),
    ),
    topic(
      'restricted',
      '보안 점검 실무 협의',
      '검토 자료의 공유 범위와 후속 확인 항목을 협의합니다.',
      'people',
      'peach',
      roles('taeheon', 'sujin', []),
    ),
    topic(
      'new-project',
      '차세대 업무환경 개선',
      '업무환경 개선 방향과 추진 과제에 관한 첫 논의를 준비합니다.',
      'monitor',
      'mint',
      roles('sujin', 'taeheon'),
    ),
  ];
  const meetings = [];
  const attachments = [];
  const note = (discussion, decisions, tasks) => ({ discussion, decisions, tasks });

  function add({
    key,
    topicIndex,
    title,
    description,
    offset,
    hour,
    creator = 'sujin',
    participants = ACTORS,
    state = 'completed',
    material = 'none',
    preferredRoom = 'bd-3',
    summary,
    file,
    reminderMinutes = [],
  }) {
    const parent = topics[topicIndex];
    const participantIds = [...new Set([creator, ...participants])];
    assert(['Owner', 'Master'].includes(parent.roles[creator]), 'Creator must manage the topic');
    assert(
      participantIds.every((actor) => directory.has(actor) && parent.roles[actor]),
      'Participant must belong to the topic',
    );
    const start = at(offset, hour);
    const end = at(offset, hour + 1);
    const eligible = [...catalog.values()]
      .filter((room) => room.active && room.capacity >= participantIds.length)
      .sort(
        (a, b) =>
          Number(b.id === preferredRoom) - Number(a.id === preferredRoom) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    const room = eligible.find(
      (candidate) =>
        !meetings.some(
          (meeting) =>
            !meeting.cancelled &&
            meeting.roomId === candidate.id &&
            Date.parse(start) < Date.parse(meeting.end) &&
            Date.parse(meeting.start) < Date.parse(end),
        ),
    );
    assert(room, `No available room with sufficient capacity: ${key}`);
    const meeting = {
      id: id(key),
      topicId: parent.id,
      title,
      description,
      start,
      end,
      roomId: room.id,
      room: `${room.location} · ${room.name}`,
      creatorId: creator,
      participantIds,
      files: [],
      material,
      completed: state === 'completed',
      cancelled: state === 'cancelled',
      revision: 0,
      updatedAt: stamp,
      hostAtTime: [directory.get(creator).name, directory.get(creator).position]
        .filter(Boolean)
        .join(' '),
      reminderMinutes: [...reminderMinutes],
    };
    if (summary) {
      const tasks = summary.tasks.map(([text, done], index) => ({
        id: `${meeting.id}-task-${index + 1}`,
        text,
        done,
      }));
      meeting.summary = {
        discussion: summary.discussion,
        decisions: summary.decisions,
        tasks,
        nextSteps: tasks.map((task) => task.text).join('\n'),
        savedAt: end,
      };
    }
    if (file) {
      const bytes = Buffer.from(file.content, 'utf8');
      const data = {
        id: `${meeting.id}-file`,
        name: file.name,
        type: file.type,
        size: bytes.length,
        authorId: creator,
        updatedAt: end,
      };
      attachments.push({ meetingId: meeting.id, data, bytes });
      meeting.files.push(data.name);
      meeting.material = 'uploaded';
    }
    meetings.push(meeting);
  }

  add({
    key: 'equipment-survey',
    topicIndex: 0,
    title: '1차 현황 조사 · 노후 장비 우선 교체',
    description: '전산기기의 사용 상태를 확인하고 노후 장비를 중심으로 교체 우선순위를 정합니다.',
    offset: -60,
    hour: 10,
    creator: 'taeheon',
    summary: note(
      '사용 기간과 기기 상태를 확인하고 교체가 필요한 장비를 정리했습니다.',
      '노후 장비부터 우선 교체합니다.',
      [
        ['노후 장비 현황 확인', true],
        ['교체 우선순위 정리', true],
        ['부서별 교체 방식 검토', true],
      ],
    ),
    file: {
      name: '전산기기_현황.csv',
      type: 'text/csv',
      content:
        '관리번호,사용상태,교체우선순위\nPC-01,노후,우선\nPC-02,노후,우선\nPC-03,노후,우선\nPC-04,일반,후속 검토\nPC-05,일반,후속 검토\nPC-06,일반,후속 검토\n',
    },
  });
  add({
    key: 'equipment-pilot',
    topicIndex: 0,
    title: '2차 방식 검토 · 부서별 순차 교체',
    description:
      '노후 장비 우선 원칙을 유지하면서 업무 중단을 줄일 수 있는 부서별 진행 방식을 합의합니다.',
    offset: -30,
    hour: 10,
    creator: 'taeheon',
    participants: ['taeheon', 'sujin', 'wooseok'],
    summary: note(
      '부서별 업무 일정과 교체에 필요한 준비 항목을 비교했습니다.',
      '업무 중단을 피하도록 부서별로 나누어 진행합니다.',
      [
        ['부서별 업무 일정 확인', true],
        ['순차 교체 방식 합의', true],
        ['일정 확정에 필요한 준비 항목 정리', true],
      ],
    ),
  });
  add({
    key: 'equipment-handover',
    topicIndex: 0,
    title: '3차 인계 · 교체 일정 준비',
    description:
      '앞선 두 회의의 결정 사항과 남은 준비 항목을 새 담당자가 이어받아 다음 안건을 정리합니다.',
    offset: -14,
    hour: 10,
    summary: note(
      '노후 장비 우선 교체와 부서별 순차 진행 결정을 확인하고 준비 자료를 인계했습니다.',
      '기존 교체 원칙을 유지하고 다음 회의에서 교체 일정을 확정합니다.',
      [
        ['이전 결정 사항 확인', true],
        ['교체 준비 자료 인계', true],
        ['교체 일정 확정 안건 준비', false],
      ],
    ),
    file: {
      name: '담당자_인계메모.txt',
      type: 'text/plain',
      content:
        '전산기기 교체 인계 메모\n\n1차 결정: 노후 장비부터 우선 교체\n2차 결정: 업무 중단을 피하도록 부서별로 나누어 진행\n3차 인계: 기존 결정과 준비 자료를 확인하고 새 담당자가 후속 일정 조율\n다음 회의 안건: 교체 일정 확정\n',
    },
  });
  add({
    key: 'equipment-summary-needed',
    topicIndex: 0,
    title: '교체 준비 점검',
    description:
      '1차 교체 대상 목록과 부서별 준비 상황을 확인하고 사전 안내와 일정 등록의 후속 작업을 논의합니다.',
    offset: -1,
    hour: 10,
    state: 'summary-needed',
    summary: note(
      '부서별 준비 항목과 교체 순서를 점검했습니다.',
      '1차 교체는 정보개발팀부터 진행한다.',
      [
        ['1차 교체 대상 목록 확인', true],
        ['정보개발팀 사전 안내', false],
        ['교체 일정 등록', false],
      ],
    ),
  });
  add({
    key: 'equipment-upcoming',
    topicIndex: 0,
    title: '교체 일정 확정',
    description:
      '노후 장비 우선 원칙에 따라 부서별 준비 상황을 확인하고 업무 중단을 피할 수 있는 교체 날짜와 순서를 확정합니다.',
    offset: 1,
    hour: 10,
    state: 'scheduled',
    material: 'pending',
    reminderMinutes: [1440, 30],
  });

  add({
    key: 'cms-review',
    topicIndex: 1,
    title: '화면 점검 결과 정리',
    description: '화면 표시 순서와 안내 문구를 함께 확인하고 보완이 필요한 항목을 정리합니다.',
    offset: -45,
    hour: 14,
    creator: 'jooyoung',
    preferredRoom: 'final-judging-room-bd-4a',
    summary: note(
      '화면의 표시 순서와 안내 문구를 점검했습니다.',
      '안내 문구 두 곳을 보완한 뒤 다음 점검에서 다시 확인합니다.',
      [
        ['화면 확인 항목 정리', true],
        ['안내 문구 보완안 작성', false],
      ],
    ),
    file: {
      name: 'CMS_화면점검.csv',
      type: 'text/csv',
      content:
        '점검항목,확인결과\n표시 순서,확인 완료\n안내 문구 A,보완 예정\n안내 문구 B,보완 예정\n',
    },
  });
  add({
    key: 'cms-cancelled',
    topicIndex: 1,
    title: '안내 문구 검토',
    description:
      '보완안 준비 시간을 확보하기 위해 검토 일정을 취소하고 다음 협의에서 확인하기로 했습니다.',
    offset: -7,
    hour: 14,
    creator: 'jooyoung',
    preferredRoom: 'final-judging-room-bd-4a',
    state: 'cancelled',
  });
  add({
    key: 'cms-upcoming',
    topicIndex: 1,
    title: '안내 문구 보완 결과 확인',
    description: '앞선 점검에서 남긴 두 가지 보완안을 분당 회의실에서 확인합니다.',
    offset: 2,
    hour: 14,
    preferredRoom: 'final-judging-room-bd-4a',
    state: 'scheduled',
    reminderMinutes: [60, 10, 3],
  });

  add({
    key: 'operations-agreement',
    topicIndex: 2,
    title: '공통 점검표 합의',
    description: '여러 부서가 동일한 점검표를 사용하도록 확인 항목과 인계 방식을 정합니다.',
    offset: -21,
    hour: 11,
    creator: 'taeheon',
    preferredRoom: 'final-judging-room-bd-4b',
    summary: note(
      '부서마다 달랐던 점검표 항목을 비교했습니다.',
      '공통 항목 세 가지를 먼저 사용하고 다음 협의에서 의견을 반영합니다.',
      [
        ['공통 항목 세 가지 정리', true],
        ['각 부서 의견 모으기', false],
      ],
    ),
  });
  add({
    key: 'operations-draft',
    topicIndex: 2,
    title: '점검표 의견 취합',
    description: '부서별 의견을 분류하고 공통 점검표에서 추가로 확인할 항목을 정리합니다.',
    offset: -2,
    hour: 11,
    preferredRoom: 'final-judging-room-bd-4b',
    state: 'draft',
    summary: note(
      '공통 점검표에 대한 의견을 모았습니다. 미확인 항목은 참가자 의견을 더 받아 보완할 예정입니다.',
      '초안을 검토한 뒤 최종 결정 사항을 확정합니다.',
      [
        ['취합한 의견 분류', true],
        ['참가자와 초안 검토', false],
        ['최종 결정 사항 저장', false],
      ],
    ),
    file: {
      name: '공통점검표_초안.txt',
      type: 'text/plain',
      content:
        '공통 점검표 초안\n\n- 준비 자료가 있는지 확인\n- 담당자가 확인한 내용을 기록\n- 다음 회의에서 확인할 항목을 남김\n상태: 참가자 검토 중인 초안\n',
    },
  });
  add({
    key: 'operations-upcoming',
    topicIndex: 2,
    title: '공통 점검표 후속 협의',
    description: '초안의 미완료 항목을 확인하고 공통 점검표를 보완합니다.',
    offset: 3,
    hour: 11,
    creator: 'taeheon',
    preferredRoom: 'final-judging-room-bd-4b',
    state: 'scheduled',
    material: 'pending',
    reminderMinutes: [30, 5],
  });

  add({
    key: 'restricted-review',
    topicIndex: 3,
    title: '자료 공유 범위 확인',
    description: '검토 메모의 공유 대상과 회의 후 확인할 항목을 정리합니다.',
    offset: -5,
    hour: 15,
    creator: 'taeheon',
    participants: ['taeheon', 'sujin'],
    summary: note(
      '검토 메모에 필요한 항목과 공유 대상을 확인했습니다.',
      '의견 취합 후 협의된 범위의 검토 메모를 공유합니다.',
      [['검토 메모의 공유 대상 정리', true]],
    ),
  });
  add({
    key: 'restricted-upcoming',
    topicIndex: 3,
    title: '자료 공유 범위 재확인',
    description: '후속 검토 의견을 확인하고 메모의 공유 범위를 다시 점검합니다.',
    offset: 4,
    hour: 15,
    participants: ['taeheon', 'sujin'],
    state: 'scheduled',
  });

  const requests = {};
  for (const meeting of meetings) {
    if (meeting.cancelled || meeting.completed || Date.parse(meeting.end) <= base) continue;
    // Empty reminderMinutes does not disable the unconditional start/end prompts.
    for (const key of [
      `reminder:start-check:${meeting.id}:${meeting.start}`,
      `reminder:end-reminder:${meeting.id}:${meeting.end}`,
      ...meeting.reminderMinutes.map(
        (minutes) => `reminder:before:${meeting.id}:${meeting.start}:${minutes}`,
      ),
    ])
      requests[key] = SUPPRESSION_VALUE;
  }
  return {
    prefix: DATASET_PREFIX,
    baseDate,
    addedRooms,
    topics,
    meetings,
    attachments,
    logs: [],
    requests,
  };
}
