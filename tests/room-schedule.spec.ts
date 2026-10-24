import { test, expect } from '@playwright/test';

test('room calendar, numeric floors, center filtering and meeting details', async ({
  page,
}, info) => {
  await page.goto('/rooms');
  const rows = page.locator('.room-list-item');
  const center = page.getByLabel('센터', { exact: true });
  await expect(center).toHaveValue('명동');
  await expect(center.locator('option')).toHaveText(['명동', '분당']);
  await expect(rows).toHaveCount(4);
  expect(await rows.locator('small').allTextContents()).toEqual([
    '3층 · 수용 6명',
    '9층 · 수용 8명',
    '11층 · 수용 12명',
    '12층 · 수용 16명',
  ]);
  await center.selectOption('분당');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('분당');
  await expect(page.locator('.room-schedule h2')).toHaveText('분당 · 3층 회의실 일정');
  await page.getByLabel('회의실 검색', { exact: true }).fill('9층');
  await expect(page.getByText('회의실 검색 결과가 없어요')).toBeVisible();
  await expect(page.locator('.room-schedule')).toHaveCount(0);
  await page.getByLabel('회의실 검색', { exact: true }).fill('');
  await center.selectOption('명동');
  await expect(rows).toHaveCount(4);
  await rows.filter({ hasText: '9층 대회의실' }).click();
  const agenda = page.getByRole('region', { name: '선택한 날짜의 예정 회의' });
  await expect(agenda.getByRole('link', { name: '전산기기 교체 · 2차 실무 회의' })).toBeVisible();
  await expect(agenda).toContainText('14:00 – 15:00');
  await expect(agenda).toContainText('주최자 이서준');
  await page.getByRole('button', { name: '2026-10-21, 회의 0개', exact: true }).click();
  await expect(agenda.getByText('표시할 예정 회의가 없어요')).toBeVisible();
  await page.getByRole('button', { name: '다음 달', exact: true }).click();
  await expect(page.getByRole('heading', { name: '2026년 11월' })).toBeVisible();
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(agenda.getByRole('link')).toBeVisible();
  await page.screenshot({
    path: `test-results/room-schedule-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await agenda.getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('전산기기 교체 · 2차 실무 회의');
});

test('nonmembers see schedules but cannot open private meeting details', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('robot-butler:preview-user:v1', 'ops'));
  await page.goto('/rooms');
  await page.locator('.room-list-item').filter({ hasText: '9층 대회의실' }).click();
  const agenda = page.getByRole('region', { name: '선택한 날짜의 예정 회의' });
  await expect(agenda).toContainText('전산기기 교체 · 2차 실무 회의');
  await expect(agenda.getByRole('link')).toHaveCount(0);
  await page.goto('/admin/rooms');
  const center = page.getByLabel('센터', { exact: true });
  await expect(center).toHaveValue('명동');
  await expect(center.locator('option')).toHaveText(['명동', '분당']);
  await center.selectOption('분당');
  await expect(page.locator('.room-list-item')).toHaveCount(1);
  await expect(page.locator('.room-list-item')).toContainText('분당');
  await page.goto('/meetings/equipment');
  await expect(page.getByRole('heading', { name: '이 정보에 접근할 수 없어요' })).toBeVisible();
});

test('new Topic participant picker excludes outsiders and stale draft selections', async ({
  page,
}) => {
  await page.goto('/topics/new');
  await page.getByLabel(/^주제명/).fill('구성원 제한');
  await page.getByLabel(/^한줄 설명/).fill('Topic 구성원만 선택');
  await page.getByRole('checkbox', { name: /이서준/ }).check();
  await page.getByRole('button', { name: 'Topic 만들기', exact: true }).click();
  await page.getByRole('link', { name: '회의 만들기', exact: true }).click();
  await page.getByLabel(/^회의명/).fill('구성원 회의');
  await page.getByLabel(/^회의 내용·안건/).fill('참가 범위 확인');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('회의 일자 *').fill('2026-10-21');
  await page.getByRole('button', { name: '14:00 예약 가능', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((key) =>
      key.startsWith('robot-butler:draft:v1:'),
    )!;
    const draft = JSON.parse(sessionStorage.getItem(key)!);
    draft.participantIds.push('ops');
    sessionStorage.setItem(key, JSON.stringify(draft));
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  const picker = page.locator('.people-picker');
  await expect(picker.getByRole('checkbox')).toHaveCount(2);
  await expect(picker.getByRole('checkbox', { name: /김하늘/ })).toBeDisabled();
  await expect(picker.getByRole('checkbox', { name: /이서준/ })).toBeVisible();
  await expect(picker).not.toContainText('운영관리자');
  await picker.getByRole('searchbox').fill('박지우');
  await expect(picker.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: '회의 생성', exact: true }).click();
  await expect(page.getByRole('heading', { name: '회의 생성이 완료되었어요!' })).toBeVisible();
});
