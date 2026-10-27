import pg from 'pg';
import { createNotificationScheduler, nextNotificationAt } from './notification-scheduler.ts';
import { createServer } from 'node:http';
import { openPostgresDatabase } from './postgres.ts';
import { TEST_SEED_VERSION } from './seed.ts';
import { handleDemoRequest } from './http.ts';
import { mattermostConfig } from './mattermost.ts';
import { createDirectNotifications } from './direct-notifications.ts';
import {
  createInteractionHandler,
  interactionListener,
} from '../scripts/mattermost-interactions.mjs';
import { createWebServer } from './selfhost-http.mjs';
import { RuleError } from '../src/domain/workflows.ts';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const origin = process.env.PUBLIC_ORIGIN;
  const schema = process.env.SELFHOST_SCHEMA ?? 'butler_selfhost';
  if (!connectionString || !origin || !/^butler_[a-z0-9_]{1,48}$/.test(schema))
    throw new Error('Missing server configuration');
  const config = mattermostConfig({ ...process.env, ROBOT_BUTLER_URL: origin });
  if (!config) throw new Error('Mattermost must be configured');
  const secret = process.env.MATTERMOST_INTERACTION_SECRET ?? '';
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid interaction secret');
  config.interaction = { url: 'http://robot-butler:8066', secret };
  async function checkMattermost() {
    for (const [path, expected] of [
      ['me', config.botId],
      ...Object.values(config.users).map((id) => [id, id]),
    ]) {
      const response = await fetch(`${config.baseUrl}/api/v4/users/${path}`, {
        headers: { Authorization: `Bearer ${config.token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Mattermost account check failed');
      const user = await response.json();
      if (user.id !== expected || user.delete_at) throw new Error('Mattermost account unavailable');
    }
  }
  if (process.argv.includes('--check-mattermost')) {
    await checkMattermost();
    console.log('MATTERMOST ACCOUNTS OK');
    return;
  }
  // Fresh schemas are allowed; existing data never undergoes the legacy seed reset.
  const preflight = new pg.Pool({ connectionString, connectionTimeoutMillis: 10000 });
  try {
    const exists = await preflight.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema]);
    if (exists.rowCount) {
      const version = await preflight.query(
        `SELECT value FROM "${schema}".metadata WHERE key='seed-version'`,
      );
      if (version.rows[0]?.value !== TEST_SEED_VERSION)
        throw new Error('Existing database version differs; refusing reset');
    }
  } finally {
    await preflight.end();
  }
  const db = openPostgresDatabase(connectionString, schema, connectionString);
  await db.seed();
  const release = await db.acquireNotificationLock(() => {
    console.error('Notification lock lost; stopping to prevent duplicate sends');
    process.exit(1);
  });
  const worker = createDirectNotifications({
    transaction: db.transaction,
    notificationTransaction: db.notificationTransaction,
    config,
  });
  await worker.recover();
  const scheduler = createNotificationScheduler({
    process: async () => {
      const passStartedAt = Date.now();
      await worker.tick();
      return db.notificationTransaction(
        'taeheon',
        (state) => nextNotificationAt(state, passStartedAt),
        false,
      );
    },
    onError: () => console.error('Notification processing failed; retry scheduled with backoff'),
  });
  const store = {
    directory: db.directory,
    rooms: db.rooms,
    transaction: async (...args) => {
      const result = await worker.transaction(...args);
      if (args[2]) scheduler.wake();
      return result;
    },
  };
  const app = createWebServer({
    origin,
    httpOrigin: process.env.ROBOT_BUTLER_HTTP_ORIGIN,
    root: 'dist',
    demo: (request) => handleDemoRequest(request, async () => store),
    relay: () => new Response(null, { status: 404 }),
    health: async () => {
      if (!scheduler.healthy()) throw new Error('Notification scheduler unhealthy');
    },
  });
  const callbacks = createServer(
    interactionListener(
      createInteractionHandler({
        config,
        rpc: async (input) => {
          try {
            const result = await worker.interact(input);
            if (input.command !== 'options') scheduler.wake();
            return result;
          } catch (error) {
            if (error instanceof RuleError) error.publicMessage = error.message;
            throw error;
          }
        },
      }),
    ),
  );
  await Promise.all([
    new Promise((resolve, reject) => {
      app.once('error', reject);
      app.listen(Number(process.env.PORT ?? 8080), '0.0.0.0', resolve);
    }),
    new Promise((resolve, reject) => {
      callbacks.once('error', reject);
      callbacks.listen(8066, '0.0.0.0', resolve);
    }),
  ]);
  scheduler.wake();
  console.log('Robot Butler ready: direct Mattermost notifications enabled');
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;

      setTimeout(() => process.exit(1), 25000).unref();
      await Promise.all([
        new Promise((r) => app.close(r)),
        new Promise((r) => callbacks.close(r)),
        worker.stop(),
        scheduler.stop(),
      ]);
      await release();
      await db.close();
      process.exit(0);
    });
}
main().catch(() => {
  console.error('Startup refused. Check server environment, DB version, and worker lock.');
  process.exit(1);
});
