import { createId } from '../domain/id';
import { fixture, people } from './workspace.js';
import { encodeWire, decodeWire } from './wire.js';
import type {
  Attachment,
  Role,
  Meeting,
  NotificationSettings,
  PreviewDatabase,
  Summary,
  Workspace,
} from '../domain/models.js';
import { dateKey, meetingStatus, visibleWorkspace } from '../domain/selectors.js';
import {
  canReadMeeting,
  canCreateMeeting,
  canEditMeeting,
  defaultPreferences,
  recordEvent,
  reminderChoices,
  requireMeeting,
  requireRevision,
  requireTopic,
  roomConflicts,
  roomLabel,
  rooms,
  previewPolicy,
  RuleError,
  saveSummary,
  validateSchedule,
  meetingReminderChoices,
} from '../domain/workflows.js';
const DB_NAME = 'robot-butler-preview-v1';
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new RuleError('이 브라우저에서 미리보기 저장소를 열 수 없어요.'));
  });
}
export function initialDatabase(): PreviewDatabase {
  return structuredClone({
    version: 1,
    topics: fixture.topics,
    meetings: fixture.meetings.map((m) => ({
      ...m,
      revision: 0,
      attachments: m.files.map((name, i) => ({
        id: `example-${m.id}-${i}`,
        name,
        type: '예시',
        size: 0,
        authorId: m.creatorId,
        updatedAt: m.start,
      })),
    })),
    preferences: {},
    logs: [],
    requests: {},
  });
}
export type TransactionAdapter = <T>(
  userId: string,
  mutate: (data: PreviewDatabase) => T,
  write: boolean,
) => Promise<T>;
let transactionAdapter: TransactionAdapter | undefined;
export function configureTransactionAdapter(adapter: TransactionAdapter) {
  transactionAdapter = adapter;
}
// A readwrite IndexedDB transaction serializes competing preview reservations across tabs.
// All checks happen in this adapter too; production must replace it with an authenticated API.
async function transact<T>(
  userId: string,
  mutate: (data: PreviewDatabase) => T,
  write = true,
): Promise<T> {
  if (transactionAdapter) return transactionAdapter(userId, mutate, write);
  if (write && import.meta.env?.PROD && import.meta.env.VITE_ENABLE_PREVIEW !== 'true') {
    throw new RuleError('미리보기 저장은 개발 환경에서만 사용할 수 있어요.');
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', write ? 'readwrite' : 'readonly');
    const store = tx.objectStore('workspace');
    const request = store.get('state');
    let result: T;
    let cause: unknown;
    request.onsuccess = () => {
      try {
        if (!people.some((p) => p.id === userId))
          throw new RuleError('예시 세션을 다시 선택해주세요.');
        const state: PreviewDatabase = request.result ?? initialDatabase();
        result = mutate(state);
        if (write) store.put(state, 'state');
      } catch (error) {
        cause = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(
        cause ??
          new RuleError(
            '저장하지 못했어요. 입력은 유지됩니다. 저장 공간을 확인하고 다시 시도해주세요.',
          ),
      );
    };
  });
}
const now = (data: PreviewDatabase) => data.now ?? fixture.now;
const directory = (data: PreviewDatabase) => data.people ?? people;
export const localService = {
  topicOrganization(userId: string, topicId: string) {
    return transact(
      userId,
      (data) => {
        const topic = requireTopic(data, topicId, userId);
        if (topic.roles[userId] !== 'Owner')
          throw new RuleError('토픽 소유자만 조직도를 조회할 수 있어요.');
        return directory(data);
      },
      false,
    );
  },
  topicPeople(userId: string, topicId: string) {
    return transact(
      userId,
      (data) => {
        const topic = requireTopic(data, topicId, userId);
        if (!canCreateMeeting(topic, userId)) throw new RuleError('참가자를 조회할 권한이 없어요.');
        return directory(data).filter((person) => Object.hasOwn(topic.roles, person.id));
      },
      false,
    );
  },
  searchPeople(userId: string, query: string, topicId?: string) {
    return transact(
      userId,
      (data) => {
        if (typeof query !== 'string') throw new RuleError('검색어를 확인해주세요.');
        const term = query.trim().toLocaleLowerCase('ko-KR');
        const topic = topicId ? requireTopic(data, topicId, userId) : undefined;
        if (topic && !canCreateMeeting(topic, userId))
          throw new RuleError('참가자를 검색할 권한이 없어요.');
        if (!term) return { people: [], hasMore: false };
        const matches = directory(data).filter(
          (p) =>
            (!topic || Object.hasOwn(topic.roles, p.id)) &&
            `${p.name} ${p.team} ${p.position ?? ''}`.toLocaleLowerCase('ko-KR').includes(term),
        );
        return { people: matches.slice(0, 20), hasMore: matches.length > 20 };
      },
      false,
    );
  },
  deleteFile(userId: string, id: string, attachmentId: string, revision: number) {
    return transact(userId, (data) => {
      const { meeting } = requireMeeting(data, id, userId);
      requireRevision(meeting, revision);
      if (meeting.creatorId !== userId || meeting.cancelled || meeting.completed)
        throw new RuleError('자료를 삭제할 권한이 없어요.');
      if (!meeting.attachments?.some((a) => a.id === attachmentId))
        throw new RuleError('최신 자료 목록을 다시 확인해주세요.');
      meeting.attachments = meeting.attachments.filter((a) => a.id !== attachmentId);
      meeting.files = meeting.attachments.map((a) => a.name);
      meeting.material = meeting.attachments.length ? 'uploaded' : 'pending';
      meeting.revision = revision + 1;
      recordEvent(data, meeting, 'materials', now(data));
      return id;
    });
  },
  favoriteRooms(userId: string) {
    return transact(userId, (data) => data.preferences[userId]?.favoriteRoomIds ?? [], false);
  },
  setFavoriteRoom(userId: string, roomId: string, favorite: boolean) {
    return transact(userId, (data) => {
      if (
        !(data.rooms ?? rooms).some((r) => r.id === roomId && r.active) ||
        typeof favorite !== 'boolean'
      )
        throw new RuleError('회의실을 다시 선택해주세요.');
      const prefs = data.preferences[userId] ?? structuredClone(defaultPreferences);
      const ids = new Set(prefs.favoriteRoomIds ?? []);
      if (favorite) ids.add(roomId);
      else ids.delete(roomId);
      data.preferences[userId] = { ...prefs, favoriteRoomIds: [...ids] };
      return [...ids];
    });
  },
  sendReminder(userId: string, id: string, requestId: string) {
    return transact(userId, (data) => {
      const { meeting } = requireMeeting(data, id, userId);
      if (
        meeting.creatorId !== userId ||
        meeting.cancelled ||
        meeting.completed ||
        Date.parse(meeting.end) <= Date.parse(now(data))
      )
        throw new RuleError('진행 중이거나 예정된 회의의 주최자만 리마인드를 보낼 수 있어요.');
      const key = `manual-reminder:${id}:${userId}:${requestId}`;
      if (data.requests[key]) return id;
      if (
        data.logs.some(
          (l) =>
            l.meetingId === id &&
            l.event === 'reminder' &&
            Date.parse(now(data)) - Date.parse(l.time) < 60000,
        )
      )
        throw new RuleError('리마인드를 보낸 후 1분 뒤 다시 시도해주세요.');
      recordEvent(data, meeting, 'reminder', now(data));
      data.requests[key] = id;
      return id;
    });
  },
  roomSchedule(userId: string, roomId: string, month: string) {
    return transact(
      userId,
      (data) => {
        const room = (data.rooms ?? rooms).find((item) => item.id === roomId);
        if (!room || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
          throw new RuleError('회의실과 조회 월을 확인해주세요.');
        return data.meetings
          .filter(
            (meeting) =>
              (meeting.roomId
                ? meeting.roomId === roomId
                : meeting.room === `${room.location} · ${room.name}`) &&
              dateKey(meeting.start).startsWith(month) &&
              meetingStatus(meeting, now(data)) === 'scheduled',
          )
          .toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start))
          .map((meeting) => {
            const topic = data.topics.find((item) => item.id === meeting.topicId);
            return {
              id: meeting.id,
              title: meeting.title,
              start: meeting.start,
              end: meeting.end,
              hostName:
                directory(data).find((person) => person.id === meeting.creatorId)?.name ??
                '알 수 없음',
              canOpen: Boolean(topic && canReadMeeting(topic, meeting, userId)),
            };
          });
      },
      false,
    );
  },
  availability(userId: string, roomId: string, date: string, exceptId?: string) {
    return transact(
      userId,
      (data) => {
        if (
          !(data.rooms ?? rooms).some((r) => r.id === roomId) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date)
        )
          return [];
        const blocked: string[] = [];
        for (
          let m = previewPolicy.startHour * 60;
          m < previewPolicy.endHour * 60;
          m += previewPolicy.slotMinutes
        ) {
          const format = (v: number) =>
            `${Math.floor(v / 60)
              .toString()
              .padStart(2, '0')}:${(v % 60).toString().padStart(2, '0')}`;
          const start = format(m),
            end = format(m + previewPolicy.slotMinutes);
          if (
            (data.now && Date.parse(`${date}T${start}:00+09:00`) < Date.parse(data.now)) ||
            roomConflicts(
              data,
              roomId,
              `${date}T${start}:00+09:00`,
              `${date}T${end}:00+09:00`,
              exceptId,
            )
          )
            blocked.push(start);
        }
        return blocked;
      },
      false,
    );
  },
  replaceFile(
    userId: string,
    id: string,
    attachmentId: string,
    file: Attachment,
    revision: number,
  ) {
    return transact(userId, (data) => {
      const { meeting } = requireMeeting(data, id, userId);
      requireRevision(meeting, revision);
      if (meeting.creatorId !== userId || meeting.cancelled || meeting.completed)
        throw new RuleError('자료를 교체할 권한이 없어요.');
      const index = meeting.attachments?.findIndex((a) => a.id === attachmentId) ?? -1;
      if (index < 0 || !meeting.attachments)
        throw new RuleError('최신 자료 목록을 다시 확인해주세요.');
      validateAttachment(file);
      meeting.attachments[index] = { ...file, authorId: userId, updatedAt: now(data) };
      meeting.files = meeting.attachments.map((a) => a.name);
      meeting.revision = revision + 1;
      recordEvent(data, meeting, 'materials', now(data));
      return id;
    });
  },
  snapshot(userId: string): Promise<Workspace> {
    return transact(
      userId,
      (data) =>
        visibleWorkspace({
          ...fixture,
          user: directory(data).find((p) => p.id === userId)!,
          people: directory(data),
          now: now(data),
          topics: data.topics,
          meetings: data.meetings,
        }),
      false,
    );
  },
  createTopic(
    userId: string,
    input: { title: string; description: string; managerIds: string[] },
    requestId: string,
  ) {
    return transact(userId, (data) => {
      if (data.requests[`${userId}:${requestId}`]) return data.requests[`${userId}:${requestId}`];
      if (!input.title.trim() || !input.description.trim())
        throw new RuleError('주제명과 한줄 설명을 입력해주세요.');
      if (input.managerIds.some((id) => !directory(data).some((p) => p.id === id)))
        throw new RuleError('관리자를 다시 선택해주세요.');
      const id = createId();
      const roles: Record<string, 'Owner' | 'Master'> = { [userId]: 'Owner' };
      input.managerIds.forEach((id) => {
        if (id !== userId) roles[id] = 'Master';
      });
      data.topics.push({
        id,
        title: input.title.trim(),
        description: input.description.trim(),
        icon: 'monitor',
        tone: 'blue',
        roles,
      });
      data.requests[`${userId}:${requestId}`] = id;
      return id;
    });
  },
  updateTopic(
    userId: string,
    id: string,
    input: {
      title: string;
      description: string;
      managerIds: string[];
      roles?: Record<string, Role>;
      expectedRoles?: Record<string, Role>;
    },
  ) {
    return transact(userId, (data) => {
      const topic = requireTopic(data, id, userId);
      if (topic.roles[userId] !== 'Owner') throw new RuleError('토픽 소유자만 변경할 수 있어요.');
      if (!input.title.trim() || !input.description.trim())
        throw new RuleError('주제명과 설명을 입력해주세요.');
      if (input.roles !== undefined) {
        const entries = Object.entries(input.roles);
        const expected = input.expectedRoles;
        if (
          !expected ||
          Object.keys(expected).length !== Object.keys(topic.roles).length ||
          Object.entries(topic.roles).some(([pid, role]) => expected[pid] !== role)
        )
          throw new RuleError('구성원 권한이 변경되었어요. 새로고침 후 다시 확인해주세요.');
        if (
          entries.filter(([, role]) => role === 'Owner').length !== 1 ||
          input.roles[userId] !== 'Owner'
        )
          throw new RuleError('토픽 생성자의 Owner 권한은 유지해야 해요.');
        if (
          entries.some(
            ([pid, role]) =>
              !directory(data).some((p) => p.id === pid) ||
              !['Owner', 'Master', 'Attendee'].includes(role),
          )
        )
          throw new RuleError('직원과 권한을 다시 확인해주세요.');
        topic.roles = Object.fromEntries(entries);
        topic.title = input.title.trim();
        topic.description = input.description.trim();
        return id;
      }
      if (
        Object.keys(topic.roles).some(
          (id) => topic.roles[id] === 'Master' && !input.managerIds.includes(id),
        )
      )
        throw new RuleError('기존 관리자 제거 정책은 아직 정해지지 않았어요.');
      topic.title = input.title.trim();
      topic.description = input.description.trim();
      input.managerIds.forEach((id) => {
        if (!directory(data).some((p) => p.id === id))
          throw new RuleError('직원을 다시 선택해주세요.');
        if (id !== userId) topic.roles[id] = 'Master';
      });
      return id;
    });
  },
  createMeeting(userId: string, input: MeetingInput, requestId: string) {
    return transact(userId, (data) => {
      if (data.requests[`${userId}:${requestId}`]) return data.requests[`${userId}:${requestId}`];
      const topic = requireTopic(data, input.topicId, userId);
      if (!canCreateMeeting(topic, userId))
        throw new RuleError('회의 관리자만 회의를 만들 수 있어요.');
      validateInput(input, data);
      if (input.participantIds.some((id) => !Object.hasOwn(topic.roles, id)))
        throw new RuleError('토픽에 포함된 사람만 참가자로 선택할 수 있어요.');
      validateSchedule(data, input.roomId, input.start, input.end, now(data));
      input.attachments.forEach(validateAttachment);
      const id = createId();
      const attachments = input.attachments.map((a) => ({
        ...a,
        authorId: userId,
        updatedAt: now(data),
      }));
      const meeting: Meeting = {
        id,
        topicId: topic.id,
        title: input.title.trim(),
        description: input.description,
        start: input.start,
        end: input.end,
        room: roomLabel(input.roomId, data.rooms),
        roomId: input.roomId,
        reminderMinutes: [...new Set(input.reminderMinutes ?? [])],
        creatorId: userId,
        participantIds: [...new Set([userId, ...input.participantIds])],
        files: attachments.map((a) => a.name),
        attachments,
        material: attachments.length ? 'uploaded' : input.material,
        completed: false,
        cancelled: false,
        revision: 0,
      };
      data.meetings.push(meeting);
      recordEvent(data, meeting, 'created', now(data));
      data.requests[`${userId}:${requestId}`] = id;
      return id;
    });
  },
  updateMeeting(userId: string, id: string, input: MeetingInput, revision: number) {
    return transact(userId, (data) => {
      const { meeting, topic } = requireMeeting(data, id, userId);
      requireRevision(meeting, revision);
      if (
        !canEditMeeting(topic, meeting, userId) ||
        meeting.completed ||
        meeting.cancelled ||
        Date.parse(meeting.end) <= Date.parse(now(data))
      )
        throw new RuleError('이 회의를 수정할 수 없어요.');
      validateInput(input, data);
      if (input.participantIds.some((id) => !Object.hasOwn(topic.roles, id)))
        throw new RuleError('토픽에 포함된 사람만 참가자로 선택할 수 있어요.');
      const ongoing = Date.parse(meeting.start) <= Date.parse(now(data));
      if (
        ongoing &&
        (input.start !== meeting.start ||
          input.roomId !== meeting.roomId ||
          Date.parse(input.end) <= Date.parse(now(data)))
      )
        throw new RuleError(
          '진행 중인 회의는 시작 시각·회의실을 유지하고 현재 이후의 종료 시각을 선택해주세요.',
        );
      validateSchedule(
        data,
        input.roomId,
        input.start,
        input.end,
        ongoing ? meeting.start : now(data),
        id,
      );
      const previous = meeting.participantIds;
      const previousMeeting = structuredClone(meeting);
      Object.assign(meeting, {
        title: input.title.trim(),
        description: input.description,
        start: input.start,
        end: input.end,
        room: roomLabel(input.roomId, data.rooms),
        roomId: input.roomId,
        participantIds: [...new Set([meeting.creatorId, ...input.participantIds])],
        reminderMinutes: [...new Set(input.reminderMinutes ?? meeting.reminderMinutes ?? [])],
        revision: revision + 1,
      });
      recordEvent(data, meeting, 'changed', now(data), previous, previousMeeting);
      return id;
    });
  },
  cancelMeeting(userId: string, id: string, revision: number) {
    return transact(userId, (data) => {
      const { meeting, topic } = requireMeeting(data, id, userId);
      requireRevision(meeting, revision);
      if (
        !canEditMeeting(topic, meeting, userId) ||
        meeting.completed ||
        meeting.cancelled ||
        Date.parse(meeting.end) <= Date.parse(now(data))
      )
        throw new RuleError('취소할 수 없는 회의입니다.');
      meeting.cancelled = true;
      meeting.revision = revision + 1;
      recordEvent(data, meeting, 'cancelled', now(data));
      return id;
    });
  },
  saveSummary(
    userId: string,
    id: string,
    summary: Omit<Summary, 'savedAt'>,
    complete: boolean,
    revision: number,
  ) {
    return transact(userId, (data) =>
      saveSummary(data, id, userId, summary, complete, now(data), revision),
    );
  },
  addFiles(userId: string, id: string, files: Attachment[], revision: number) {
    return transact(userId, (data) => {
      const { meeting } = requireMeeting(data, id, userId);
      requireRevision(meeting, revision);
      if (meeting.creatorId !== userId || meeting.cancelled || meeting.completed)
        throw new RuleError(
          '미리보기에서는 미완료 회의의 생성자만 자료를 등록할 수 있어요. 실제 편집 정책은 확정 전입니다.',
        );
      if (!files.length) throw new RuleError('등록할 자료를 선택해주세요.');
      files.forEach(validateAttachment);
      if (files.some((file) => meeting.attachments?.some((existing) => existing.id === file.id)))
        throw new RuleError('이미 등록한 자료입니다.');
      meeting.attachments = [
        ...(meeting.attachments ?? []),
        ...files.map((f) => ({ ...f, authorId: userId, updatedAt: now(data) })),
      ];
      meeting.files = meeting.attachments.map((a) => a.name);
      meeting.material = 'uploaded';
      meeting.revision = revision + 1;
      recordEvent(data, meeting, 'materials', now(data));
      return id;
    });
  },
  download(userId: string, meetingId: string, attachmentId: string) {
    return transact(
      userId,
      (data) => {
        const { meeting } = requireMeeting(data, meetingId, userId);
        const file = meeting.attachments?.find((a) => a.id === attachmentId);
        if (!file?.blob)
          throw new RuleError('예시 파일은 다운로드할 수 없어요. 직접 등록한 자료를 선택해주세요.');
        return file;
      },
      false,
    );
  },
  preferences(userId: string) {
    return transact(
      userId,
      (data) => data.preferences[userId] ?? structuredClone(defaultPreferences),
      false,
    );
  },
  savePreferences(userId: string, settings: NotificationSettings) {
    return transact(userId, (data) => {
      if (settings.reminders.some((r) => !reminderChoices.includes(r)))
        throw new RuleError('리마인드 시점을 다시 선택해주세요.');
      data.preferences[userId] = {
        ...data.preferences[userId],
        materials: Boolean(settings.materials),
        summary: Boolean(settings.summary),
        reminders: [...new Set(settings.reminders)],
      };
      return true;
    });
  },
  meetingDelivery(userId: string, id: string) {
    return transact(
      userId,
      (data) => {
        requireMeeting(data, id, userId);
        const logs = data.logs.filter(
          (log) =>
            log.meetingId === id &&
            ['created', 'changed', 'cancelled', 'reminder'].includes(log.event),
        );
        logs.sort(
          (a, b) =>
            a.time.localeCompare(b.time) || (a.relay?.sequence ?? 0) - (b.relay?.sequence ?? 0),
        );
        const last = logs.at(-1);
        const latest = last?.batchId ? logs.filter((log) => log.batchId === last.batchId) : logs;
        return latest.map(({ result, event }) => ({ result, event }));
      },
      false,
    );
  },
  adminLogs(userId: string) {
    return transact(
      userId,
      (data) => {
        if (!directory(data).find((p) => p.id === userId)?.isAdmin)
          throw new RuleError('운영 관리자만 접근할 수 있어요.');
        return data.logs.map(({ payload: _payload, relay: _relay, ...log }) => log);
      },
      false,
    );
  },
};
export interface MeetingInput {
  reminderMinutes?: number[];
  topicId: string;
  title: string;
  description: string;
  roomId: string;
  start: string;
  end: string;
  participantIds: string[];
  material: Meeting['material'];
  attachments: Attachment[];
}
function validateInput(input: MeetingInput, data: PreviewDatabase) {
  if (
    input.reminderMinutes !== undefined &&
    (!Array.isArray(input.reminderMinutes) ||
      input.reminderMinutes.some((n) => !meetingReminderChoices.includes(n)))
  )
    throw new RuleError('리마인드 시점을 다시 선택해주세요.');
  if (!input.title.trim() || !input.description.trim())
    throw new RuleError('회의명과 회의 내용을 입력해주세요.');
  if (input.participantIds.some((id) => !directory(data).some((p) => p.id === id)))
    throw new RuleError('참가자를 다시 선택해주세요.');
  if (input.material === 'uploaded' && !input.attachments.length)
    throw new RuleError('첨부할 자료를 선택해주세요.');
  if (input.material !== 'uploaded' && input.attachments.length)
    throw new RuleError('자료 상태를 다시 확인해주세요.');
}

function validateAttachment(file: Attachment) {
  if (!file.name.trim() || !file.id || !(file.blob instanceof Blob) || file.size !== file.blob.size)
    throw new RuleError('파일을 읽지 못했어요. 다시 선택해주세요.');
}

// Tests retain an isolated browser DB. The application uses the shared SQLite API.
export const fixtureMode =
  import.meta.env?.MODE === 'test' || import.meta.env?.VITE_DATA_MODE === 'fixture';
export const previewService: typeof localService =
  typeof window === 'undefined' || fixtureMode
    ? localService
    : new Proxy(localService, {
        get(_target, method: string) {
          return async (...args: unknown[]) => {
            const response = await fetch('/api/demo/' + method, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(await encodeWire(args)),
            });
            const body = await response.json();
            if (!response.ok) throw new RuleError(body.error ?? 'DB 요청을 처리하지 못했어요.');
            return decodeWire(body.result);
          };
        },
      });
