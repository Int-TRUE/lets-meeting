import { expect, test } from '@playwright/test';

test('organization, role editing, persistence and responsive layout', async ({ page }, info) => {
  await page.goto('/topics/system/settings');
  await expect(page.getByRole('heading', { name: '토픽 참가자', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '조직도 부서' })).toBeVisible();
  await expect(page.getByLabel('김하늘 권한', { exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: '부서 정렬' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox', { name: '부서 정렬' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('combobox', { name: '부서 정렬' })).toBeFocused();
  await page.getByRole('button', { name: /전체 조직/ }).click();
  await page.getByLabel('이서준 권한', { exact: true }).click();
  await page.getByRole('option', { name: /^Attendee/ }).click();
  await page.getByLabel('박지우 권한', { exact: true }).click();
  await page.getByRole('option', { name: /^Master/ }).click();
  await page.getByRole('searchbox', { name: '이름, 팀, 직책으로 검색' }).fill('운영관리자');
  await page.getByLabel('운영관리자 토픽 구성원', { exact: true }).check();
  await page.getByRole('searchbox').fill('없는직원');
  await expect(
    page.getByText('검색 결과가 없어요. 이름, 팀, 직책을 다시 확인해주세요.'),
  ).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: '변경 저장', exact: true }).click();
  await expect(page).toHaveURL(/\/topics\/system$/);
  await page.goto('/topics/system/settings');
  await page.getByRole('button', { name: /전체 조직/ }).click();
  await expect(page.getByLabel('이서준 권한', { exact: true })).toContainText('Attendee');
  await expect(page.getByLabel('박지우 권한', { exact: true })).toContainText('Master');
  await expect(page.getByLabel('운영관리자 토픽 구성원', { exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/topic-roles-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('searchbox').focus();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: '이서준 토픽에서 제외', exact: true }),
  ).toBeFocused();
});
