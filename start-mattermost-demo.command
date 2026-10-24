#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/Applications/Docker.app/Contents/Resources/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ ! -f .env.mattermost-local/relay.env ] || [ ! -f .env.mattermost-local/compose.yaml ]; then
  echo '이 맥의 시연 설정 파일이 없습니다. docs/MATTERMOST.md의 설정 안내를 확인해주세요.'; read -r; exit 1
fi
open -a Docker
for ((attempt=0;attempt<60;attempt++)); do
  if docker info >/dev/null 2>&1; then break; fi
  sleep 2
done
docker compose -p robot-butler-mattermost -f .env.mattermost-local/compose.yaml -f docker/mattermost-relay/compose.yaml up -d --build
printf '\n매터모스트·DB·중계기가 Docker에서 실행 중입니다. 이 창은 닫아도 됩니다.\n로봇집사: https://robot-butler.vercel.app/\n매터모스트: http://localhost:8065/\n중계 상태는 Docker Desktop의 robot-butler-mattermost → relay에서 확인하세요.\n'
