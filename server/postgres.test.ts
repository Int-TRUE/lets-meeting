import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPostgresDatabase, deploymentSchema } from './postgres';
import { configureTransactionAdapter, localService } from '../src/data/previewService';

it('isolates production, development and each preview branch', () => {
  expect(deploymentSchema({ VERCEL_ENV: 'production' })).toBe('butler_production');
  expect(deploymentSchema({})).toBe('butler_development');
  expect(deploymentSchema({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'a' })).not.toBe(
    deploymentSchema({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'b' }),
  );
  expect(() => deploymentSchema({ VERCEL_ENV: 'preview' })).toThrow('branch');
});

describe.skipIf(!process.env.POSTGRES_TEST_URL)('real PostgreSQL transactions', () => {
  const url = process.env.POSTGRES_TEST_URL!;
  let schema: string;
  let db: ReturnType<typeof openPostgresDatabase>;
  beforeEach(async () => {
    schema = 'butler_test_' + randomUUID().replaceAll('-', '');
    db = openPostgresDatabase(url, schema, url, 'reference');
    await db.seed();
    configureTransactionAdapter(db.transaction);
  }, 60_000);
  afterEach(async () => {
    await db?.close();
    if (schema?.startsWith('butler_test_')) {
      const cleanup = new Pool({ connectionString: url });
      try {
        await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await cleanup.end();
      }
    }
  });
  it('seeds once and preserves history, permissions and PDF bytes across connections', async () => {
    expect(await db.directory()).toHaveLength(15);
    expect(await db.rooms()).toHaveLength(5);
    await localService.updateTopic('kang', 'it-2026', {
      title: '공유 DB 수정',
      description: '재연결 보존',
      managerIds: ['jin', 'yoseop'],
    });

    const another = openPostgresDatabase(url, schema, url, 'reference');
    try {
      await another.seed();
      configureTransactionAdapter(another.transaction);
      const view = await localService.snapshot('me');
      expect(view.topics.find((t) => t.id === 'it-2026')?.title).toBe('공유 DB 수정');
      expect(view.meetings.some((m) => m.id === 'equipment-vendor')).toBe(false);
      expect(view.meetings.find((m) => m.id === 'autopay-prov2')?.hostAtTime).toContain(
        '정보개발팀',
      );
      const file = await localService.download('me', 'autopay-prov2', 'file-autopay-prov2');
      expect((await file.blob!.text()).startsWith('%PDF')).toBe(true);
      expect(
        (await localService.snapshot('juhyung')).meetings.filter(
          (m) => m.topicId === 'equipment-2026',
        ),
      ).toHaveLength(4);
    } finally {
      await another.close();
    }
  }, 60_000);
  it('notification-only transactions preserve attachment bytes and do not write when idle', async () => {
    const inspect = new Pool({ connectionString: url });
    const readFiles = async () =>
      (
        await inspect.query(
          `SELECT id, xmin::text, encode(bytes,'hex') AS bytes FROM "${schema}".attachments ORDER BY id`,
        )
      ).rows;
    const readMeetings = async () =>
      (await inspect.query(`SELECT id, xmin::text FROM "${schema}".meetings ORDER BY id`)).rows;
    try {
      const files = await readFiles();
      const meetings = await readMeetings();
      await db.notificationTransaction(
        'me',
        (state) => {
          expect(state.meetings.flatMap((m) => m.attachments ?? []).every((a) => !a.blob)).toBe(
            true,
          );
        },
        true,
      );
      expect(await readFiles()).toEqual(files);
      expect(await readMeetings()).toEqual(meetings);
      await db.notificationTransaction(
        'me',
        (state) => {
          state.meetings[0].end = '2026-10-26T12:30:00+09:00';
          state.requests['direct-notification-test'] = 'done';
        },
        true,
      );
      expect(await readFiles()).toEqual(files);
      const request = await inspect.query(
        `SELECT result FROM "${schema}".requests WHERE id='direct-notification-test'`,
      );
      expect(request.rows[0].result).toBe('done');
    } finally {
      await inspect.end();
    }
  });

  it('holds one notification worker per schema and allows a replacement only after release', async () => {
    const other = openPostgresDatabase(url, schema, url, 'reference');
    const release = await db.acquireNotificationLock(() => {});
    try {
      await expect(other.acquireNotificationLock(() => {})).rejects.toThrow('Another');
      await release();
      const replacement = await other.acquireNotificationLock(() => {});
      await replacement();
    } finally {
      await other.close();
    }
  });
  it('serializes competing reservations across pools and rolls back rejected changes', async () => {
    const input = {
      topicId: 'equipment-2026',
      title: '동시 예약',
      description: '중복 방지',
      roomId: 'it-room',
      start: '2026-10-24T10:00:00+09:00',
      end: '2026-10-24T11:00:00+09:00',
      participantIds: ['me'],
      material: 'none' as const,
      attachments: [],
    };
    const another = openPostgresDatabase(url, schema, url, 'reference');
    try {
      const first = localService.createMeeting('juhyung', input, 'first');
      configureTransactionAdapter(another.transaction);
      const second = localService.createMeeting('juhyung', input, 'second');
      const result = await Promise.allSettled([first, second]);
      expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
      await expect(
        localService.createMeeting('me', { ...input, title: '권한 없음' }, 'forbidden'),
      ).rejects.toThrow('관리자');
      expect(
        (await localService.snapshot('juhyung')).meetings.filter((m) => m.title === input.title),
      ).toHaveLength(1);
    } finally {
      await another.close();
    }
  }, 60_000);
  it('resets old activity once while preserving edited/custom rooms and later test work', async () => {
    const sql = new Pool({ connectionString: url });
    const clean = openPostgresDatabase(url, schema, url);
    try {
      await localService.savePreferences('me', { materials: false, summary: false, reminders: [] });
      await localService.cancelMeeting('juhyung', 'equipment-today', 0);
      await localService.createTopic(
        'me',
        { title: '지울 Topic', description: '이전 데이터', managerIds: [] },
        'old-request',
      );
      await sql.query(
        `UPDATE "${schema}".rooms SET data=data || '{"capacity":99}'::jsonb WHERE id='it-room'`,
      );
      await sql.query(`INSERT INTO "${schema}".rooms VALUES ('custom',$1)`, [
        JSON.stringify({
          id: 'custom',
          name: '추가 회의실',
          location: '명동',
          floor: '20층',
          capacity: 8,
          active: true,
        }),
      ]);
      const before = (await sql.query(`SELECT * FROM "${schema}".rooms ORDER BY id`)).rows;
      await clean.seed();
      expect((await sql.query(`SELECT * FROM "${schema}".rooms ORDER BY id`)).rows).toEqual(before);
      expect(await clean.directory()).toHaveLength(24);
      for (const name of [
        'topics',
        'meetings',
        'attachments',
        'preferences',
        'delivery_logs',
        'requests',
      ])
        expect(
          Number((await sql.query(`SELECT count(*) AS n FROM "${schema}".${name}`)).rows[0].n),
        ).toBe(0);
      configureTransactionAdapter(clean.transaction);
      expect((await localService.snapshot('sujin')).meetings).toHaveLength(0);
      await expect(localService.snapshot('me')).rejects.toThrow('사용자');
      await expect(localService.snapshot('employee-01')).rejects.toThrow('사용자');
      const id = await localService.createTopic(
        'sujin',
        { title: '새 테스트', description: '보존 확인', managerIds: ['wooseok'] },
        'clean-test',
      );
      const account = (await clean.directory()).find((p) => p.id === 'sujin')!;
      await sql.query(
        `UPDATE "${schema}".people SET data=jsonb_set(data,'{name}','"stale demo label"') WHERE id='sujin'`,
      );
      const reopened = openPostgresDatabase(url, schema, url);
      try {
        await reopened.seed();
        expect((await reopened.directory()).find((p) => p.id === 'sujin')).toEqual(account);
        configureTransactionAdapter(reopened.transaction);
        expect((await localService.snapshot('wooseok')).topics.some((t) => t.id === id)).toBe(true);
      } finally {
        await reopened.close();
      }
    } finally {
      await clean.close();
      await sql.end();
    }
  }, 60_000);
});

it.skipIf(!process.env.POSTGRES_TEST_URL)(
  'relay claims serialize across PostgreSQL connections and receipts survive reconnect',
  async () => {
    const { queueForRelay, handleRelayRequest } = await import('./mattermost-relay');
    const url = process.env.POSTGRES_TEST_URL!;
    const schema = 'butler_test_' + randomUUID().replaceAll('-', '');
    const db = openPostgresDatabase(url, schema, url);
    const other = openPostgresDatabase(url, schema, url);
    const config = { token: 'a'.repeat(64), recipients: new Set(['sujin']) };
    try {
      await db.seed();
      await other.seed();
      configureTransactionAdapter(queueForRelay(db.transaction, config));
      const topicId = await localService.createTopic(
        'sujin',
        { title: '중계 DB 검증', description: '시연', managerIds: [] },
        randomUUID(),
      );
      const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const id = await localService.createMeeting(
        'sujin',
        {
          topicId,
          title: '중계 DB 회의',
          description: '시연',
          roomId: 'it-room',
          start: day + 'T10:00:00+09:00',
          end: day + 'T10:30:00+09:00',
          participantIds: [],
          material: 'none',
          attachments: [],
        },
        randomUUID(),
      );
      const request = (body: unknown) =>
        new Request('https://demo.example/api/mattermost-relay', {
          method: 'POST',
          headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      const claimId = randomUUID();
      const results = await Promise.all([
        handleRelayRequest(
          request({ action: 'claim', claimId }),
          async () => db.transaction,
          config,
        ),
        handleRelayRequest(
          request({ action: 'claim', claimId: randomUUID() }),
          async () => other.transaction,
          config,
        ),
      ]);
      const bodies = await Promise.all(results.map((r) => r.json()));
      expect(bodies.map((b) => b.jobs.length).sort()).toEqual([0, 1]);
      const job = bodies.flatMap((b) => b.jobs)[0];
      const ack = await handleRelayRequest(
        request({
          action: 'ack',
          claimId: job.relay.claimId,
          id: job.id,
          result: 'sent',
          postId: 'p'.repeat(26),
        }),
        async () => other.transaction,
        config,
      );
      expect(ack.status).toBe(200);
      configureTransactionAdapter(db.transaction);
      expect(await localService.meetingDelivery('sujin', id)).toEqual([
        { result: 'sent', event: 'created' },
      ]);
    } finally {
      await db.close();
      await other.close();
      const cleanup = new Pool({ connectionString: url });
      try {
        await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await cleanup.end();
      }
    }
  },
  60000,
);
