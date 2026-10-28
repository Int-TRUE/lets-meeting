# 시연 계정 표시명 업데이트 운영 절차

현재 대상은 자체 서버 `http://100.123.150.118:8088`이다. 실제 서버 접근이 실패해 이 릴리스는 서버에 적용하지 않았다. Mattermost 계정 변경도 실행하지 않았다.

## 앱 배포

1. `docs/SELFHOST.md`의 기존 설치 디렉터리에서 `deployment-version.json`의 커밋을 확인한다. 새 묶음에 없는 서버 전용 수정이 있으면 배포를 중단하고 비교한다. 새 설치나 seed 버전 변경을 실행하지 않는다.
2. `.env.selfhost`를 권한 600으로 백업하고 `./butler exec -T db pg_dump -U butler -d robot_butler -Fc` 결과를 비공개 백업 파일에 저장한다. 현재 앱 이미지 ID에 별도 백업 태그를 붙인다. 기존 소스도 별도 경로에 보존한다.
3. 제공된 압축의 SHA-256을 확인하고 기존 설치 폴더에 소스만 적용한다. 묶음은 환경설정과 DB를 포함하지 않는다. `sudo ./butler build app` 후 `sudo ./butler up -d --no-deps --force-recreate --wait app`을 실행한다.
4. `/healthz`와 `/api/demo/directory`를 확인한다. 표시명 네 개와 기존 Topic·회의·첨부·권한을 확인한다. 실패하면 백업한 소스와 앱 이미지를 복원해 같은 Compose 프로젝트를 재실행한다. 이름만 갱신하는 변경이므로 DB 전체 복원은 일반 롤백에 필요하지 않다. DB 복원이 필요하면 앱을 중지하고 백업 이후 새 데이터를 별도로 보존한 뒤 운영자가 수행한다.

## Mattermost 프로필

서버 접근 복구 후 관리 권한으로 다음을 진행한다. 봇 토큰에 관리 권한이 있다고 가정하지 않는다.

- 앱의 기존 `MATTERMOST_USER_MAP`으로 네 대상의 실제 user_id를 확인한다. 기존 매핑은 변경하지 않는다.
- 변경 전 각 계정의 username, nickname, first_name, last_name, roles와 팀·채널 멤버십을 비공개로 백업한다. 목표 username의 중복 여부를 네 계정 모두 사전 확인한다.
- 기존 user_id에 프로필 패치만 적용한다. 정금결: `jeong`, nickname `정금결`, first_name `금결`, last_name `정`. 김금달: `kim`, nickname `김금달`, first_name `금달`, last_name `김`. 태평양: `tae`, nickname `태평양`, first_name `평양`, last_name `태`. 장금별: `jang`, nickname `장금별`, first_name `금별`, last_name `장`.
- 계정 삭제·재생성, 비밀번호·이메일·roles 수정은 하지 않는다. 중복 또는 인증 오류가 나면 해당 계정을 변경하지 않고 결과를 기록한다. 이전 값 복원이 필요할 때도 같은 user_id에 프로필만 패치한다.
- 재조회로 user_id·roles·멤버십 보존, 새 username 조회와 표시명을 확인한다. 기존 메시지 원문은 수정하지 않는다. 관리 권한 검증 전에는 변경을 시도하지 않는다.
- 앱의 디렉터리·기존 Topic 권한·알림 계정 매핑을 확인하고 승인된 시연 회의에서 초대·리마인드 DM 및 링크·버튼을 확인한다. 이 단계가 끝나기 전 실제 연동 검증 완료로 보고하지 않는다.

과거 캡처·영상·메시지 본문·개인 입력에는 이전 이름이 남을 수 있다. 시연 녹화 전 표시 화면을 확인하고 캡처를 새로 만든다. Git 이력이나 기존 배포 백업은 덮어쓰지 않는다.
