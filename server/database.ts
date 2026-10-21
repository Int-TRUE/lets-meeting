import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { people } from '../src/data/workspace';
import { rooms, RuleError } from '../src/domain/workflows';
import { demoSeed, referenceSeed, seoulNow, TEST_SEED_VERSION, type SeedProfile } from './seed';
import { testDirectory } from '../src/data/testDirectory';
import type { PreviewDatabase } from '../src/domain/models';
import type { TransactionAdapter } from '../src/data/previewService';

export function openDemoDatabase(path: string, profile: SeedProfile = 'clean') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sql = new DatabaseSync(path);
  sql.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS topics(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS topic_members(topic_id TEXT REFERENCES topics(id),person_id TEXT REFERENCES people(id),role TEXT CHECK(role IN ('Owner','Master','Attendee')),PRIMARY KEY(topic_id,person_id));
    CREATE TABLE IF NOT EXISTS meetings(id TEXT PRIMARY KEY,topic_id TEXT REFERENCES topics(id),data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meeting_participants(meeting_id TEXT REFERENCES meetings(id),person_id TEXT REFERENCES people(id),PRIMARY KEY(meeting_id,person_id));
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,meeting_id TEXT REFERENCES meetings(id),data TEXT NOT NULL,bytes BLOB);
    CREATE TABLE IF NOT EXISTS preferences(person_id TEXT PRIMARY KEY REFERENCES people(id),data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS delivery_logs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,result TEXT NOT NULL);`);
  const rows = (table: string) =>
    sql.prepare(`SELECT * FROM ${table}`).all() as Record<string, any>[];
  function load(): PreviewDatabase {
    const topics = rows('topics').map((r) => ({
      ...JSON.parse(r.data),
      roles: Object.fromEntries(
        rows('topic_members')
          .filter((m) => m.topic_id === r.id)
          .map((m) => [m.person_id, m.role]),
      ),
    }));
    const files = rows('attachments');
    const participants = rows('meeting_participants');
    const meetings = rows('meetings').map((r) => {
      const attachments = files
        .filter((f) => f.meeting_id === r.id)
        .map((f) => ({
          ...JSON.parse(f.data),
          ...(f.bytes
            ? { blob: new Blob([new Uint8Array(f.bytes)], { type: JSON.parse(f.data).type }) }
            : {}),
        }));
      return {
        ...JSON.parse(r.data),
        participantIds: participants.filter((p) => p.meeting_id === r.id).map((p) => p.person_id),
        attachments,
        files: attachments.map((a) => a.name),
      };
    });
    return {
      version: 1,
      people: rows('people').map((r) => JSON.parse(r.data)),
      rooms: rows('rooms').map((r) => JSON.parse(r.data)),
      now: profile === 'reference' ? undefined : seoulNow(),
      topics,
      meetings,
      preferences: Object.fromEntries(
        rows('preferences').map((r) => [r.person_id, JSON.parse(r.data)]),
      ),
      logs: rows('delivery_logs').map((r) => JSON.parse(r.data)),
      requests: Object.fromEntries(rows('requests').map((r) => [r.id, r.result])),
    };
  }
  // Bytes are prepared before the synchronous SQL transaction. No await occurs inside it.
  async function persist(data: PreviewDatabase) {
    const bytes = new Map<string, Uint8Array>();
    for (const m of data.meetings)
      for (const a of m.attachments ?? [])
        if (a.blob) bytes.set(a.id, new Uint8Array(await a.blob.arrayBuffer()));
    return () => {
      for (const table of [
        'attachments',
        'meeting_participants',
        'topic_members',
        'meetings',
        'topics',
        'preferences',
        'delivery_logs',
        'requests',
      ])
        sql.exec(`DELETE FROM ${table}`);
      for (const t of data.topics) {
        const { roles, ...rest } = t;
        sql.prepare('INSERT INTO topics VALUES (?,?)').run(t.id, JSON.stringify(rest));
        for (const [id, role] of Object.entries(roles))
          sql.prepare('INSERT INTO topic_members VALUES (?,?,?)').run(t.id, id, role);
      }
      for (const m of data.meetings) {
        const { participantIds, attachments, files: _files, ...rest } = m;
        sql
          .prepare('INSERT INTO meetings VALUES (?,?,?)')
          .run(m.id, m.topicId, JSON.stringify(rest));
        for (const id of participantIds)
          sql.prepare('INSERT INTO meeting_participants VALUES (?,?)').run(m.id, id);
        for (const a of attachments ?? []) {
          const { blob: _blob, ...meta } = a;
          sql
            .prepare('INSERT INTO attachments VALUES (?,?,?,?)')
            .run(a.id, m.id, JSON.stringify(meta), bytes.get(a.id) ?? null);
        }
      }
      for (const [id, v] of Object.entries(data.preferences))
        sql.prepare('INSERT INTO preferences VALUES (?,?)').run(id, JSON.stringify(v));
      for (const log of data.logs)
        sql.prepare('INSERT INTO delivery_logs VALUES (?,?)').run(log.id, JSON.stringify(log));
      for (const [id, v] of Object.entries(data.requests))
        sql.prepare('INSERT INTO requests VALUES (?,?)').run(id, v);
    };
  }
  let queue: Promise<unknown> = Promise.resolve();
  const transaction: TransactionAdapter = (actor, mutate, write) => {
    const operation = queue.then(async () => {
      const account = sql.prepare('SELECT data FROM people WHERE id=?').get(actor);
      if (!account || (profile !== 'reference' && !JSON.parse(String(account.data)).isTestAccount))
        throw new RuleError('데모 사용자를 다시 선택해주세요.');
      // Serializing operations covers Blob conversion as well as SQL writes.
      if (write) sql.exec('BEGIN IMMEDIATE');
      try {
        const state = load();
        const result = mutate(state);
        if (write) {
          const save = await persist(state);
          save();
          sql.exec('COMMIT');
        }
        return result;
      } catch (e) {
        if (write) sql.exec('ROLLBACK');
        throw e;
      }
    });
    queue = operation.catch(() => {});
    return operation;
  };
  async function seed() {
    const expected = profile === 'reference' ? '2' : TEST_SEED_VERSION;
    const save = await persist(profile === 'reference' ? referenceSeed() : demoSeed());
    sql.exec('BEGIN IMMEDIATE');
    try {
      const version = sql.prepare("SELECT value FROM metadata WHERE key='seed-version'").get();
      if (version?.value === expected) {
        sql.exec('COMMIT');
        return;
      }
      if (profile === 'reference' && version)
        throw new Error('Reference fixtures require a separate test database.');
      // Clear dependent account/activity rows, then replace people. Rooms are untouched.
      if (profile !== 'reference') save();
      sql.exec('DELETE FROM people');
      for (const p of profile === 'reference' ? people : testDirectory)
        sql.prepare('INSERT INTO people VALUES (?,?)').run(p.id, JSON.stringify(p));
      if (!version)
        for (const r of rooms)
          sql.prepare('INSERT INTO rooms VALUES (?,?)').run(r.id, JSON.stringify(r));
      // Reference records have foreign keys, so seed them after the catalog exists.
      if (profile === 'reference') save();
      sql
        .prepare(
          "INSERT INTO metadata VALUES ('seed-version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(expected);
      sql.exec('COMMIT');
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  }
  return {
    sql,
    seed,
    transaction,
    load,
    directory: () => rows('people').map((r) => JSON.parse(r.data)),
    rooms: () => rows('rooms').map((r) => JSON.parse(r.data)),
    close: () => sql.close(),
  };
}
