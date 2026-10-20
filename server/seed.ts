import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initialDatabase } from '../src/data/previewService.js';
import type { Meeting, PreviewDatabase, Topic } from '../src/domain/models.js';

export function demoSeed(): PreviewDatabase {
  const db = initialDatabase();
  const topics: Topic[] = [
    {
      id: 'it-2026',
      title: '2026년 IT운영팀 팀 회의',
      description: '야간근무와 업무분장을 함께 정리하는 IT운영팀의 연속 회의',
      icon: 'people',
      tone: 'blue',
      roles: {
        kang: 'Owner',
        jin: 'Master',
        yoseop: 'Master',
        me: 'Attendee',
        nahyung: 'Attendee',
      },
    },
    {
      id: 'autopay',
      title: '자동이체통합관리 동의자료 보관',
      description: '서버 inode 확보와 동의자료 보관 경로를 장기 추적합니다.',
      icon: 'chart',
      tone: 'mint',
      roles: {
        yoseop: 'Owner',
        kang: 'Master',
        jin: 'Master',
        me: 'Attendee',
        nahyung: 'Attendee',
      },
    },
    {
      id: 'equipment-2026',
      title: '2026년 전산기기교체',
      description: '장비 수요부터 교체·검수까지 관리하는 전산기기교체 프로젝트',
      icon: 'monitor',
      tone: 'blue',
      roles: {
        seungho: 'Owner',
        juhyung: 'Master',
        seungyeop: 'Master',
        nahyung: 'Attendee',
        me: 'Attendee',
      },
    },
  ];
  const make = (
    id: string,
    topicId: string,
    title: string,
    date: string,
    hour: string,
    creatorId: string,
    participantIds: string[],
    description: string,
    decisions: string,
    roomId = 'it-room',
    hostAtTime?: string,
  ): Meeting => ({
    id,
    topicId,
    title,
    description,
    start: `${date}T${hour}:00:00+09:00`,
    end: `${date}T${String(Number(hour) + 1).padStart(2, '0')}:00:00+09:00`,
    room: roomId === 'it-room' ? '명동 · IT운영팀 회의실' : '명동 · 12층 회의실',
    roomId,
    creatorId,
    participantIds,
    files: [],
    material: 'none',
    completed: date < '2026-10-20',
    cancelled: false,
    revision: 0,
    hostAtTime,
    updatedAt: `${date}T18:00:00+09:00`,
    summary: decisions
      ? {
          discussion: description,
          decisions,
          nextSteps: '다음 회의에서 진행 상황과 담당자별 조치 결과를 확인합니다.',
          savedAt: `${date}T18:00:00+09:00`,
        }
      : undefined,
  });
  const meetings = [
    make(
      'it-night',
      'it-2026',
      '야간근무 관련 회의',
      '2026-05-16',
      '10',
      'kang',
      ['kang', 'jin', 'yoseop', 'nahyung', 'me'],
      '야간근무 체계 및 데브옵스 전환 대상 운영자 참여 논의',
      '1월 인사 전으로 데브옵스 전환 대상 운영자 꼭 들어가기',
      'it-room',
      '강경희 팀장 · IT운영팀',
    ),
    make(
      'it-roles',
      'it-2026',
      '업무분장 관련 회의',
      '2026-05-16',
      '14',
      'jin',
      ['jin', 'kang', 'yoseop', 'nahyung', 'me'],
      '이전 야간근무 회의 안건을 확인하고 운영 업무분장 논의',
      '3명씩 업무분장을 묶기로 함.',
      'it-room',
      '진상현 팀장 · IT운영팀',
    ),
    make(
      'autopay-prov2',
      'autopay',
      '자동이체통합관리 서버 inode수 확보',
      '2023-06-16',
      '10',
      'yoseop',
      ['yoseop', 'kang', 'me'],
      '자동이체 동의자료 보관량 증가에 따른 inode수 확보',
      '/prov2를 만들자.',
      'floor-12',
      '김요섭 계장 · 정보개발팀',
    ),
    make(
      'autopay-prov3',
      'autopay',
      '자동이체통합관리 서버 inode수 확보',
      '2025-11-20',
      '14',
      'yoseop',
      ['yoseop', 'jin', 'nahyung', 'me'],
      '2023년 /prov2 도입 이력을 확인하고 추가 저장 경로 검토',
      '/prov3를 만들자.',
      'floor-12',
      '김요섭 대리 · IT운영팀',
    ),
    make(
      'equipment-demand',
      'equipment-2026',
      '교체 대상 장비 수요 조사',
      '2026-09-15',
      '10',
      'juhyung',
      ['juhyung', 'nahyung', 'me'],
      '노후 단말과 업무별 성능 요구사항을 수집합니다.',
      '교체 우선순위는 노후도와 업무 영향도를 기준으로 확정합니다.',
    ),
    make(
      'equipment-vendor',
      'equipment-2026',
      '공급사 일정·예산 검토',
      '2026-10-05',
      '14',
      'seungyeop',
      ['seungyeop', 'nahyung'],
      '공급사 견적과 부서별 도입 일정을 비교합니다.',
      '1차 물량과 예비 물량을 구분합니다.',
    ),
    make(
      'equipment-today',
      'equipment-2026',
      '전산기기 교체 · 2차 실무 회의',
      '2026-10-20',
      '14',
      'juhyung',
      ['juhyung', 'seungyeop', 'nahyung', 'me'],
      '실제 교체 일정과 부서별 준비 사항을 확인합니다.',
      '',
      'floor-12',
    ),
    make(
      'it-checkin',
      'it-2026',
      '야간 운영 전환 점검',
      '2026-10-20',
      '10',
      'jin',
      ['jin', 'kang', 'me'],
      '전환 대상자의 업무 인수인계와 야간 대응 현황을 점검합니다.',
      '',
    ),
    make(
      'autopay-review',
      'autopay',
      '동의자료 보관 현황 점검',
      '2026-10-20',
      '16',
      'yoseop',
      ['yoseop', 'me'],
      '/prov2와 /prov3 사용량 및 보존 정책을 점검합니다.',
      '',
      'floor-12',
    ),
    make(
      'equipment-inspect',
      'equipment-2026',
      '1차 교체 장비 검수',
      '2026-10-23',
      '10',
      'seungyeop',
      ['seungyeop', 'me'],
      '교체 장비의 설치 상태와 사용자 확인 사항을 검수합니다.',
      '',
    ),
  ];
  for (const [id, year] of [
    ['autopay-prov2', '2023'],
    ['autopay-prov3', '2025'],
  ]) {
    const m = meetings.find((m) => m.id === id)!;
    const bytes = readFileSync(resolve(`server/fixtures/autopay-${year}.pdf`));
    const name = `자동이체_동의자료_보관_${year}.pdf`;
    m.attachments = [
      {
        id: `file-${id}`,
        name,
        type: 'application/pdf',
        size: bytes.length,
        authorId: 'yoseop',
        updatedAt: m.start,
        blob: new Blob([bytes], { type: 'application/pdf' }),
      },
    ];
    m.files = [name];
    m.material = 'uploaded';
  }
  db.topics.push(...topics);
  db.meetings.push(...meetings);
  return db;
}
