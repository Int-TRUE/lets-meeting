#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/Applications/Docker.app/Contents/Resources/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo 'Node.js 22.14 이상과 npm을 설치한 뒤 다시 실행해주세요.'; read -r; exit 1
fi
if [ ! -f .env.mattermost-local/relay.env ] || [ ! -f .env.mattermost-local/compose.yaml ]; then
  echo '이 맥의 시연 설정 파일이 없습니다. docs/MATTERMOST.md의 설정 안내를 확인해주세요.'; read -r; exit 1
fi
open -a Docker
for ((attempt=0;attempt<60;attempt++)); do
  if docker info >/dev/null 2>&1; then break; fi
  sleep 2
done
docker compose -p robot-butler-mattermost -f .env.mattermost-local/compose.yaml up -d
printf '\n로봇집사: https://robot-butler.vercel.app/\n매터모스트: http://localhost:8065/\n이 창을 켜둔 동안 알림을 전달합니다. 종료는 Ctrl+C입니다.\n\n'
# Prevent idle sleep only while this user-started relay is running.
exec caffeinate -i npm run mattermost:relay
