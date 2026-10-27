# 로봇집사 서버 설치 — 새 DB · 매터모스트 직접 연결

2026-10-26 사용자 승인: 기존 Neon은 보존하고 새 PostgreSQL로 시작한다. 사이트와 알림 작업을 매터모스트 서버에서 실행하며 별도 중계기는 중지한다. 이전 `server-migration-20261026` 백업·복원 절차는 이번 설치에 사용하지 않는다.

## 구성

- Compose 프로젝트: `robot-butler-direct`; 기존 `robot-butler-mattermost`와 분리.
- 새 DB: PostgreSQL 18, `robot_butler` / `butler_selfhost`, 전용 볼륨. 호스트에 DB 포트 공개 안 함.
- 앱: 호스트 Tailscale IP `100.123.150.118:8088` → 컨테이너 8080. 기존 매터모스트 Docker 네트워크에 함께 연결.
- 알림: 앱이 매터모스트 API에 직접 DM 전송. 내부 콜백 `http://robot-butler:8066`은 호스트 포트에 공개하지 않는다.
- 사이트: Tailscale IP의 HTTP 주소. Serve·HTTPS 관리 계정 승인은 필요 없다. 이용자 기기도 Tailscale 연결과 서버 접근 권한 필요.
- 데이터: 로그인 테스트 계정 4명, 참가 직원 목록, 기본 회의실. 토픽·회의·첨부파일은 빈 상태. 기존 계정 선택 방식은 유지하며 직원 SSO가 새로 추가되는 것은 아니다.

## 1. 맥에서 설치 묶음 복사

Codex가 제공한 `output/robot-butler-http-20261026.tar.gz`와 `.sha256` 파일을 사용한다. Git으로 직접 만들 경우에는 검증된 커밋에서만 `git archive`로 만든다. `.env`, `.vercel`, 개인 데이터는 포함하지 않는다.

```bash
cd "/Users/sujin/Documents/ChatGPT/바코챌 2"
scp output/robot-butler-http-20261026.tar.gz output/robot-butler-http-20261026.tar.gz.sha256 mattermost-admin@100.123.150.118:~/
ssh mattermost-admin@100.123.150.118
```

SSH가 실패하면 여기서 멈춘다. 서버 Tailscale 연결·SSH 접근을 먼저 복구한다.

## 2. 서버에서 압축 확인·풀기

```bash
cd ~
sha256sum -c robot-butler-http-20261026.tar.gz.sha256
mkdir robot-butler-direct-20261026
tar -xzf robot-butler-http-20261026.tar.gz -C robot-butler-direct-20261026
cd ~/robot-butler-direct-20261026
```

폴더가 이미 있으면 덮어쓰지 않는다. 오류가 난 단계에서 멈추고 기존 상태를 확인한다. 이후 명령은 별도 표시가 없으면 서버에서 실행한다.

## 3. 서버 설정 생성

```bash
python3 scripts/selfhost-setup.py
```

기존 `~/mattermost-transfer/.env.mattermost-local/relay.env`에서 봇 ID·토큰·사용자 매핑을 가져온다. 실제 Docker 네트워크와 Tailscale 주소를 확인해 `.env.selfhost`에 저장하고 새 DB 암호·콜백 서명 키를 생성한다. 파일 권한은 600이다. 비밀값을 화면에 출력하지 않는다. `SETUP OK`와 새 `http://100.123.150.118:8088` 주소를 확인한다.

`.env.selfhost`는 한 번만 생성하며, 재실행 때 기존 파일과 DB 암호를 보존한다. 기존 파일이 있다는 안내는 비밀번호를 다시 만들라는 뜻이 아니다. 이 파일을 대화·Git에 올리지 않는다.

## 4. 새 DB와 앱 이미지 준비

```bash
sudo ./butler up -d --wait db
sudo ./butler build app
```

Docker가 서버에서 Linux x86_64용 이미지를 빌드한다. Neon 접속·백업·복원은 필요 없다. 여기까지는 기존 중계기와 매터모스트를 변경하지 않는다.

## 5. 중계기 중지·직접 연결 전환

```bash
python3 scripts/selfhost-cutover.py
```

먼저 봇·매핑된 계정의 유효성을 실제 매터모스트에서 확인한다. 성공 후 기존 중계기를 중지하고 자동 재시작을 해제한다. 기존 Compose 파일을 백업한 후 중계기를 `legacy-relay` 프로필로 격리해 일반 `dc up`으로 재시작되지 않게 한다. 매터모스트의 내부 연결 허용 목록에 `robot-butler`를 추가하고 매터모스트 컨테이너만 재생성한다. 이때 매터모스트가 잠시 재시작되며 기존 DB·계정·대화·볼륨은 유지한다.

`CUTOVER READY`가 나와야 계속한다. 기존 중계기의 대기·발송 기록은 남지만 새 DB로 가져오지 않는다. 예전 회의의 알림 버튼은 새 회의로 연결되지 않는다. 새 서버에서 만든 회의로 확인한다.

## 6. 앱 실행

```bash
sudo ./butler up -d --wait app
sudo ./butler ps
curl --fail --show-error http://100.123.150.118:8088/healthz
curl --fail --show-error http://100.123.150.118:8088/api/demo/directory
```

`{"ok":true}`와 계정·회의실 목록이 나오면 DB 연결까지 정상이다. 처음 실행 때만 빈 DB에 기본 데이터를 넣으며 재시작해도 작성한 내용을 보존한다. 기존 스키마 버전이 다르면 초기화하지 않고 시작을 거절한다.

실패하면 아래 로그를 확인하고 다음 단계로 넘어가지 않는다. 비밀값이 있는 `.env.selfhost` 또는 `docker inspect` 전체 출력 대신 앱 오류 부분만 공유한다.

```bash
sudo ./butler logs --tail=80 app
```

## 7. 사이트 주소 연결

Tailscale에 연결된 기기에서 [로봇집사](http://100.123.150.118:8088)를 연다. 매터모스트 주소는 `http://100.123.150.118:8065` 그대로다. Tailscale Serve 활성화나 관리 페이지 로그인은 필요 없다. 네트워크 접근 정책에서 서버의 8088 포트 접근이 허용되어 있어야 한다.

서버가 실제 가진 Tailscale IP에만 포트를 연결한다. HTTP 주소는 명시적으로 허용한 주소와 일치해야 하며 일반 인터넷 HTTP 주소는 허용하지 않는다. HTTPS 전용 브라우저 기능인 `randomUUID` 대신 HTTP에서도 가능한 `getRandomValues`로 고유번호를 생성한다. 전송 경로는 Tailscale을 사용하지만 브라우저에는 HTTP로 표시된다.

## 8. 실제 동작 확인

1. 계정 4명으로 로그인하고 기존 회의가 없는 빈 상태를 확인한다.
2. 매터모스트 계정이 연결된 참가자끼리 토픽·회의를 만들고 초대 DM을 확인한다.
3. 상세에서 수동 리마인드를 보내고 DM의 회의 링크가 새 사이트를 여는지 확인한다.
4. 시작 전 자동 리마인드, 시작 시 참석 확인, 지각자 선택·응답을 확인한다.
5. 종료 5분 전 연장 버튼을 확인한다. 가능한 시간만 연장되고 참가자에게 변경을 알린다.
6. 앱 재시작 후 회의·파일이 남고 이미 보낸 DM이 다시 발송되지 않는지 확인한다.

발송 현황·관리자 발송 이력은 없다. 중복 방지를 위한 내부 기록은 유지한다. 전송 중 끊겨 실제 발송 여부를 확인할 수 없는 경우에는 중복 방지를 우선해 자동 재전송하지 않는다. 서버 중단 동안 놓친 오래된 예약 알림을 몰아서 보내지 않는 기존 규칙을 유지한다.

## 운영·백업·실패 시 복구

```bash
cd ~/robot-butler-direct-20261026
sudo ./butler logs --tail=80 app
sudo ./butler restart app
```

새 DB 백업(서버 밖에도 복사해 보관):

```bash
umask 077
mkdir -p backup
sudo ./butler exec -T db pg_dump -U butler -d robot_butler -Fc > "backup/robot-butler-$(date +%Y%m%d-%H%M%S).dump"
```

`down -v`는 사용하지 않는다. `.env.selfhost`와 DB 백업을 함께 보관한다. 업데이트는 같은 Compose 프로젝트·볼륨·암호를 사용한다.

새 앱 문제로 중지할 때는 `sudo ./butler stop app`만 실행하고 새 DB와 기존 Neon을 모두 보존한다. 옛 중계기 재시작은 Neon 접속이 복구되고 옛 사이트를 다시 사용하기로 정한 경우에만 별도로 진행한다. 두 DB는 자동 동기화되지 않는다. 새 데이터가 생긴 뒤 무조건 옛 사이트로 되돌리지 않는다.

설치가 끝나면 맥에도 예전 중계기가 자동 시작되지 않도록 확인한다. Docker Desktop이 실행 중일 때만:

```bash
docker update --restart=no robot-butler-mattermost-relay-1
docker stop --time 90 robot-butler-mattermost-relay-1
```

기존 Vercel 사이트와 Neon은 새 서비스와 분리해 보존한다. 이 설치는 Vercel 일시 중지를 해제하거나 Neon 데이터를 삭제하지 않는다.

## 이미 설치한 서버를 HTTP로 업데이트

기존 `~/robot-butler-direct-20261026/.env.selfhost`와 DB를 그대로 사용한다. 새 설치용 setup 또는 cutover를 다시 실행하지 않는다. 먼저 맥에서 새 묶음을 복사한다.

```bash
cd "/Users/sujin/Documents/ChatGPT/바코챌 2"
scp output/robot-butler-http-20261026.tar.gz output/robot-butler-http-20261026.tar.gz.sha256 mattermost-admin@100.123.150.118:~/
ssh mattermost-admin@100.123.150.118
```

서버에서 다음 순서대로 실행한다. 각 단계가 성공한 뒤 다음 명령을 실행한다.

```bash
cd ~
sha256sum -c robot-butler-http-20261026.tar.gz.sha256
cd ~/robot-butler-direct-20261026
tar -xzf ~/robot-butler-http-20261026.tar.gz
sudo ./butler build app
python3 scripts/selfhost-http.py
sudo ./butler up -d --no-deps --force-recreate --wait app
curl --fail --show-error http://100.123.150.118:8088/healthz
```

묶음에는 `.env.selfhost`가 없다. 변경 스크립트는 기존 설정을 권한 600의 `.env.selfhost.before-http-<시간>`에 백업하고 공개 주소·HTTP 허용 주소·바인딩 IP 세 항목만 바꾼다. DB 비밀번호·봇 토큰·사용자 매핑·서명 키·DB 볼륨은 보존한다. `.env.selfhost`가 없으면 중단하며 임의로 새 비밀번호를 만들지 않는다.

새 주소에서는 브라우저의 로그인 선택을 다시 한다. 기존 회의와 첨부파일은 유지된다. 새로 보내는 알림 링크부터 HTTP 주소가 적용되며 이미 보낸 메시지의 링크는 자동 수정하지 않는다. 기존 Tailscale Serve 설정을 일괄 초기화하지 않는다.

## 변경 기반 알림 예약 (2026-10-26)

자체 서버는 5초 반복 조회 대신 앱의 쓰기 트랜잭션이 완료되면 알림을 처리하고,
다음 리마인드·회의 시작·종료 5분 전 시각에 메모리 타이머를 예약한다.
회의 변경·취소 및 매터모스트 버튼 처리 후에도 예약을 다시 계산한다.
시작 시 DB에서 미처리 알림과 예약을 복원한다. 기존의 오래된 알림 생략 및
발송 결과가 불명확한 메시지의 중복 재전송 방지 규칙을 유지한다.

예약과 변경이 없는 유휴 시간에는 알림 작업의 DB 조회가 없다. `/healthz`도
메모리의 처리 상태만 확인하므로 DB 연결 검사 역할은 하지 않는다.
실제 조회·저장·발송 결과 기록은 여전히 DB를 사용한다.
실패한 작업은 30초부터 두 배씩 최대 15분 간격으로 재시도한다.
25일을 넘는 예약은 메모리에서만 타이머를 재설정한다.
직접 SQL로 일정을 수정하거나 외부 도구로 데이터를 가져온 경우 앱을 재시작해
예약을 다시 불러와야 한다. 이 방식은 단일 앱 프로세스와 기존 알림 전용 잠금을 전제로 한다.
