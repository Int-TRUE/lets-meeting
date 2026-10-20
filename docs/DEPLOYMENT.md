# 배포 운영 지침

## 작업 완료 기준

사용자 승인 범위에 따라 커밋·push·PR·CI 확인·병합·Vercel 배포 확인을 연속으로 진행한다. 기존 Vercel 프로젝트를 재사용하며 Git 연동으로 작업 브랜치 Preview, `master` Production을 배포한다. PR의 CI가 통과한 변경만 병합한다. 배포 READY와 커밋 일치를 확인한 후 화면·API·DB를 실제 주소에서 확인한다.

## 현재 연결 상태

- GitHub: `Int-TRUE/lets-meeting`, 기본 브랜치 `master`.
- GitHub Actions: `.github/workflows/check.yml`에서 빌드·단위/DB·브라우저 검사를 실행한다.
- 사용자 지정 대상: [kftcstudy-7531 / robot-butler](https://vercel.com/kftcstudy-7531/robot-butler). 이 프로젝트를 재사용한다.
- 프로젝트 ID: `prj_XOLCtuKhMZozNq4Xoj91Sgaibdrx`, 계정 ID: `team_MVjL0k7VQYNBQTTHgIdchurd`. 프로젝트 조회 응답의 이름·계정과 사용자 지정 주소가 일치한다. 확인 당시 배포는 없었다.
- 연결된 Vercel 도구에서 해당 팀 범위를 명시하면 `403 forbidden`이 반환된다. 저장소 연결 시에는 GitHub Login Connection 필요 오류가 발생했다. 같은 팀에 대한 CLI 대체 조회도 로그인 정보가 없어 진행하지 못했다. 팀 접근 권한과 GitHub 연결을 확인해야 한다.
- 초기에는 새 프로젝트 생성 승인을 받아 위 ID의 프로젝트를 생성했다. 사용자가 같은 주소를 지정했으므로 추가 프로젝트를 만들지 않는다. 아직 Git 연결과 배포는 완료되지 않았다.

## 배포 전 필요한 구성

현재 SQLite API는 Vite 개발 서버에만 연결되어 있다. Vercel 정적 배포에는 API가 포함되지 않는다. 실제 배포에는 서버 API와 영속 DB 연결을 구성하고, 회의 생성·재조회·파일 다운로드를 확인해야 한다. 브라우저별 임시 저장소로 조용히 대체하거나 Vercel 임시 파일시스템을 영속 DB로 사용하지 않는다.

Vercel 프로젝트의 Git 설정에서 `Int-TRUE/lets-meeting` 연결과 Production Branch `master`를 확인한다. GitHub Actions 검사 통과 후 병합하는 흐름을 유지하고, 추가적인 강제 배포 차단 기능을 구성했다면 실제 적용 여부까지 확인한다. 문서에 규칙을 쓰는 것과 배포 연동을 활성화하는 것은 별개이며, 연결 전에는 CI/CD 구축 완료라고 보고하지 않는다.

Git 연동이 활성화되면 일반 배포에 별도 GitHub Actions용 Vercel 토큰을 추가하지 않는다. 운영 비밀값은 Vercel의 해당 환경에 저장하며 저장소에 커밋하지 않는다.
