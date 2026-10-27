import { expect, test } from '@playwright/test';

test('settings searches separate role groups and moves a person without duplicates', async ({
  page,
}) => {
  await page.goto('/topics/system/settings');
  const master = page.getByRole('group', { name: 'Master', exact: true });
  const attendee = page.getByRole('group', { name: 'Attendee', exact: true });
  await expect(master).toBeVisible();
  await expect(page.locator('.people-options').getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByLabel('Owner', { exact: true })).toContainText('김하늘');
  await attendee.getByRole('searchbox').fill('이서준');
  await attendee.getByRole('checkbox', { name: /이서준/ }).check();
  await expect(master.locator('.selected-people')).not.toContainText('이서준');
  await expect(attendee.locator('.selected-people')).toContainText('이서준');
  await master.getByRole('searchbox').fill('박지우');
  await master.getByRole('checkbox', { name: /박지우/ }).check();
  await expect(attendee.locator('.selected-people')).not.toContainText('박지우');
  await master.getByRole('searchbox').fill('김하늘');
  await expect(master.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: '변경 저장', exact: true }).click();
  await expect(page).toHaveURL(/\/topics\/system$/);
  await page.goto('/topics/system/settings');
  await expect(master.locator('.selected-people')).toContainText('박지우');
  await expect(attendee.locator('.selected-people')).toContainText('이서준');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('creation saves participants with the role of their search section', async ({ page }) => {
  await page.goto('/topics/new');
  await page.getByLabel(/^주제명/).fill('권한별 참가자 검색');
  await page.getByLabel(/^한줄 설명/).fill('Master와 Attendee 영역에서 추가');
  const master = page.getByRole('group', { name: 'Master', exact: true });
  const attendee = page.getByRole('group', { name: 'Attendee', exact: true });
  await master.getByRole('searchbox').fill('이서준');
  await master.getByRole('checkbox', { name: /이서준/ }).check();
  await attendee.getByRole('searchbox').fill('박지우');
  await attendee.getByRole('checkbox', { name: /박지우/ }).check();
  await expect(master.locator('.selected-people')).toContainText('이서준');
  await expect(attendee.locator('.selected-people')).toContainText('박지우');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '토픽 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '권한별 참가자 검색' })).toBeVisible();
  await page.getByRole('link', { name: '토픽 설정', exact: true }).click();
  await expect(master.locator('.selected-people')).toContainText('이서준');
  await expect(attendee.locator('.selected-people')).toContainText('박지우');
  await page.reload();
  await expect(master.locator('.selected-people')).toContainText('이서준');
  await expect(attendee.locator('.selected-people')).toContainText('박지우');
  await attendee.getByRole('button', { name: '박지우 선택 해제' }).click();
  await expect(attendee.locator('.selected-people')).not.toContainText('박지우');
});
