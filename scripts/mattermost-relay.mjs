import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:http';
import { createInteractionHandler, interactionListener } from './mattermost-interactions.mjs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { mattermostConfig, createMattermostSender } from '../server/mattermost.ts';

// Persist an intent before sending and a receipt before acknowledging remotely.
// On restart, an interrupted send becomes unknown and is never sent again.
export function openJournal(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(
    'PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS relay_state (origin TEXT PRIMARY KEY, data TEXT NOT NULL)',
  );
  return {
    get: (origin) => {
      const row = db.prepare('SELECT data FROM relay_state WHERE origin=?').get(origin);
      return row ? JSON.parse(row.data) : undefined;
    },
    set: (origin, value) =>
      db
        .prepare(
          'INSERT INTO relay_state VALUES (?,?) ON CONFLICT(origin) DO UPDATE SET data=excluded.data',
        )
        .run(origin, JSON.stringify(value)),
    clear: (origin) => db.prepare('DELETE FROM relay_state WHERE origin=?').run(origin),
    close: () => db.close(),
  };
}
export function relayRpc(origin, token, fetcher = fetch) {
  return async function rpc(body) {
    const response = await fetcher(`${origin}/api/mattermost-relay`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(process.env.RELAY_PREVIEW_OIDC_TOKEN
          ? { 'x-vercel-trusted-oidc-idp-token': process.env.RELAY_PREVIEW_OIDC_TOKEN }
          : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = new Error(`중계 API HTTP ${response.status}`);
      if (response.status === 409) error.publicMessage = (await response.json()).error;
      throw error;
    }
    return response.json();
  };
}

export function createRelayWorker({
  origin,
  token,
  config,
  journal,
  fetcher = fetch,
  send = createMattermostSender(config, fetcher),
}) {
  const rpc = relayRpc(origin, token, fetcher);
  return async () => {
    let state = journal.get(origin);
    // Results are uploaded even when Mattermost is offline.
    if (state?.phase === 'sending') {
      state = { ...state, phase: 'receipt', outcome: { result: 'unknown' } };
      journal.set(origin, state);
    }
    if (state?.phase === 'receipt') {
      await rpc({ action: 'ack', claimId: state.claimId, id: state.job.id, ...state.outcome });
      console.log(`발송 결과 기록: ${state.outcome.result}`);
      journal.clear(origin);
      return true;
    }
    // Do not consume pending work while Docker/Mattermost is unavailable.
    const health = await fetcher(`${config.baseUrl}/api/v4/system/ping`, {
      redirect: 'error',
      signal: AbortSignal.timeout(4000),
    });
    if (!health.ok) throw new Error('매터모스트 연결 대기');
    if (!state) {
      state = { phase: 'claim', claimId: randomUUID() };
      journal.set(origin, state);
    }
    const { jobs } = await rpc({ action: 'claim', claimId: state.claimId });
    if (!Array.isArray(jobs)) throw new Error('중계 응답 형식 오류');
    if (!jobs.length) {
      journal.clear(origin);
      return false;
    }
    const job = jobs[0];
    if (
      job.relay?.claimId !== state.claimId ||
      !job.payload ||
      ![
        'created',
        'changed',
        'cancelled',
        'start-check',
        'late',
        'late-reply',
        'end-reminder',
      ].includes(job.event)
    )
      throw new Error('중계 작업 확인 실패');
    // An old/lost claim response must never trigger a send after its deadline.
    if (job.relay.expiresAt < Date.now() + 15_000) {
      journal.set(origin, { ...state, job, phase: 'receipt', outcome: { result: 'unknown' } });
      return true;
    }
    state = { ...state, job, phase: 'sending' };
    journal.set(origin, state);
    const outcome = await send(job);
    journal.set(origin, { ...state, phase: 'receipt', outcome });
    // If acknowledgement fails, the saved receipt is retried without another DM.
    await rpc({ action: 'ack', claimId: state.claimId, id: job.id, ...outcome });
    journal.clear(origin);
    console.log(`매터모스트 DM: ${outcome.result}`);
    return true;
  };
}
async function main() {
  const config = mattermostConfig(process.env);
  const url = new URL(process.env.MATTERMOST_RELAY_ORIGIN ?? '');
  const token = process.env.MATTERMOST_RELAY_TOKEN ?? '';
  if (
    !config ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    throw new Error('중계 설정 파일을 확인해주세요.');
  config.appUrl = url.origin;
  const interactive = process.env.MATTERMOST_DOCKER_NETWORK === 'true';
  if (interactive) config.interaction = { url: 'http://relay:8066', secret: token };
  const lock = createServer(
    interactive
      ? interactionListener(createInteractionHandler({ config, rpc: relayRpc(url.origin, token) }))
      : (_request, response) => response.writeHead(404).end(),
  );
  await new Promise((resolve, reject) => {
    lock.once('error', reject);
    lock.listen(8066, interactive ? '0.0.0.0' : '127.0.0.1', resolve);
  });
  const journal = openJournal(
    resolve(process.env.MATTERMOST_RELAY_JOURNAL ?? 'data/mattermost-relay.sqlite'),
  );
  const tick = createRelayWorker({ origin: url.origin, token, config, journal });
  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
  });
  process.on('SIGTERM', () => {
    stopping = true;
  });
  console.log(`로봇집사 중계 시작: ${url.origin} → 로컬 매터모스트 (종료: Ctrl+C)`);
  let failures = 0;
  try {
    while (!stopping) {
      let busy = false;
      try {
        busy = await tick();
        if (process.env.MATTERMOST_RELAY_HEARTBEAT)
          writeFileSync(process.env.MATTERMOST_RELAY_HEARTBEAT, new Date().toISOString(), {
            mode: 0o600,
          });
        if (failures) console.log('중계 연결 복구');
        failures = 0;
      } catch {
        if (!failures)
          console.error(
            '연결 대기 중입니다. Docker·인터넷·중계 인증을 확인해주세요. 결과가 저장된 DM은 다시 보내지 않습니다.',
          );
        failures++;
      }
      if (!stopping)
        await new Promise((resolve) =>
          setTimeout(resolve, busy ? 100 : Math.min(30_000, 5000 * (failures + 1))),
        );
    }
  } finally {
    journal.close();
    lock.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error(
      '중계기를 시작하지 못했습니다. 설정 파일, Node.js 버전 또는 이미 실행 중인 중계기를 확인해주세요.',
    );
    process.exitCode = 1;
  });
}
