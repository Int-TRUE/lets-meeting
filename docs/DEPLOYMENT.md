# 배포 운영 지침

## 현재 배포 기준 — 2026-10-27

실제 서비스는 `http://100.123.150.118:8088`의 자체 서버다. 이후 Vercel 배포 상태를 서비스 반영 완료 기준으로 사용하지 않는다. 서버 업데이트는 [SELFHOST.md](SELFHOST.md)를 따른다.

2026-10-26 서버 릴리스 `9eddbe7`에는 당시 원격 기본 브랜치에 없던 히스토리 보기·검색·필터, 리마인드 디자인, 변경 기반 알림 예약이 포함됐다. 이를 확인하지 않고 `b46ffc7` 전체 소스를 배포하도록 안내해 해당 기능이 이전 구현으로 돌아가는 문제가 생겼다. 복구 시 이 변경들과 이후 기본 브랜치의 문구·토픽 역할 변경을 함께 통합한다.

후속 배포 전 서버의 `deployment-version.json`, 기존 배포 묶음 및 로컬 전용 커밋을 원격 기본 브랜치와 비교한다. 기본 브랜치가 서버보다 최신 기능을 모두 포함한다고 가정하지 않는다. DB·설정·기존 앱 이미지를 백업하고, 검증된 통합 버전을 배포한 뒤 실제 히스토리와 알림 예약 동작을 확인한다.

아래 Vercel 항목은 이전 운영 이력이다.

## 2026-10-26 — 사용자 서버로 이전

사용자가 Neon 데이터를 보존한 채 새 DB로 시작하고 로봇집사 웹·예약 알림·매터모스트 버튼 처리를 매터모스트 서버에 통합하도록 요청했다. 새 배포 대상은 `mattermost-admin@100.123.150.118`의 `robot-butler-direct` Compose 프로젝트이며 별도 중계기를 사용하지 않는다. [실행 명령과 운영 안내](SELFHOST.md)를 따른다. 실제 서버 설치는 사용자가 실행하며 완료 전에는 이전 완료로 표시하지 않는다. Vercel Git 배포는 기존 프로젝트에 남지만 이번 서버 이전의 완료 기준을 대신하지 않으며, 기존 Neon 장애를 새 데이터로 숨기거나 초기화하지 않는다.

## 배포 대상과 완료 기준

- GitHub: `Int-TRUE/lets-meeting`, 기본 브랜치 `master`.
- Vercel: [kftcstudy-7531 / robot-butler](https://vercel.com/kftcstudy-7531/robot-butler).
- 프로젝트 ID: `prj_XOLCtuKhMZozNq4Xoj91Sgaibdrx`, 팀 ID: `team_MVjL0k7VQYNBQTTHgIdchurd`.
- 정식 주소: https://robot-butler.vercel.app/

검증·push·PR·CI 통과 확인·병합·Vercel 배포 확인을 별도 승인 없이 연속 진행한다. Git 연동은 작업 브랜치 Preview, `master` Production 자동 배포로 동작한다. 2026-10-22 마스코트 보완 PR #12에서 Git 소스의 Preview·병합 후 Production 모두 READY와 커밋 일치를 확인했다. 앞선 로그인 릴리스는 자동 이벤트가 생성되지 않아 CI 통과 후 CLI로 배포한 이력이 있다. 후속 작업은 자동 배포 여부를 우선 확인하고, 생성되지 않은 커밋만 직접 배포한다. 같은 커밋을 CLI로 중복 배포하지 않는다. 배포 READY와 커밋 일치, 실제 화면·API·DB 확인까지 완료 기준으로 삼는다. Vercel의 기존 배포 보호는 유지한다.

2026-10-22 확인 시 Git 연결의 배포 생성(`gitProviderOptions.createDeployments`)이 꺼져 있어 `enabled`로 복구했다. 후속 push와 병합에서 Preview·Production 자동 배포 생성을 확인한다.

초기 계정 연결 오류는 해결됐다. GitHub Actions의 `verify`는 빌드·단위/SQLite/PostgreSQL·브라우저 검사를 수행한다. PostgreSQL 검사는 CI의 별도 PostgreSQL 서비스에서 실행해 운영 DB를 건드리지 않는다. 검사 통과를 확인하고 병합하는 규칙이며, Vercel의 추가 Deployment Checks를 구성했다고 주장하지 않는다.

## 서버와 영속 DB

`api/demo.ts`는 Vercel Node Function이다. `vercel.json`에서 `/api/demo/*`를 함수로 전달하고, 실제 정적 파일 이후 나머지 경로를 SPA로 전달한다. 하위 화면 새로고침도 동작한다.

`robot-butler-db`는 Vercel Marketplace로 연결한 Neon Free 플랜이며 리전은 Singapore다. 함수도 `sin1`에서 실행한다. API는 풀 연결 `DATABASE_URL`, 초기 스키마 생성은 직접 연결 `DATABASE_URL_UNPOOLED`를 사용한다. 변수는 Marketplace가 Production/Preview/Development에 주입한다. `.env.local`, `.vercel/` 및 비밀값은 커밋하지 않는다.

환경별 스키마는 `butler_production`, `butler_development`, `butler_preview_<브랜치 해시>`다. 미리보기 브랜치 간에도 데이터가 분리된다. Preview에서 브랜치 정보가 없으면 운영 데이터로 대체하지 않고 오류를 반환한다. 같은 PostgreSQL 리소스 안의 논리적 분리이며 별도 DB 계정에 의한 보안 경계는 아니다.

최초 요청에서 버전 관리된 스키마를 트랜잭션으로 준비한다. seed 버전 3은 사용자 요청에 따라 계정·활동 데이터를 한 번 초기화하고 테스트 계정 4명과 참가 직원 20명, 빈 Topic·회의로 전환한다. 기존 회의실은 그대로 보존한다. 재배포 시 기존 내용을 보존한다. DB 잠금은 권한·revision·중복 요청·예약 충돌 검사부터 자료 저장까지 감싸므로 함수 인스턴스가 달라도 일관성을 유지한다. 첨부는 메타데이터와 BYTEA로 보관한다. 현재 데모 규모에 맞춰 변경 시 전체 상태를 한 트랜잭션에서 갱신하며, 대용량 운영 서비스에서는 개별 행 갱신과 별도 파일 저장소로 확장해야 한다.

## 실행·확인

로컬 `npm run dev`는 SQLite를 유지하며 Vercel 환경변수를 읽어도 운영 DB로 자동 전환하지 않는다. 정적 `vite preview`에는 API가 없다. Vercel 함수 검증에는 `vercel build`와 Git Preview 배포를 사용한다.

실제 PostgreSQL 검사는 `POSTGRES_TEST_URL`을 지정하고 `npx vitest run server/postgres.test.ts`로 실행한다. 테스트는 `butler_test_<임의 값>` 스키마만 만들고 종료 시 제거한다. CI에서는 테스트 전용 연결만 사용한다. 배포 후 `/api/demo/directory`, 계정 선택, 빈 홈, 참가 직원 검색, Topic·회의 생성/재조회와 파일 다운로드를 확인한다. 쓰기 검증은 Preview에서만 수행하며 검증용 행은 제거해 정식 DB를 빈 상태로 제공한다.

요청 본문은 인코딩한 첨부를 포함해 3MiB로 제한한다. 약 2MiB 이하의 파일을 사용하는 데모 범위다. API 응답은 캐시하지 않으며 다른 Origin 요청을 거절한다. SQL 오류와 접속 비밀값은 브라우저에 반환하지 않는다.

## 서비스 범위

이 배포도 로그인 화면의 테스트 계정 선택을 제공하는 더미 데이터 데모다. Vercel 배포 보호는 앱의 직원 인증을 대신하지 않는다. 실제 직원 SSO·원텔 예약·Mattermost 발송은 미연결이며, 실제 업무 자료를 저장하는 운영 서비스 전환 전 별도 인증·권한 설계가 필요하다. 데모 사용자 선택을 실사용 인증으로 간주하지 않는다.

2026-10-24: CI의 브라우저 설치 지연을 피하기 위해 Ubuntu 24.04 러너에 기본 설치된 Chrome을 사용한다. 브라우저 버전을 먼저 확인하고 기존 화면·DB 검사는 모두 유지한다. 작업 제한 시간은 15분이다.

2026-10-24 후속 보완: Topic 구성원 제한과 회의실 일정 달력은 동일한 `robot-butler` Git 연동 프로젝트에 배포한다. `roomSchedule`은 센터/회의실·월 기준으로 모든 예정·진행 중 회의의 제목·시간·주최자와 상세 열람 가능 여부만 반환한다. 본문·자료는 기존 권한 API로 분리한다. 배포 검증 스크립트는 센터 필터·일정 조회·Topic 구성원 선택과 비참여자의 일정 조회를 확인한다.

## Mattermost 로컬 시연 — 2026-10-24

실제 발송은 Mac의 Vite/SQLite 서버에서만 활성화한다. Vercel에는 봇 비밀값을 추가하지 않으며 상태 조회·표시만 반영한다. Mac 서버를 외부에 노출하거나 Production의 가짜 세션으로 DM을 발송하지 않는다. 구성·검증·실패 처리는 [Mattermost 안내](MATTERMOST.md)를 따른다.

2026-10-24 중계 기능 후속: `api/mattermost-relay.ts`가 인증된 claim/ack를 제공하고 `api/demo.ts`는 활성화된 환경에서만 기존 PostgreSQL의 JSON 발송 기록에 대기를 저장한다. 스키마 변경은 없다. Production은 시연 참가자 허용 목록과 별도 중계 Secret을 사용하며 실제 봇 토큰은 Mac에만 보관한다. Preview는 `task/mattermost-relay`에 한정한 별도 Secret으로 검증한다. 기동·장애 복구는 [Mattermost 안내](MATTERMOST.md)를 따른다.

2026-10-24 Docker 중계기 전환: 기존 Vercel 중계 API·인증값은 유지한다. Mac의 중계기를 `relay` 컨테이너로 옮기고 매터모스트·DB와 함께 `restart: always`를 적용한다. `relay_state` 볼륨에 발송 기록을 보존하고, 정상 서버 조회 후 갱신하는 heartbeat로 Docker 건강 상태를 표시한다. 시작 파일은 Compose 실행 후 종료되며 터미널 유지가 필요 없다.

2026-10-24 지각·연장 알림: 중계 claim 요청에서 시작/종료 알림을 중복 없이 생성한다. `interact` 동작은 같은 중계 인증과 DB 트랜잭션을 사용한다. Mac 중계기는 Docker 내부 HTTP 콜백을 받아 수신자와 서명을 확인한다. 배포 후 시작 파일을 실행해 중계 이미지를 다시 빌드한다. 상세 운영·오프라인 동작은 [Mattermost 안내](MATTERMOST.md)에 기록했다.

2026-10-24 배너 교체: 승인된 회의실 배경의 손그림 4종을 `comic-v2` 경로로 배포한다. Production READY와 파일 일치를 확인한 뒤 Mac의 relay 컨테이너만 재빌드해 새 이미지 주소를 사용한다. 기존 메시지용 이미지와 매터모스트·DB 컨테이너는 유지한다.

2026-10-25 회의 편의 기능: 즐겨찾기는 기존 사용자 preferences JSON, 자동 리마인드와 후속 작업 체크리스트는 기존 meetings JSON에 저장한다. 별도 테이블이나 운영 데이터 초기화 없이 이전 데이터와 호환된다. Production 반영 후 Mac relay를 재빌드해 reminder 이벤트와 새 메시지·배너를 적용한다. 자동 리마인드의 시각 판정은 기존 중계 claim 요청에서 수행한다.

2026-10-26 HTTP 전환 승인: 자체 서버 로봇집사 주소는 `http://100.123.150.118:8088`. Tailscale Serve 관리 계정 없이 기존 DB와 봇 연결을 유지하는 업데이트 절차는 [서버 설치 문서](SELFHOST.md#이미-설치한-서버를-http로-업데이트)를 따른다. 실제 서버 적용은 운영자가 해당 명령을 실행한 뒤 확인한다.
