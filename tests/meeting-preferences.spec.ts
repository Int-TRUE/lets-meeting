import { test, expect } from '@playwright/test';

test('favorite rooms are reusable in the wizard and reminder settings survive save', async ({
  page,
}) => {
  await page.goto('/rooms');
  await page.getByLabel('센터', { exact: true }).selectOption('분당');
  await page.getByRole('button', { name: '즐겨찾기 지정', exact: true }).click();
  await expect(page.getByRole('button', { name: '즐겨찾기 해제', exact: true })).toBeEnabled();
  await page.reload();
  await page.getByLabel('센터', { exact: true }).selectOption('분당');
  await expect(page.getByRole('button', { name: '즐겨찾기 해제', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto('/topics/system/meetings/new');
  await page.getByLabel(/^회의명/).fill('즐겨찾기 회의');
  await page.getByLabel(/^회의 내용·안건/).fill('리마인드 검증');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByLabel('자주 사용하는 회의실만 보기')).toHaveCount(0);
  await page.getByRole('button', { name: '분당', exact: true }).click();
  await expect(page.locator('.room-list-item')).toHaveCount(1);
  await page.locator('.room-list-item').click();
  await expect(page.getByRole('region', { name: '회의실 정보' })).toContainText('분당');
  await page.getByLabel('회의 일자 *').fill('2026-10-21');
  await page.getByRole('button', { name: '14:00 예약 가능', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByRole('heading', { name: '3. 참가자 선택' })).toBeVisible();
  await expect(page.getByLabel('자동 리마인드 켜기')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '자료 없음', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '회의 생성', exact: true })).toHaveCount(0);
  await page.locator('.people-picker').getByRole('searchbox').fill('박지우');
  await page.getByRole('checkbox', { name: /박지우/ }).check();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByRole('heading', { name: '4. 자료·알람 설정' })).toBeVisible();
  await expect(page.getByLabel('참가자 검색')).toHaveCount(0);
  await page.getByRole('radio', { name: '자료 없음', exact: true }).check();
  await page.getByLabel('자동 리마인드 켜기').check();
  await page.getByLabel('5분 전', { exact: true }).check();
  await page.getByLabel('하루 전', { exact: true }).check();
  await page.getByLabel('1시간 전', { exact: true }).check();
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await page.getByLabel('참가자 검색').fill('박지우');
  await expect(page.getByRole('checkbox', { name: /박지우/ })).toBeChecked();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByRole('radio', { name: '자료 없음', exact: true })).toBeChecked();
  await expect(page.getByLabel('5분 전', { exact: true })).toBeChecked();
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole('heading', { name: '4. 자료·알람 설정' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '자료 없음', exact: true })).toBeChecked();
  await expect(page.getByLabel('5분 전', { exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '회의 생성', exact: true }).click();
  await page.getByRole('link', { name: '회의 상세 보기', exact: true }).click();
  await expect(page.getByRole('button', { name: '리마인드 알람 보내기' })).toBeVisible();
  await page.getByRole('link', { name: '회의 수정', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByLabel('30분 전', { exact: true })).toBeChecked();
  await expect(page.getByLabel('5분 전', { exact: true })).toBeChecked();
  await expect(page.getByLabel('3분 전', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('하루 전', { exact: true })).toBeChecked();
  await expect(page.getByLabel('1시간 전', { exact: true })).toBeChecked();
  await page.screenshot({
    path: `test-results/reminder-settings-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test('follow-up checklist can be added and checked with persistent state', async ({ page }) => {
  await page.goto('/meetings/strategy/summary');
  await page.getByRole('button', { name: '후속 작업 추가' }).click();
  const fields = page.getByRole('textbox', { name: /^후속 작업 \d+$/ });
  await fields.last().fill('체크리스트 공유');
  await page.getByRole('button', { name: '임시 저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('요약을 저장했어요');
  await page.goto('/meetings/strategy?tab=summary');
  await page.getByLabel('체크리스트 공유', { exact: true }).check();
  await expect(page.getByLabel('체크리스트 공유', { exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel('체크리스트 공유', { exact: true })).toBeChecked();
  await page.screenshot({
    path: `test-results/checklist-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test('noncreator does not get the manual reminder action', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('robot-butler:preview-user:v1', 'park'));
  await page.goto('/meetings/equipment');
  await expect(page.getByRole('button', { name: '리마인드 알람 보내기' })).toHaveCount(0);
});

test('favorite rooms stay first without changing the selected room', async ({ page }) => {
  await page.goto('/rooms');
  const rows = page.locator('.room-list-item');
  await expect(rows.first()).toContainText('3층 회의실 A');
  await page.getByRole('button', { name: '명동 12층 회의실 즐겨찾기 지정', exact: true }).click();
  await expect(rows.first()).toContainText('12층 회의실');
  await expect(page.getByRole('region', { name: '회의실 정보' })).toContainText('3층 회의실 A');
  await page.reload();
  await expect(rows.first()).toContainText('12층 회의실');
  await rows.first().click();
  await expect(
    page
      .locator('.room-directions-heading')
      .getByRole('button', { name: '즐겨찾기 해제', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '명동 12층 회의실 즐겨찾기 해제', exact: true }).click();
  await expect(rows.first()).toContainText('3층 회의실 A');
  await expect(page.getByRole('region', { name: '회의실 정보' })).toContainText('12층 회의실');
});
