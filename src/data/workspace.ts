import type { Person, PreviewState, Workspace } from '../domain/models';
import { visibleWorkspace } from '../domain/selectors';
export const people: Person[] = [
  { id: 'kim', name: '김하늘', team: '디지털기획팀' },
  { id: 'lee', name: '이서준', team: '개발팀' },
  { id: 'park', name: '박지우', team: '디지털기획팀' },
  { id: 'choi', name: '최민준', team: '디자인팀' },
  { id: 'jung', name: '정수아', team: '마케팅팀' },
  { id: 'yoon', name: '윤도현', team: '개발팀' },
  { id: 'ops', name: '운영관리자', team: '서비스운영팀', isAdmin: true },
];
export const fixture: Workspace = {
  user: people[0],
  people,
  now: '2026-10-20T13:30:00+09:00',
  topics: [
    {
      id: 'system',
      title: '전산기기 교체',
      description: '더 나은 업무 환경을 위한\n전산 장비 교체 프로젝트',
      icon: 'monitor',
      tone: 'blue',
      roles: { kim: 'Owner', lee: 'Master' },
    },
    {
      id: 'brand',
      title: '브랜드 리뉴얼',
      description: '우리다운 브랜드를 함께 만드는\n2026 브랜드 리뉴얼 프로젝트',
      icon: 'chart',
      tone: 'mint',
      roles: { kim: 'Master', choi: 'Owner' },
    },
    {
      id: 'team',
      title: '하반기 조직 개편',
      description: '더 나은 팀을 위한\n조직 문화와 협업 방식 이야기',
      icon: 'people',
      tone: 'peach',
      roles: { kim: 'Attendee', jung: 'Owner' },
    },
  ],
  meetings: [
    {
      id: 'strategy',
      topicId: 'brand',
      title: '브랜드 방향성 정리',
      description: '브랜드 핵심 가치와 디자인 방향을 함께 정리합니다.',
      start: '2026-10-20T10:00:00+09:00',
      end: '2026-10-20T11:00:00+09:00',
      room: '명동 · 3층 회의실 A',
      creatorId: 'kim',
      participantIds: ['kim', 'choi', 'jung'],
      files: ['브랜드 방향성.pdf'],
      material: 'uploaded',
      completed: false,
      cancelled: false,
    },
    {
      id: 'equipment',
      topicId: 'system',
      title: '전산기기 교체 · 2차 실무 회의',
      description: '교체 대상 장비와 도입 일정을 확인하고, 부서별 준비 사항을 논의합니다.',
      start: '2026-10-20T14:00:00+09:00',
      end: '2026-10-20T15:00:00+09:00',
      room: '명동 · 9층 대회의실',
      creatorId: 'lee',
      participantIds: ['kim', 'lee', 'park', 'choi', 'jung', 'yoon'],
      files: ['장비 교체 계획.pdf', '부서별 수요.xlsx'],
      material: 'uploaded',
      completed: false,
      cancelled: false,
    },
    {
      id: 'culture',
      topicId: 'team',
      title: '조직문화 개선 아이디어 논의',
      description: '편하게 의견을 나누고 함께 일하는 방식을 고민합니다.',
      start: '2026-10-20T16:00:00+09:00',
      end: '2026-10-20T17:00:00+09:00',
      room: '분당 · 3층 회의실',
      creatorId: 'jung',
      participantIds: ['kim', 'jung', 'park'],
      files: [],
      material: 'none',
      completed: false,
      cancelled: false,
    },
    {
      id: 'inspection',
      topicId: 'system',
      title: '전산기기 교체 · 1차 현황 점검',
      description: '부서별 장비 현황 점검',
      start: '2026-10-13T10:00:00+09:00',
      end: '2026-10-13T11:00:00+09:00',
      room: '분당 · 3층 회의실',
      creatorId: 'kim',
      participantIds: ['kim', 'lee', 'park'],
      files: [],
      material: 'pending',
      completed: true,
      cancelled: false,
    },
    {
      id: 'restricted',
      topicId: 'team',
      title: '비공개 인사 논의',
      description: '참가자 외 조회할 수 없는 회의',
      start: '2026-10-20T15:00:00+09:00',
      end: '2026-10-20T16:00:00+09:00',
      room: '명동 · 비공개 회의실',
      creatorId: 'jung',
      participantIds: ['jung'],
      files: ['비공개 자료.pdf'],
      material: 'uploaded',
      completed: false,
      cancelled: false,
    },
  ],
};
export class WorkspaceError extends Error {
  constructor(public kind: 'error' | 'forbidden' | 'expired') {
    super(kind);
  }
}
// This is a preview adapter, not an authentication or production authorization boundary.
export interface WorkspaceRepository {
  load(signal: AbortSignal): Promise<Workspace>;
}
export function createPreviewRepository(state: PreviewState, userId: string): WorkspaceRepository {
  return {
    async load(signal) {
      await new Promise<void>((resolve, reject) => {
        const id = setTimeout(resolve, state === 'loading' ? 60_000 : 180);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(id);
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });
      if (state === 'error' || state === 'forbidden' || state === 'expired')
        throw new WorkspaceError(state);
      const user = people.find((p) => p.id === userId) ?? people[0];
      return visibleWorkspace({
        ...fixture,
        user,
        topics: state === 'empty' ? [] : fixture.topics,
        meetings: state === 'empty' || state === 'empty-meetings' ? [] : fixture.meetings,
      });
    },
  };
}
