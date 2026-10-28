# 서버 실행: 앱 업데이트와 시연 계정 4명 변경

이 절차는 기존 자체 서버의 `robot-butler-direct` 설치와 DB·Mattermost를 유지한다. 새 설치, 계정 생성, DB 초기화, 메시지 수정, 권한 변경을 실행하지 않는다. 서버 실행 전까지 실제 반영 완료가 아니다.

## 파일 복사·검증

맥에서 준비된 묶음을 복사한다.

```bash
cd "/Users/sujin/Documents/ChatGPT/바코챌 2/output"
scp server-account-update-20261028.tar.gz server-account-update-20261028.tar.gz.sha256 mattermost-admin@100.123.150.118:~/
ssh mattermost-admin@100.123.150.118
```

이후는 서버의 대화형 터미널에서 실행한다. 이미 같은 압축 해제 폴더가 있으면 덮어쓰지 말고 먼저 기존 실행 결과를 확인한다.

```bash
cd ~
sha256sum -c server-account-update-20261028.tar.gz.sha256
test ! -e server-account-update-20261028
tar -xzf server-account-update-20261028.tar.gz
cd ~/server-account-update-20261028
sha256sum -c SHA256SUMS
```

각 명령의 성공을 확인한 뒤 다음 명령을 실행한다. 실패하면 중단한다. 설치 경로가 다르면 아래 `--app-dir` 경로를 맞추고 래퍼에는 `sudo BUTLER_APP_DIR=/실제/경로 bash update-app.sh 현재커밋`으로 전달한다. Python 3.8 이상, Docker Compose, 기존 앱·DB·Mattermost가 실행 중이어야 한다.

## 1. Mattermost 읽기 검사

Mattermost의 **시스템 관리자** 개인 액세스 토큰을 준비한다. 관리자 계정의 보안 설정에서 생성하고 작업 후 같은 화면에서 폐기한다. 봇 토큰을 관리자 토큰 대신 사용하지 않는다. 서버가 개인 토큰 사용을 허용하지 않으면 여기서 중단하고 관리자가 허용된 인증 수단을 준비한다. 비밀번호나 토큰을 명령어·대화·공유 로그에 붙이지 않는다.

```bash
sudo python3 rename-mattermost-accounts.py \
  --app-dir /home/mattermost-admin/robot-butler-direct-20261026
```

토큰은 숨김 입력으로만 받으며 파일에 저장하지 않는다. 기본 주소는 서버 내부 `http://127.0.0.1:8065`다. 포트가 다르면 `--url`로 실제 HTTPS 주소 또는 localhost 주소를 지정한다. 리디렉션은 따르지 않는다.

`PREFLIGHT OK`를 확인한다. 이 단계는 읽기 전용이다. `.env.selfhost`의 기존 사용자 ID 매핑으로 네 계정을 확인하고, 시스템 관리자 권한·활성 사용자·기존 username·외부 인증 연동 여부·목표 username 중복·팀/채널 권한 읽기를 검사한다. 네 계정 모두 통과하기 전에는 어느 계정도 변경하지 않는다. 매핑이 없거나 중복된 경우 자동으로 계정을 추정하거나 새로 연결하지 않는다.

## 2. 기존 배포와 비교 후 앱 업데이트

```bash
curl --fail --show-error http://100.123.150.118:8088/deployment-version.json
```

응답의 `commit`을 확인하고 기존 서버 전용 수정·배포 묶음과 새 릴리스를 비교한다. 새 릴리스는 PR #38의 히스토리·알림 복구와 PR #39의 이름 변경을 포함한다. 모르는 커밋이나 새 서버 전용 수정이 있으면 중단하고 먼저 통합한다. 실행 스크립트는 입력한 기존 커밋과 실제 응답이 일치하는지 확인하지만, 임의의 서버 전용 수정이 새 소스에 포함됐는지 자동 판단하지는 않는다.

아래 `현재커밋`을 응답에서 확인한 실제 값으로 바꾼다. 임의의 값을 입력하지 않는다.

```bash
sudo bash update-app.sh 현재커밋
```

사이트가 loopback에만 연결된 구성이라면 두 번째 인자로 `http://127.0.0.1:8088`을 지정한다. 업데이트 스크립트는 다음 순서로 동작한다.

1. 체크섬, 압축 경로·파일 형식, 기존 설치·설정, 현재 배포 커밋·앱·DB 조회, 기존 앱 이미지 ID를 확인한다.
2. 기존 소스·설정·이미지와 복구 정보를 `backup/app-accounts-시간/`에 보존한다. 백업 폴더는 700, 비공개 파일은 600이며 설정·개인 데이터를 포함하므로 공유하지 않는다.
3. 새 소스만 적용하고 이미지를 빌드한다. 기존 설정·매핑·DB 볼륨을 유지하며 setup/cutover를 실행하지 않는다.
4. 앱을 잠시 정지해 일관된 PostgreSQL custom-format 백업을 만들고 `pg_restore --list`로 읽을 수 있는지 검사한다. 이 명령은 복원하지 않는다. 실패하면 새 앱을 시작하지 않고 이전 앱 복구를 시도한다.
5. 같은 Compose 프로젝트에서 앱만 다시 시작한다. health, DB 디렉터리의 네 표시명, 배포 커밋, 기존 봇과 사용자 ID 연결을 확인한다. 테스트 DM은 보내지 않는다.

`APP UPDATE VERIFIED`를 확인한다. 오류가 나면 다음 단계로 가지 않는다. 자동 롤백이 실패하면 표시된 백업 경로로 아래 수동 복구를 실행한다. 앱은 업데이트 중 잠시 중단되지만 Mattermost와 DB 컨테이너를 재생성하거나 삭제하지 않는다.

## 3. Mattermost 실제 프로필 변경

업무 중 팀/채널 권한과 프로필을 다른 관리자가 함께 수정하지 않는 짧은 유지보수 시간에 실행한다.

```bash
sudo python3 rename-mattermost-accounts.py \
  --app-dir /home/mattermost-admin/robot-butler-direct-20261026 \
  --apply
```

관리자 토큰을 다시 숨김 입력한다. 매번 전체 사전 검사를 반복한다. 기존 프로필·ID·권한·팀/채널 멤버십을 `backup/accounts-시간/profiles.json`에 저장한 뒤 **동일한 user_id에 다음 네 프로필 필드만** 부분 갱신한다.

| 앱 내부 ID | username | nickname | first_name | last_name |
| ---------- | -------- | -------- | ---------- | --------- |
| sujin      | jeong    | 정금결   | 금결       | 정        |
| jooyoung   | kim      | 김금달   | 금달       | 김        |
| taeheon    | tae      | 태평양   | 평양       | 태        |
| wooseok    | jang     | 장금별   | 금별       | 장        |

기존 user_id, 이메일, 인증 설정, roles, 팀·채널 멤버십과 역할을 변경하지 않는다. 계정 생성·삭제·비밀번호 변경·메시지 쓰기 API는 사용하지 않는다. 기존 앱 ID와 `MATTERMOST_USER_MAP`도 유지한다. 목표 상태라면 다시 쓰지 않고 검증만 하므로 재실행할 수 있다.

각 사용자명에 `VERIFIED`와 마지막에 `PROFILE UPDATE COMPLETE`가 나와야 완료다. 중간 오류·시간 초과·검증 실패가 발생하면 다음 계정 변경을 중단하고, 요청 전 기록한 journal을 사용해 시도했던 계정들을 역순으로 되돌린다. 응답 유실도 복구 대상에 포함한다. 복구 전 다른 사람의 프로필·권한 변경이나 username 충돌이 발견되면 덮어쓰지 않는다. `ROLLBACK UNVERIFIED`가 나오면 일부 계정의 결과는 불확실하므로 재실행을 반복하지 말고 백업과 실제 프로필을 확인한다. Mattermost에는 네 계정을 묶는 원자적 트랜잭션이 없으므로 네트워크 단절·강제 종료 때 자동 복구를 보장할 수는 없다.

## 4. 최종 확인

- 앱 로그인 선택에 정금결·김금달·태평양·장금별이 표시되는지 확인한다.
- 기존 Topic·회의·자료·권한이 보존됐는지 확인한다.
- Mattermost에서 새 username으로 기존 계정을 열고 기존 DM과 메시지 기록을 확인한다.
- 허용된 시연 회의에서 초대·리마인드 DM, 링크와 버튼을 확인한다. 스크립트의 읽기 검사는 실제 발송 확인을 대신하지 않는다.
- 관리자 개인 토큰을 폐기한다. 앱 봇 토큰은 폐기하지 않는다.

이전 메시지 본문·멘션 문자열, 캡처·영상·백업의 실명은 자동 수정하지 않는다. 사용자 화면은 새로 캡처한다. 프로필 표시 형식은 기존 Mattermost 서버 설정을 따른다.

## 복구

두 종류의 백업 경로를 혼용하지 않는다. 아래 `...`는 실행 시 출력된 실제 백업 폴더명으로 바꾼다. 앱과 Mattermost는 독립된 단계이므로 필요에 따라 둘 다 복구한다.

Mattermost 프로필 복구(먼저 읽기 검사, 통과하면 실제 복구):

```bash
cd ~/server-account-update-20261028
sudo python3 rename-mattermost-accounts.py \
  --app-dir /home/mattermost-admin/robot-butler-direct-20261026 \
  --restore /home/mattermost-admin/robot-butler-direct-20261026/backup/accounts-...
sudo python3 rename-mattermost-accounts.py \
  --app-dir /home/mattermost-admin/robot-butler-direct-20261026 \
  --restore /home/mattermost-admin/robot-butler-direct-20261026/backup/accounts-... \
  --apply
```

백업의 서버 주소·계정 ID 매핑이 같고, 이후 별도 프로필·권한 변경이나 username 충돌이 없을 때만 기존 프로필을 복원한다. 복구 시도도 새 백업을 남긴다. 원본 변경 실행의 `accounts-...` 백업을 사용한다.

앱 복구:

```bash
sudo python3 update-selfhost-accounts.py \
  --app-dir /home/mattermost-admin/robot-butler-direct-20261026 \
  --rollback /home/mattermost-admin/robot-butler-direct-20261026/backup/app-accounts-...
```

기존 소스·설정·앱 이미지로 복구하고 앱·DB 조회를 검증한다. DB 전체를 자동 복원하지 않으므로 업데이트 이후 생긴 회의와 자료를 유지한다. 표시명은 DB에 남을 수 있으며 앱 롤백은 표시명 역변환을 수행하지 않는다. Mattermost 프로필은 별도로 복구한다.

DB 백업은 최후 수단이다. `database.dump`는 앱 DB만 포함하며 Mattermost DB 백업이 아니다. 프로필 복구는 원본 JSON으로 수행한다. 앱 DB 전체 복원은 백업 이후 데이터를 잃을 수 있으므로 앱 정지·현재 DB 추가 백업·신규 데이터 보존·대상 DB 검토 후 운영자가 별도로 진행한다. `down -v`, 볼륨 삭제, 무조건적인 `pg_restore --clean`을 사용하지 않는다.

API 근거: [Mattermost 공식 사용자 부분 갱신 명세](https://github.com/mattermost/mattermost/blob/master/api/v4/source/users.yaml). 생략한 필드는 갱신하지 않는 `PUT /users/{user_id}/patch`만 프로필 쓰기에 사용한다.
