import type { Person } from '../domain/models.js';

export const testAccounts: Person[] = [
  { id: 'tester', name: '테스터', team: '테스트', isTestAccount: true },
  {
    id: 'taeheon',
    name: '태평양',
    team: '시스템관리팀',
    position: '차장',
    isTestAccount: true,
    isAdmin: true,
  },
  { id: 'sujin', name: '정금결', team: '정보개발팀', position: '대리', isTestAccount: true },
  { id: 'wooseok', name: '장금별', team: 'DevOps기술팀', position: '계장', isTestAccount: true },
  { id: 'jooyoung', name: '김금달', team: 'CMS개발팀', position: '계장', isTestAccount: true },
];

// Fictional directory entries for participant selection, separate from sign-in accounts.
const employees = [
  ['시스템관리팀', '팀장', '박성민'],
  ['시스템관리팀', '과장', '이준호'],
  ['시스템관리팀', '계장', '최유진'],
  ['시스템관리팀', '대리', '한지훈'],
  ['정보개발팀', '팀장', '윤서영'],
  ['정보개발팀', '차장', '강민석'],
  ['정보개발팀', '과장', '조은지'],
  ['정보개발팀', '계장', '임도현'],
  ['DevOps기술팀', '팀장', '오현우'],
  ['DevOps기술팀', '차장', '신예린'],
  ['DevOps기술팀', '과장', '송지호'],
  ['DevOps기술팀', '대리', '배수아'],
  ['CMS개발팀', '팀장', '서정훈'],
  ['CMS개발팀', '차장', '유나영'],
  ['CMS개발팀', '과장', '문태영'],
  ['CMS개발팀', '대리', '백소연'],
  ['IT운영팀', '과장', '권재민'],
  ['IT운영팀', '계장', '남하린'],
  ['보안관리팀', '과장', '홍승현'],
  ['서비스기획팀', '대리', '안세은'],
];
export const testDirectory: Person[] = [
  ...testAccounts,
  ...employees.map(([team, position, name], i) => ({
    id: `employee-${String(i + 1).padStart(2, '0')}`,
    team,
    position,
    name,
  })),
];
