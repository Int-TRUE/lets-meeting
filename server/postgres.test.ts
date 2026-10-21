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
      const reopened = openPostgresDatabase(url, schema, url);
      try {
        await reopened.seed();
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
