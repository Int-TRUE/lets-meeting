import { expect, test } from '@playwright/test';

test('registered room selection updates the uncropped route illustration and labels', async ({
  page,
}, testInfo) => {
  await page.goto('/rooms');
  const guide = page.getByRole('region', { name: '회의실 가는 길' });
  for (const name of [
    '9층 대회의실',
    '3층 회의실 A',
    '3층 회의실',
    'IT운영팀 회의실',
    '12층 회의실',
  ]) {
    await page
      .getByLabel('센터', { exact: true })
      .selectOption(name === '3층 회의실' ? '분당' : '명동');
    await page
      .locator('.room-list-item')
      .filter({ hasText: name === '3층 회의실' ? '분당' : name })
      .click();
    await expect(guide.locator('.room-directions-destination')).toHaveText(name);
    const image = guide.getByRole('img');
    await expect(image).toBeVisible();
    await expect(image).toHaveJSProperty('complete', true);
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(1000);
  }
  await page.locator('.room-list-item').filter({ hasText: '9층 대회의실' }).click();
  await page.screenshot({
    path: `test-results/room-directions-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
