import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { people } from '../src/data/workspace.js';
import { rooms, RuleError } from '../src/domain/workflows.js';
import type { Attachment, Meeting, PreviewDatabase, Topic, Role } from '../src/domain/models.js';
import type { TransactionAdapter } from '../src/data/previewService.js';
import { demoSeed, referenceSeed, seoulNow, TEST_SEED_VERSION, type SeedProfile } from './seed.js';
import { testDirectory } from '../src/data/testDirectory.js';

function verifiedConnection(value: string) {
  const url = new URL(value);
  if (['require', 'prefer', 'verify-ca'].includes(url.searchParams.get('sslmode') ?? ''))
    url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

export function deploymentSchema(env = process.env): string {
  if (env.VERCEL_ENV === 'production') return 'butler_production';
  if (env.VERCEL_ENV === 'preview') {
    const branch = env.VERCEL_GIT_COMMIT_REF;
    if (!branch) throw new Error('Preview branch is required for database isolation.');
    return 'butler_preview_' + createHash('sha256').update(branch).digest('hex').slice(0, 16);
  }
  return 'butler_development';
}

export function openPostgresDatabase(
  connectionString: string,
  schema = deploymentSchema(),
  directConnectionString = process.env.DATABASE_URL_UNPOOLED ?? connectionString,
  profile: SeedProfile = 'clean',
) {
  if (!/^butler_[a-z0-9_]{1,48}$/.test(schema)) throw new Error('Invalid database namespace.');
  const pool = new Pool({
    connectionString: verifiedConnection(connectionString),
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });
  attachDatabasePool(pool);
  const table = (name: string) => `"${schema}".${name}`;
  let ready: Promise<void> | undefined;

  async function batch(client: PoolClient, name: string, columns: string[], rows: unknown[][]) {
    if (!rows.length) return;
    const values: unknown[] = [];
    const placeholders = rows
      .map(
        (row) =>
          '(' +
          row
            .map((value) => {
              values.push(value);
              return '$' + values.length;
            })
            .join(',') +
          ')',
      )
      .join(',');
    await client.query(
      `INSERT INTO ${table(name)} (${columns.join(',')}) VALUES ${placeholders}`,
      values,
    );
  }

  async function persist(client: PoolClient, data: PreviewDatabase) {
    const files: unknown[][] = [];
    for (const m of data.meetings)
      for (const a of m.attachments ?? []) {
        const { blob, ...meta } = a;
        files.push([
          a.id,
          m.id,
          JSON.stringify(meta),
          blob ? Buffer.from(await blob.arrayBuffer()) : null,
        ]);
      }
    // The advisory transaction lock covers checks, Blob conversion and all related writes.
    for (const name of [
      'attachments',
      'meeting_participants',
      'topic_members',
      'meetings',
      'topics',
      'preferences',
      'delivery_logs',
      'requests',
    ])
      await client.query(`DELETE FROM ${table(name)}`);
    await batch(
      client,
      'topics',
      ['id', 'data'],
      data.topics.map(({ roles: _roles, ...rest }) => [rest.id, JSON.stringify(rest)]),
    );
    await batch(
      client,
      'topic_members',
      ['topic_id', 'person_id', 'role'],
      data.topics.flatMap((t) => Object.entries(t.roles).map(([id, role]) => [t.id, id, role])),
    );
    await batch(
      client,
      'meetings',
      ['id', 'topic_id', 'data'],
      data.meetings.map(
        ({ participantIds: _participants, attachments: _attachments, files: _files, ...rest }) => [
          rest.id,
          rest.topicId,
          JSON.stringify(rest),
        ],
      ),
    );
    await batch(
      client,
      'meeting_participants',
      ['meeting_id', 'person_id'],
      data.meetings.flatMap((m) => m.participantIds.map((id) => [m.id, id])),
    );
    await batch(client, 'attachments', ['id', 'meeting_id', 'data', 'bytes'], files);
    await batch(
      client,
      'preferences',
      ['person_id', 'data'],
      Object.entries(data.preferences).map(([id, v]) => [id, JSON.stringify(v)]),
    );
    await batch(
      client,
      'delivery_logs',
      ['id', 'data'],
      data.logs.map((v) => [v.id, JSON.stringify(v)]),
    );
    await batch(client, 'requests', ['id', 'result'], Object.entries(data.requests));
  }

  async function initialize() {
    // DDL uses the direct connection, never transaction-pooled session state.
    const migrationPool = new Pool({
      connectionString: verifiedConnection(directConnectionString),
      max: 1,
      connectionTimeoutMillis: 15_000,
    });
    const client = await migrationPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [schema]);
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}";
        CREATE TABLE IF NOT EXISTS ${table('metadata')}(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ${table('people')}(id TEXT PRIMARY KEY,data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS ${table('rooms')}(id TEXT PRIMARY KEY,data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS ${table('topics')}(id TEXT PRIMARY KEY,data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS ${table('topic_members')}(topic_id TEXT REFERENCES ${table('topics')}(id),person_id TEXT REFERENCES ${table('people')}(id),role TEXT CHECK(role IN ('Owner','Master','Attendee')),PRIMARY KEY(topic_id,person_id));
        CREATE TABLE IF NOT EXISTS ${table('meetings')}(id TEXT PRIMARY KEY,topic_id TEXT REFERENCES ${table('topics')}(id),data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS ${table('meeting_participants')}(meeting_id TEXT REFERENCES ${table('meetings')}(id),person_id TEXT REFERENCES ${table('people')}(id),PRIMARY KEY(meeting_id,person_id));
        CREATE TABLE IF NOT EXISTS ${table('attachments')}(id TEXT PRIMARY KEY,meeting_id TEXT REFERENCES ${table('meetings')}(id),data JSONB NOT NULL,bytes BYTEA);
        CREATE TABLE IF NOT EXISTS ${table('preferences')}(person_id TEXT PRIMARY KEY REFERENCES ${table('people')}(id),data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS ${table('delivery_logs')}(id TEXT PRIMARY KEY,data JSONB NOT NULL);
        CREATE TABLE IF NOT EXISTS ${table('requests')}(id TEXT PRIMARY KEY,result TEXT NOT NULL);`);
      const version = await client.query(
        `SELECT value FROM ${table('metadata')} WHERE key='seed-version'`,
      );
      const expected = profile === 'reference' ? '2' : TEST_SEED_VERSION;
      if (version.rows[0]?.value !== expected) {
        if (profile === 'reference' && version.rowCount)
          throw new Error('Reference fixtures require an isolated test schema.');
        // Version 3 is a one-time, user-authorized account/activity reset.
        // Preserve room rows (including custom rooms and edits) exactly as they are.
        await persist(client, demoSeed());
        await client.query(`DELETE FROM ${table('people')}`);
        await batch(
          client,
          'people',
          ['id', 'data'],
          (profile === 'reference' ? people : testDirectory).map((p) => [p.id, JSON.stringify(p)]),
        );
        if (!version.rowCount)
          await batch(
            client,
            'rooms',
            ['id', 'data'],
            rooms.map((r) => [r.id, JSON.stringify(r)]),
          );
        if (profile === 'reference') await persist(client, referenceSeed());
        await client.query(
          `INSERT INTO ${table('metadata')} VALUES ('seed-version',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
          [expected],
        );
      }
      if (profile !== 'reference')
        for (const person of testDirectory.filter((p) => p.isTestAccount))
          await client.query(
            `UPDATE ${table('people')} SET data=jsonb_set(data,'{name}',to_jsonb($1::text)) WHERE id=$2`,
            [person.name, person.id],
          );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      await migrationPool.end();
    }
  }
  function seed() {
    ready ??= initialize().catch((error) => {
      ready = undefined;
      throw error;
    });
    return ready;
  }

  async function load(client: PoolClient, includeBytes = true): Promise<PreviewDatabase> {
    const topics = (
      await client.query<{ id: string; data: Omit<Topic, 'roles'> }>(
        `SELECT * FROM ${table('topics')} ORDER BY id`,
      )
    ).rows;
    const members = (
      await client.query<{ topic_id: string; person_id: string; role: Role }>(
        `SELECT * FROM ${table('topic_members')}`,
      )
    ).rows;
    const meetings = (
      await client.query<{ id: string; data: Meeting }>(
        `SELECT * FROM ${table('meetings')} ORDER BY id`,
      )
    ).rows;
    const participants = (
      await client.query<{ meeting_id: string; person_id: string }>(
        `SELECT * FROM ${table('meeting_participants')}`,
      )
    ).rows;
    const files = (
      await client.query<{ meeting_id: string; data: Attachment; bytes: Buffer | null }>(
        `SELECT ${includeBytes ? '*' : 'id, meeting_id, data'} FROM ${table('attachments')}`,
      )
    ).rows;
    const preferences = (await client.query(`SELECT * FROM ${table('preferences')}`)).rows;
    const logs = (await client.query(`SELECT * FROM ${table('delivery_logs')}`)).rows;
    const requests = (await client.query(`SELECT * FROM ${table('requests')}`)).rows;
    return {
      version: 1,
      people: (await client.query(`SELECT data FROM ${table('people')} ORDER BY id`)).rows.map(
        (r) => r.data,
      ),
      rooms: (await client.query(`SELECT data FROM ${table('rooms')} ORDER BY id`)).rows.map(
        (r) => r.data,
      ),
      now: profile === 'reference' ? undefined : seoulNow(),
      topics: topics.map((t) => ({
        ...t.data,
        roles: Object.fromEntries(
          members.filter((m) => m.topic_id === t.id).map((m) => [m.person_id, m.role]),
        ),
      })),
      meetings: meetings.map((m) => {
        const attachments = files
          .filter((f) => f.meeting_id === m.id)
          .map((f) => ({
            ...f.data,
            ...(f.bytes
              ? { blob: new Blob([new Uint8Array(f.bytes)], { type: f.data.type }) }
              : {}),
          }));
        return {
          ...m.data,
          participantIds: participants.filter((p) => p.meeting_id === m.id).map((p) => p.person_id),
          attachments,
          files: attachments.map((a) => a.name),
        };
      }),
      preferences: Object.fromEntries(preferences.map((r) => [r.person_id, r.data])),
      logs: logs.map((r) => r.data),
      requests: Object.fromEntries(requests.map((r) => [r.id, r.result])),
    };
  }
  const makeTransaction =
    (notificationsOnly = false): TransactionAdapter =>
    async (actor, mutate, write) => {
      await seed();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [schema]);
        if (
          !(
            await client.query(
              `SELECT id FROM ${table('people')} WHERE id=$1 AND ($2 OR data->>'isTestAccount'='true')`,
              [actor, profile === 'reference'],
            )
          ).rowCount
        )
          throw new RuleError('데모 사용자를 다시 선택해주세요.');
        const data = await load(client, !notificationsOnly);
        const before = notificationsOnly ? structuredClone(data) : undefined;
        const result = mutate(data);
        if (write) {
          if (!before) await persist(client, data);
          else {
            // Notification work never touches attachments or rewrites unrelated application tables.
            for (const meeting of data.meetings) {
              const old = before.meetings.find((m) => m.id === meeting.id);
              if (JSON.stringify(old) === JSON.stringify(meeting)) continue;
              const { attachments: _a, participantIds: _p, files: _f, ...value } = meeting;
              await client.query(`UPDATE ${table('meetings')} SET data=$2 WHERE id=$1`, [
                meeting.id,
                JSON.stringify(value),
              ]);
            }
            for (const log of data.logs) {
              if (JSON.stringify(before.logs.find((l) => l.id === log.id)) === JSON.stringify(log))
                continue;
              await client.query(
                `INSERT INTO ${table('delivery_logs')} VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
                [log.id, JSON.stringify(log)],
              );
            }
            for (const [id, value] of Object.entries(data.requests)) {
              if (before.requests[id] === value) continue;
              await client.query(
                `INSERT INTO ${table('requests')} VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET result=excluded.result`,
                [id, value],
              );
            }
          }
        }
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };
  return {
    schema,
    seed,
    transaction: makeTransaction(),
    notificationTransaction: makeTransaction(true),
    async acquireNotificationLock(onLost: () => void) {
      const client = await pool.connect();
      const key = schema + ':direct-notifications';
      const result = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [
        key,
      ]);
      if (!result.rows[0].locked) {
        client.release();
        throw new Error('Another notification worker is running');
      }
      client.on('error', onLost);
      return async () => {
        client.removeListener('error', onLost);
        try {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
        } finally {
          client.release();
        }
      };
    },
    async directory() {
      await seed();
      return (await pool.query(`SELECT data FROM ${table('people')} ORDER BY id`)).rows.map(
        (r) => r.data,
      );
    },
    async rooms() {
      await seed();
      return (await pool.query(`SELECT data FROM ${table('rooms')} ORDER BY id`)).rows.map(
        (r) => r.data,
      );
    },
    close: () => pool.end(),
  };
}
