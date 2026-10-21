import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openDemoDatabase } from './database';
import { configureTransactionAdapter, localService } from '../src/data/previewService';

test('reset replaces old accounts and activity once, preserves all rooms, and keeps subsequent user work', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'butler-clean-'));
  const path = join(folder, 'test.sqlite');
  let db = openDemoDatabase(path, 'reference');
  try {
    await db.seed();
    configureTransactionAdapter(db.transaction);
    await localService.savePreferences('me', { materials: false, summary: false, reminders: [] });
    await localService.cancelMeeting('juhyung', 'equipment-today', 0);
    await localService.createTopic(
      'me',
      { title: '지울 Topic', description: '이전 데이터', managerIds: [] },
      'old-request',
    );
    db.sql.prepare('INSERT INTO rooms VALUES (?,?)').run(
      'custom',
      JSON.stringify({
        id: 'custom',
        name: '보존할 회의실',
        location: '명동',
        floor: '15층',
        capacity: 12,
        active: true,
      }),
    );
    db.sql.prepare('UPDATE rooms SET data=? WHERE id=?').run(
      JSON.stringify({
        id: 'it-room',
        name: '수정한 회의실',
        location: '명동',
        floor: '2층',
        capacity: 18,
        active: false,
      }),
      'it-room',
    );
    const rooms = db.rooms();
    db.close();
    db = openDemoDatabase(path);
    await db.seed();
    expect(db.rooms()).toEqual(rooms);
    expect(db.directory()).toHaveLength(24);
    expect(
      db
        .directory()
        .filter((p) => p.isTestAccount)
        .map((p) => p.name),
    ).toEqual(['김태헌', '정수진', '장우석', '김주영']);
    expect(db.directory().some((p) => p.id === 'me')).toBe(false);
    for (const table of [
      'topics',
      'topic_members',
      'meetings',
      'meeting_participants',
      'attachments',
      'preferences',
      'delivery_logs',
      'requests',
    ])
      expect(db.sql.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
    configureTransactionAdapter(db.transaction);
    await expect(localService.snapshot('employee-01')).rejects.toThrow('사용자');
    const id = await localService.createTopic(
      'taeheon',
      { title: '처음 만든 Topic', description: '초기화 후 생성', managerIds: ['sujin'] },
      'new-topic',
    );
    db.close();
    db = openDemoDatabase(path);
    await db.seed();
    configureTransactionAdapter(db.transaction);
    expect((await localService.snapshot('sujin')).topics.find((t) => t.id === id)?.title).toBe(
      '처음 만든 Topic',
    );
    expect(db.rooms()).toEqual(rooms);
  } finally {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
