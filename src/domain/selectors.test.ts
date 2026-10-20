import { describe, expect, it } from 'vitest';
import { createPreviewRepository } from '../data/workspace';
import { dateKey, homeData, meetingStatus, searchWorkspace, visibleWorkspace } from './selectors';
import type { Workspace } from './models';
const load = () => createPreviewRepository('normal', 'kim').load(new AbortController().signal);
describe('meeting visibility and home calculations', () => {
  it('excludes non-invited meetings from Attendee cards, counts and search', async () => {
    const data = await load();
    expect(data.meetings.some((m) => m.id === 'restricted')).toBe(false);
    expect(data.meetings.filter((m) => m.topicId === 'team')).toHaveLength(1);
    expect(searchWorkspace(data, '비공개').meetings).toHaveLength(0);
    expect(searchWorkspace(data, '비공개 자료.pdf').meetings).toHaveLength(0);
  });
  it('selects the nearest scheduled meeting and only counts summaries the user can write', async () => {
    const data = homeData(await load());
    expect(data.next?.id).toBe('equipment');
    expect(data.today.map((m) => m.id)).toEqual(['strategy', 'equipment', 'culture']);
    expect(data.summaries.map((m) => m.id)).toEqual(['strategy']);
    expect(homeData({ ...data, user: { ...data.user, id: 'lee' } }).summaries).toHaveLength(0);
  });
  it('does not complete meetings when their end time passes', async () => {
    const data = await load();
    const meeting = data.meetings.find((m) => m.id === 'equipment')!;
    expect(meetingStatus(meeting, '2026-10-20T15:00:00+09:00')).toBe('summary-needed');
    expect(meetingStatus({ ...meeting, completed: true }, data.now)).toBe('completed');
    expect(meetingStatus({ ...meeting, cancelled: true }, data.now)).toBe('cancelled');
  });
  it('keeps Topic membership separate from meetings in an empty home', async () => {
    const data = await createPreviewRepository('empty-meetings', 'kim').load(
      new AbortController().signal,
    );
    expect(data.topics).toHaveLength(3);
    expect(homeData(data).next).toBeUndefined();
    const empty = await createPreviewRepository('empty', 'kim').load(new AbortController().signal);
    expect(empty.topics).toHaveLength(0);
    expect(empty.meetings).toHaveLength(0);
  });
  it('keeps visible Topic managers searchable when no meetings exist', async () => {
    const data = await createPreviewRepository('empty-meetings', 'kim').load(
      new AbortController().signal,
    );
    expect(searchWorkspace(data, '이서준').topics.map((t) => t.id)).toEqual(['system']);
    expect(searchWorkspace(data, '최민준').topics.map((t) => t.id)).toEqual(['brand']);
    expect(searchWorkspace(data, '비공개').meetings).toHaveLength(0);
  });
  it('excludes unknown users and unrelated people', async () => {
    const data = await load();
    const unknown: Workspace = { ...data, user: { id: 'unknown', name: '새 사용자', team: '' } };
    expect(visibleWorkspace(unknown).topics).toHaveLength(0);
    expect(visibleWorkspace(unknown).meetings).toHaveLength(0);
    expect(visibleWorkspace(unknown).people).toHaveLength(0);
  });
  it('searches accessible metadata, ignores whitespace and handles literal markup safely', async () => {
    const data = await load();
    expect(searchWorkspace(data, '   ').meetings).toHaveLength(0);
    expect(searchWorkspace(data, '  전산기기  ').meetings.length).toBeGreaterThan(0);
    expect(searchWorkspace(data, '장비 교체 계획.pdf').meetings[0]?.id).toBe('equipment');
    expect(searchWorkspace(data, '<script>').meetings).toHaveLength(0);
    expect(dateKey('2026-10-19T15:30:00Z')).toBe('2026-10-20');
  });
});
