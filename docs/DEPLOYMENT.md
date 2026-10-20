# 배포 운영 지침

## 작업 완료 기준

사용자 승인 범위에 따라 커밋·push·PR·CI 확인·병합·Vercel 배포 확인을 연속으로 진행한다. 기존 Vercel 프로젝트를 재사용하며 Git 연동으로 작업 브랜치 Preview, `master` Production을 배포한다. PR의 CI가 통과한 변경만 병합한다. 배포 READY와 커밋 일치를 확인한 후 화면·API·DB를 실제 주소에서 확인한다.

## 현재 연결 상태

- GitHub: `Int-TRUE/lets-meeting`, 기본 브랜치 `master`.
- GitHub Actions: `.github/workflows/check.yml`에서 빌드·단위/DB·브라우저 검사를 실행한다.
- 사용할 기존 Vercel 프로젝트: 사용자에게 주소 확인 중. 프로젝트 확인 전 임의로 배포 대상을 확정하지 않는다.
- 연결된 Vercel 도구에서는 기존 프로젝트가 조회되지 않았으며, 저장소 연결 시 GitHub Login Connection 필요 오류가 발생했다. CLI에는 로그인 정보가 없었다.
- 사용자에게 새 프로젝트 생성 승인을 받은 시점에 `robot-butler` (`prj_XOLCtuKhMZozNq4Xoj91Sgaibdrx`)를 생성했다. 이후 기존 프로젝트가 있다는 정정에 따라 새 프로젝트에는 배포하지 않았다. 기존 프로젝트 연결과 혼동하지 않는다.

## 배포 전 필요한 구성

현재 SQLite API는 Vite 개발 서버에만 연결되어 있다. Vercel 정적 배포에는 API가 포함되지 않는다. 실제 배포에는 서버 API와 영속 DB 연결을 구성하고, 회의 생성·재조회·파일 다운로드를 확인해야 한다. 브라우저별 임시 저장소로 조용히 대체하거나 Vercel 임시 파일시스템을 영속 DB로 사용하지 않는다.

Vercel 프로젝트의 Git 설정에서 `Int-TRUE/lets-meeting` 연결과 Production Branch `master`를 확인한다. GitHub Actions 검사 통과 후 병합하는 흐름을 유지하고, 추가적인 강제 배포 차단 기능을 구성했다면 실제 적용 여부까지 확인한다. 문서에 규칙을 쓰는 것과 배포 연동을 활성화하는 것은 별개이며, 연결 전에는 CI/CD 구축 완료라고 보고하지 않는다.

Git 연동이 활성화되면 일반 배포에 별도 GitHub Actions용 Vercel 토큰을 추가하지 않는다. 운영 비밀값은 Vercel의 해당 환경에 저장하며 저장소에 커밋하지 않는다.
