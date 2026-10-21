import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDemoDatabase } from './database';
import { configureTransactionAdapter, localService } from '../src/data/previewService';
let folder: string;
let db: ReturnType<typeof openDemoDatabase>;
beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'butler-db-'));
  db = openDemoDatabase(join(folder, 'test.sqlite'), 'reference');
  await db.seed();
  configureTransactionAdapter(db.transaction);
});
afterEach(() => {
  db.close();
  rmSync(folder, { recursive: true, force: true });
});
describe('SQLite case history', () => {
  it('seeds once, preserves edits and persists across reopen', async () => {
    const count = db.load().meetings.length;
    await localService.updateTopic('kang', 'it-2026', {
      title: '팀 회의 수정',
      description: '수정 보존',
      managerIds: ['jin', 'yoseop'],
    });
    db.close();
    db = openDemoDatabase(join(folder, 'test.sqlite'), 'reference');
    await db.seed();
    expect(db.load().meetings).toHaveLength(count);
    expect(db.load().topics.find((t) => t.id === 'it-2026')?.title).toBe('팀 회의 수정');
  });
  it('keeps different organizers in one history and historical job titles', async () => {
    const view = await localService.snapshot('me');
    expect(view.meetings.filter((m) => m.topicId === 'it-2026').map((m) => m.creatorId)).toContain(
      'kang',
    );
    expect(view.meetings.filter((m) => m.topicId === 'it-2026').map((m) => m.creatorId)).toContain(
      'jin',
    );
    expect(view.meetings.find((m) => m.id === 'autopay-prov2')?.hostAtTime).toContain('정보개발팀');
    expect(view.meetings.find((m) => m.id === 'autopay-prov3')?.summary?.decisions).toBe(
      '/prov3를 만들자.',
    );
  });
  it('lets both Masters read all equipment meetings but restricts Attendees and files', async () => {
    for (const actor of ['juhyung', 'seungyeop'])
      expect(
        (await localService.snapshot(actor)).meetings.filter((m) => m.topicId === 'equipment-2026'),
      ).toHaveLength(4);
    expect(
      (await localService.snapshot('me')).meetings.some((m) => m.id === 'equipment-vendor'),
    ).toBe(false);
    await expect(
      localService.download('juhyung', 'autopay-prov2', 'file-autopay-prov2'),
    ).rejects.toThrow('접근');
    const file = await localService.download('me', 'autopay-prov2', 'file-autopay-prov2');
    expect((await file.blob!.text()).startsWith('%PDF')).toBe(true);
  });
  it('serializes concurrent duplicate creation and rejects unauthorized mutations', async () => {
    const input = {
      topicId: 'equipment-2026',
      title: '검증',
      description: '검증',
      roomId: 'it-room',
      start: '2026-10-24T10:00:00+09:00',
      end: '2026-10-24T11:00:00+09:00',
      participantIds: ['me'],
      material: 'none' as const,
      attachments: [],
    };
    await expect(localService.createMeeting('me', input, 'unauthorized')).rejects.toThrow('관리자');
    const ids = await Promise.all([
      localService.createMeeting('juhyung', input, 'same'),
      localService.createMeeting('juhyung', input, 'same'),
    ]);
    expect(ids[0]).toBe(ids[1]);
    expect(db.load().meetings.filter((m) => m.id === ids[0])).toHaveLength(1);
  });
});
