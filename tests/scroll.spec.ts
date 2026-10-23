import { expect, test } from '@playwright/test';

test('long pages scroll with wheel and keyboard, including after closing a dialog', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto('/rooms');
  await expect(page.getByRole('heading', { name: '회의실', exact: true })).toBeVisible();
  await page.mouse.move(1000, 400);
  await page.mouse.wheel(0, 700);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: '내 프로필', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflowY))
    .toBe('hidden');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).overflowY))
    .toBe('scroll');
  await page.locator('#main-content').focus();
  await page.keyboard.press('End');
  await expect
    .poll(() =>
      page.evaluate(() => scrollY + innerHeight >= document.documentElement.scrollHeight - 2),
    )
    .toBe(true);
  await expect(page.getByRole('link', { name: 'Topic에서 회의 만들기' })).toBeInViewport();
  await page.screenshot({ path: `test-results/scroll-bottom-${testInfo.project.name}.png` });
});
