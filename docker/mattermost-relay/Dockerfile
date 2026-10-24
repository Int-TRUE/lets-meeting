FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
WORKDIR /app
COPY package.json ./
COPY scripts/mattermost-relay.mjs ./scripts/mattermost-relay.mjs
COPY scripts/mattermost-interactions.mjs ./scripts/mattermost-interactions.mjs
COPY server/mattermost.ts ./server/mattermost.ts
RUN mkdir /state && chown node:node /state
USER node
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=3 CMD node -e "const fs=require('node:fs');process.exit(Date.now()-fs.statSync('/state/heartbeat').mtimeMs<90000?0:1)"
CMD ["node", "--experimental-strip-types", "scripts/mattermost-relay.mjs"]
