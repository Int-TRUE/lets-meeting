# 데모 데이터베이스

## 실행과 저장

Node 22.14 이상에서 `npm install` 후 `npm run dev -- --port 4174`를 실행한다. 앱이 `data/robot-butler.sqlite`를 처음 한 번 생성하고 사례를 넣는다. SQLite DB는 로컬 실행 파일이며 Git에서 제외한다. 재시작 시 입력을 덮어쓰지 않는다. `ROBOT_BUTLER_DB`로 별도 DB 경로를 지정할 수 있다. 초기 데이터와 PDF 원본은 `server/seed.ts`, `server/fixtures`에 버전 관리한다.

화면은 `/api/demo`를 통해 같은 DB를 조회·수정한다. 브라우저별 IndexedDB는 `VITE_DATA_MODE=fixture`인 기존 격리 테스트에서만 사용한다. API 오류 때 임의의 화면 데이터로 대체하지 않는다. 디렉터리와 회의실 목록도 DB에서 읽는다.

## 구성

- people 15명, rooms 5개, topics 6개, meetings 15개가 초기 데이터다.
- topics/topic_members, meetings/meeting_participants로 관계를 저장한다. 회의·주제의 부가 필드는 JSON이며 사람·참가·권한·파일 관계는 외래키로 검증한다.
- attachments는 메타데이터와 실제 BLOB을 보관한다. preferences, delivery_logs, requests를 별도 테이블에 저장한다.
- SQLite 트랜잭션과 요청 직렬화, request ID 중복 방지, 회의 revision 및 예약 충돌 검사를 적용한다.
- 사용자 제공 사례의 참가자 중 “누구누구”는 데모 인물로 채웠다. 실제 참석 사실을 뜻하지 않는다.
- IT운영팀: 2026-05-16 강경희/진상현 주최 회의와 후속 점검.
- 자동이체: 2023-06-16 `/prov2`, 2025-11-20 `/prov3` 및 후속 점검. 김요섭의 당시 소속·직급을 `hostAtTime`에 보존. 각 연도 PDF는 실제 열리는 더미 문서다.
- 전산기기교체: 최승호 Owner, 김주형/이승엽 Master, 박나형/나(데모) Attendee. 수요·공급사·실무·검수 회의를 생성했다.

## 권한과 확인

기본 데모 사용자는 `나(데모)`다. 화면 아래 **미리보기 상태 → 예시 사용자**에서 바꿀 수 있다. 기존 브라우저의 선택은 유지된다. 두 Master는 전산기기교체 전체 이력을 볼 수 있으며 참가자는 참석 회의만 본다. API에서도 자료 다운로드·회의 수정 권한을 확인한다. 주최자가 바뀌어도 같은 Topic 이력을 유지한다.

Owner의 위임·삭제는 기존 화면에서 아직 준비 중이다. 이 데이터 작업으로 실제 삭제·위임 정책을 자동 확정하지 않았다. “관리팀 전체 참조”도 자동 부여하지 않았다. 향후 참조는 편집 권한인 Master와 분리한 읽기 전용 권한으로 두는 것이 적절하다.

## 배포 환경

Vercel 배포에서는 `api/demo.ts`와 `server/postgres.ts`가 같은 도메인 API를 Neon PostgreSQL에 연결한다. 로컬 SQLite와 영속 데이터는 별개이며, 같은 중앙 seed를 사용한다. Production·Preview 브랜치·Development 스키마를 분리한다. 배포의 환경변수·리전·검증은 [배포 운영 지침](DEPLOYMENT.md)을 따른다.

## 실행 범위

로컬 API는 loopback 전용이며 배포 API도 더미 데이터 데모 범위다. 사용자 선택은 테스트 편의를 위한 것으로 실제 인증이 아니다. loopback Host와 동일 Origin을 검사하지만 운영 인증을 대체하지 않는다. 실제 SSO, 원텔 예약, Mattermost 발송은 연결하지 않았다. 생성 완료의 예약은 DB에 저장한 데모 일정이며 초대 알림은 미전송으로 표시한다. `vite preview` 또는 정적 배포에는 이 개발 API가 없으므로 Vercel 배포는 별도 Node Function과 Neon DB로 동작한다.

## 검증

`npm run check`: 단위·SQLite 20개, 기존 PC/태블릿/모바일 브라우저 52개, 별도 SQLite 브라우저 1개. 데스크톱 전용 비교 테스트의 다른 viewport 실행 2개는 제외된다.

SQLite 검사는 초기화 중복 방지, 재시작 보존, 주최자·직급 이력, Master/참가자 구분, PDF 바이트, 잘못된 권한, 동시 생성 중복을 검증한다. 별도 브라우저 검사는 API 조회→화면→회의 생성→파일 저장→다른 브라우저에서 다운로드까지 수행한다. 테스트용 DB와 실제 로컬 DB는 분리한다.
