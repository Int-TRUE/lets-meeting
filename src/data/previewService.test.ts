import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { initialDatabase, previewService, type MeetingInput } from './previewService';
import { defaultPreferences, saveSummary } from '../domain/workflows';
const input = (extra: Partial<MeetingInput> = {}): MeetingInput => ({
  topicId: 'system',
  title: '새 회의',
  description: '요청사항 검토',
  roomId: 'md-9',
  start: '2026-10-21T14:00:00+09:00',
  end: '2026-10-21T15:00:00+09:00',
  participantIds: ['kim', 'park'],
  material: 'none',
  attachments: [],
  ...extra,
});
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase('robot-butler-preview-v1');
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
});
describe('transactional preview workflow', () => {
  it('persists 토픽 creation and assigns Owner and Master without arbitrary limits', async () => {
    const id = await previewService.createTopic(
      'kim',
      {
        title: '연구 주제',
        description: '함께 연구합니다',
        managerIds: ['kim', 'lee', 'park', 'choi', 'jung', 'yoon', 'ops'],
      },
      'topic-request',
    );
    const data = await previewService.snapshot('park');
    const topic = data.topics.find((t) => t.id === id)!;
    expect(topic.roles.kim).toBe('Owner');
    expect(topic.roles.park).toBe('Master');
    expect(
      await previewService.createTopic(
        'kim',
        { title: '다른 제목', description: '재시도', managerIds: [] },
        'topic-request',
      ),
    ).toBe(id);
  });
  it('enforces 토픽 owner editing and does not remove existing managers', async () => {
    await expect(
      previewService.updateTopic('lee', 'system', {
        title: '변경',
        description: '설명',
        managerIds: ['kim', 'lee'],
      }),
    ).rejects.toThrow('소유자');
    await expect(
      previewService.updateTopic('kim', 'system', {
        title: '변경',
        description: '설명',
        managerIds: ['kim'],
      }),
    ).rejects.toThrow('제거 정책');
    expect(
      (await previewService.snapshot('kim')).topics.find((t) => t.id === 'system')?.title,
    ).toBe('전산기기 교체');
  });
  it('serializes two competing reservations and preserves the losing input as an error', async () => {
    const results = await Promise.allSettled([
      previewService.createMeeting('kim', input(), 'a'),
      previewService.createMeeting('lee', input(), 'b'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      (await previewService.snapshot('kim')).meetings.filter((m) => m.title === '새 회의'),
    ).toHaveLength(1);
  });
  it('returns the same meeting for duplicate submissions without duplicate events', async () => {
    const [a, b] = await Promise.all([
      previewService.createMeeting('kim', input(), 'same'),
      previewService.createMeeting('kim', input(), 'same'),
    ]);
    expect(a).toBe(b);
    expect((await previewService.adminLogs('ops')).filter((l) => l.meetingId === a)).toHaveLength(
      2,
    );
    expect(
      (await previewService.snapshot('park')).topics.find((t) => t.id === 'system')?.roles.park,
    ).toBe('Attendee');
  });
  it('checks final reservation conflict, keeps original booking on edit failure and releases cancellation', async () => {
    const a = await previewService.createMeeting('kim', input(), 'a');
    await expect(
      previewService.updateMeeting(
        'kim',
        a,
        input({ start: '2026-10-20T14:00:00+09:00', end: '2026-10-20T15:00:00+09:00' }),
        0,
      ),
    ).rejects.toThrow('겹칩니다');
    expect((await previewService.snapshot('kim')).meetings.find((m) => m.id === a)?.start).toBe(
      input().start,
    );
    await previewService.cancelMeeting('kim', a, 0);
    expect(await previewService.createMeeting('lee', input(), 'b')).toBeTruthy();
    await expect(previewService.cancelMeeting('kim', a, 0)).rejects.toThrow('변경되었습니다');
  });
  it('denies Attendee creation, other Master editing and hidden file access', async () => {
    await expect(
      previewService.createMeeting('kim', input({ topicId: 'team' }), 'a'),
    ).rejects.toThrow('관리자');
    const other = await previewService.createMeeting(
      'choi',
      input({ topicId: 'brand', participantIds: ['kim', 'choi'] }),
      'other',
    );
    await expect(
      previewService.updateMeeting(
        'kim',
        other,
        input({ topicId: 'brand', participantIds: ['kim', 'choi'] }),
        0,
      ),
    ).rejects.toThrow('수정');
    await expect(previewService.cancelMeeting('lee', 'equipment', 1)).rejects.toThrow(
      '변경되었습니다',
    );
    await expect(
      previewService.download('kim', 'restricted', 'example-restricted-0'),
    ).rejects.toThrow('접근');
    expect((await previewService.snapshot('ops')).meetings).toHaveLength(0);
  });
  it('keeps draft summaries incomplete and only allows the creator to complete an ended meeting', async () => {
    const summary = {
      discussion: '진행 점검',
      decisions: '다음 주 재검토',
      nextSteps: '견적 수집',
    };
    await previewService.saveSummary('kim', 'strategy', summary, false, 0);
    expect(
      (await previewService.snapshot('kim')).meetings.find((m) => m.id === 'strategy')?.completed,
    ).toBe(false);
    expect(await previewService.adminLogs('ops')).toHaveLength(0);
    await expect(previewService.saveSummary('choi', 'strategy', summary, true, 1)).rejects.toThrow(
      '생성자',
    );
    await expect(
      previewService.saveSummary(
        'kim',
        'strategy',
        { discussion: '', decisions: '', nextSteps: '' },
        true,
        1,
      ),
    ).rejects.toThrow('빈 요약');
    await previewService.saveSummary('kim', 'strategy', summary, true, 1);
    expect(
      (await previewService.snapshot('kim')).meetings.find((m) => m.id === 'strategy')?.completed,
    ).toBe(true);
    expect(
      (await previewService.adminLogs('ops')).every(
        (l) => l.event === 'summary' && l.result === 'not-connected',
      ),
    ).toBe(true);
  });
  it('stores real local file blobs, enforces file permissions and rejects stale replacement', async () => {
    const id = await previewService.createMeeting('kim', input(), 'a');
    const file = {
      id: 'attachment',
      name: '자료.txt',
      type: 'text/plain',
      size: 4,
      blob: new Blob(['test']),
      authorId: '',
      updatedAt: '',
    };
    await previewService.addFiles('kim', id, [file], 0);
    const downloaded = await previewService.download('park', id, file.id);
    expect(await downloaded.blob?.text()).toBe('test');
    await expect(previewService.addFiles('park', id, [file], 1)).rejects.toThrow('생성자');
    await previewService.replaceFile(
      'kim',
      id,
      file.id,
      { ...file, id: 'replacement', name: '새자료.txt' },
      1,
    );
    await expect(previewService.replaceFile('kim', id, 'replacement', file, 1)).rejects.toThrow(
      '변경되었습니다',
    );
  });
  it('locks required notifications in the service and keeps personal preferences separate', async () => {
    await previewService.savePreferences('park', {
      materials: false,
      summary: false,
      reminders: [],
    });
    const id = await previewService.createMeeting('kim', input(), 'a');
    expect(
      (await previewService.adminLogs('ops')).filter(
        (l) => l.meetingId === id && l.recipientId === 'park' && l.event === 'created',
      ),
    ).toHaveLength(1);
    const saved = await previewService.preferences('park');
    expect(saved.materials).toBe(false);
    expect(await previewService.preferences('kim')).toEqual(defaultPreferences);
    await expect(previewService.adminLogs('kim')).rejects.toThrow('운영 관리자');
    await expect(
      previewService.savePreferences('park', { ...saved, reminders: ['임의'] }),
    ).rejects.toThrow('리마인드');
  });
});

it('rejects outsiders on create and update without expanding 토픽 membership', async () => {
  await expect(
    previewService.createMeeting('kim', input({ participantIds: ['ops'] }), 'outsider'),
  ).rejects.toThrow('토픽에 포함된');
  const id = await previewService.createMeeting('kim', input(), 'valid');
  await expect(
    previewService.updateMeeting('kim', id, input({ participantIds: ['ops'] }), 0),
  ).rejects.toThrow('토픽에 포함된');
  const snapshot = await previewService.snapshot('kim');
  expect(snapshot.topics.find((topic) => topic.id === 'system')?.roles.ops).toBeUndefined();
  expect(snapshot.meetings.find((meeting) => meeting.id === id)?.participantIds).toEqual([
    'kim',
    'park',
  ]);
});
it('exposes room schedule summaries to nonmembers without disclosing meeting contents', async () => {
  const rows = await previewService.roomSchedule('ops', 'md-9', '2026-10');
  expect(rows.find((meeting) => meeting.id === 'equipment')).toMatchObject({
    title: '전산기기 교체 · 2차 실무 회의',
    hostName: '이서준',
    canOpen: false,
  });
  expect(
    rows.every(
      (meeting) =>
        !('description' in meeting) &&
        !('attachments' in meeting) &&
        !('participantIds' in meeting),
    ),
  ).toBe(true);
  expect((await previewService.snapshot('ops')).meetings).toHaveLength(0);
  await previewService.cancelMeeting('lee', 'equipment', 0);
  expect(
    (await previewService.roomSchedule('ops', 'md-9', '2026-10')).some(
      (meeting) => meeting.id === 'equipment',
    ),
  ).toBe(false);
  expect(await previewService.roomSchedule('ops', 'md-9', '2026-11')).toEqual([]);
});

it('lets attendees write and revise shared summaries, including after completion', async () => {
  const summary = { discussion: '참가자 작성', decisions: '함께 결정', nextSteps: '' };
  await previewService.saveSummary('jung', 'strategy', summary, false, 0);
  expect(
    (await previewService.snapshot('kim')).meetings.find((m) => m.id === 'strategy')?.summary
      ?.discussion,
  ).toBe('참가자 작성');
  await expect(previewService.saveSummary('choi', 'strategy', summary, false, 0)).rejects.toThrow(
    '변경되었습니다',
  );
  await expect(previewService.saveSummary('jung', 'strategy', summary, true, 1)).rejects.toThrow(
    '생성자',
  );
  await previewService.saveSummary('kim', 'strategy', summary, true, 1);
  await previewService.saveSummary(
    'jung',
    'strategy',
    { ...summary, discussion: '완료 후 보완' },
    false,
    2,
  );
  const meeting = (await previewService.snapshot('kim')).meetings.find((m) => m.id === 'strategy')!;
  expect(meeting.completed).toBe(true);
  expect(meeting.summary?.discussion).toBe('완료 후 보완');
  expect(meeting.revision).toBe(3);
  await expect(previewService.saveSummary('park', 'equipment', summary, false, 0)).rejects.toThrow(
    '종료된',
  );
  await previewService.cancelMeeting('lee', 'equipment', 0);
  await expect(previewService.saveSummary('park', 'equipment', summary, false, 1)).rejects.toThrow(
    '종료된',
  );
});

it('does not grant summary editing to a nonparticipant 토픽 manager', () => {
  const db = initialDatabase();
  db.topics.find((topic) => topic.id === 'brand')!.roles.lee = 'Master';
  expect(() =>
    saveSummary(
      db,
      'strategy',
      'lee',
      { discussion: '비참가자', decisions: '', nextSteps: '' },
      false,
      '2026-10-20T13:30:00+09:00',
      0,
    ),
  ).toThrow('참가자');
});

it('persists favorites per user and preserves them when notification preferences change', async () => {
  await previewService.setFavoriteRoom('kim', 'bd-3', true);
  await previewService.savePreferences('kim', { materials: false, summary: false, reminders: [] });
  expect(await previewService.favoriteRooms('kim')).toEqual(['bd-3']);
  expect(await previewService.favoriteRooms('park')).toEqual([]);
  await previewService.setFavoriteRoom('kim', 'bd-3', false);
  expect(await previewService.favoriteRooms('kim')).toEqual([]);
  await expect(previewService.setFavoriteRoom('kim', 'missing', true)).rejects.toThrow();
});
it('stores meeting reminder choices and only permits the creator to send manual reminders idempotently', async () => {
  const id = await previewService.createMeeting(
    'kim',
    input({ reminderMinutes: [1440, 60, 30, 5, 3] }),
    'reminders',
  );
  expect(
    (await previewService.snapshot('kim')).meetings.find((m) => m.id === id)?.reminderMinutes,
  ).toEqual([1440, 60, 30, 5, 3]);
  await expect(previewService.sendReminder('lee', id, 'not-host')).rejects.toThrow('주최자');
  await previewService.sendReminder('kim', id, 'once');
  await previewService.sendReminder('kim', id, 'once');
  await expect(previewService.sendReminder('kim', id, 'again')).rejects.toThrow('1분');
  await expect(
    previewService.createMeeting('kim', input({ reminderMinutes: [7] }), 'invalid'),
  ).rejects.toThrow('리마인드');
});
it('stores checklist state, preserves completed status and rejects stale summary edits', async () => {
  const summary = {
    discussion: '논의',
    decisions: '결정',
    nextSteps: '',
    tasks: [{ id: 'task-1', text: '자료 공유', done: false }],
  };
  await previewService.saveSummary('kim', 'strategy', summary, true, 0);
  await previewService.saveSummary(
    'jung',
    'strategy',
    { ...summary, tasks: [{ ...summary.tasks[0], done: true }] },
    false,
    1,
  );
  const m = (await previewService.snapshot('kim')).meetings.find((m) => m.id === 'strategy')!;
  expect(m.completed).toBe(true);
  expect(m.summary?.tasks?.[0].done).toBe(true);
  await expect(previewService.saveSummary('kim', 'strategy', summary, false, 1)).rejects.toThrow(
    '다른 창',
  );
});

it('deletes only the creator’s attachment with revision checks and restores pending material state', async () => {
  const id = await previewService.createMeeting('kim', input(), 'delete-file');
  const file = {
    id: 'test-file',
    name: '자료.txt',
    type: 'text/plain',
    size: 3,
    authorId: '',
    updatedAt: '',
    blob: new Blob(['abc']),
  };
  await previewService.addFiles('kim', id, [file], 0);
  await expect(previewService.deleteFile('park', id, file.id, 1)).rejects.toThrow('권한');
  await expect(previewService.deleteFile('kim', id, file.id, 0)).rejects.toThrow();
  await expect(previewService.download('kim', id, file.id)).resolves.toMatchObject({
    name: file.name,
  });
  await previewService.deleteFile('kim', id, file.id, 1);
  const meeting = (await previewService.snapshot('kim')).meetings.find((m) => m.id === id)!;
  expect(meeting.attachments).toEqual([]);
  expect(meeting.files).toEqual([]);
  expect(meeting.material).toBe('pending');
  await expect(previewService.download('kim', id, file.id)).rejects.toThrow();
  await expect(previewService.deleteFile('kim', id, file.id, 2)).rejects.toThrow();
});

it('lists all topic members including attendees and rejects unauthorized readers', async () => {
  const topic = initialDatabase().topics.find((topic) => topic.id === 'system')!;
  const members = await previewService.topicPeople('kim', 'system');
  expect(members.map((person) => person.id).sort()).toEqual(Object.keys(topic.roles).sort());
  await expect(previewService.topicPeople('ops', 'system')).rejects.toThrow();
  await expect(previewService.topicPeople('park', 'system')).rejects.toThrow();
});

describe('topic organization and role changes', () => {
  const getTopic = async () =>
    (await previewService.snapshot('kim')).topics.find((t) => t.id === 'system')!;
  it('only the Owner can inspect the organization or change roles', async () => {
    expect((await previewService.topicOrganization('kim', 'system')).length).toBeGreaterThan(6);
    for (const user of ['lee', 'park', 'ops']) {
      await expect(previewService.topicOrganization(user, 'system')).rejects.toThrow();
      const topic = await getTopic();
      await expect(
        previewService.updateTopic(user, 'system', {
          ...topic,
          managerIds: [],
          expectedRoles: topic.roles,
        }),
      ).rejects.toThrow();
    }
  });
  it('applies membership and role changes to lists and attachment access immediately', async () => {
    const meetingId = await previewService.createMeeting(
      'kim',
      input({
        attachments: [
          {
            id: 'role-file',
            name: '권한검증.txt',
            type: 'text/plain',
            size: 4,
            blob: new Blob(['test']),
            authorId: 'kim',
            updatedAt: '2026-10-20T13:30:00+09:00',
          },
        ],
        material: 'uploaded',
      }),
      'role-meeting',
    );
    const topic = await getTopic();
    const roles = { ...topic.roles, lee: 'Attendee' as const, ops: 'Attendee' as const };
    await previewService.updateTopic('kim', 'system', {
      ...topic,
      managerIds: [],
      roles,
      expectedRoles: topic.roles,
    });
    expect((await previewService.snapshot('lee')).meetings.some((m) => m.id === meetingId)).toBe(
      false,
    );
    expect((await previewService.snapshot('park')).meetings.some((m) => m.id === meetingId)).toBe(
      true,
    );
    expect((await previewService.snapshot('ops')).meetings.some((m) => m.id === meetingId)).toBe(
      false,
    );
    await expect(previewService.download('lee', meetingId, 'role-file')).rejects.toThrow();
    expect((await previewService.download('park', meetingId, 'role-file')).name).toBe(
      '권한검증.txt',
    );
    await previewService.updateTopic('kim', 'system', {
      ...topic,
      managerIds: [],
      roles: { ...roles, lee: 'Master' },
      expectedRoles: roles,
    });
    expect((await previewService.snapshot('lee')).meetings.some((m) => m.id === meetingId)).toBe(
      true,
    );
    expect((await previewService.download('lee', meetingId, 'role-file')).name).toBe(
      '권한검증.txt',
    );
    const current = await getTopic();
    const removed = { ...current.roles };
    delete removed.park;
    await previewService.updateTopic('kim', 'system', {
      ...current,
      managerIds: [],
      roles: removed,
      expectedRoles: current.roles,
    });
    expect((await previewService.snapshot('park')).meetings.some((m) => m.id === meetingId)).toBe(
      false,
    );
    await expect(previewService.download('park', meetingId, 'role-file')).rejects.toThrow();
  });
  it('rejects stale edits, Owner removal, duplicate owners, unknown people and invalid roles atomically', async () => {
    const topic = await getTopic();
    for (const roles of [
      { ...topic.roles, kim: 'Attendee' },
      { ...topic.roles, lee: 'Owner' },
      { ...topic.roles, unknown: 'Master' },
      { ...topic.roles, lee: 'Admin' },
    ]) {
      await expect(
        previewService.updateTopic('kim', 'system', {
          ...topic,
          title: '변경되면 안 됨',
          managerIds: [],
          roles: roles as typeof topic.roles,
          expectedRoles: topic.roles,
        }),
      ).rejects.toThrow();
      expect((await getTopic()).title).toBe(topic.title);
    }
    await previewService.updateTopic('kim', 'system', {
      ...topic,
      managerIds: [],
      roles: { ...topic.roles, lee: 'Attendee' },
      expectedRoles: topic.roles,
    });
    await expect(
      previewService.updateTopic('kim', 'system', {
        ...topic,
        managerIds: [],
        expectedRoles: topic.roles,
      }),
    ).rejects.toThrow('새로고침');
  });
});
