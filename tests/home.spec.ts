import { expect, test, type Page } from '@playwright/test';
async function home(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /김하늘님/ })).toBeVisible();
}
async function setState(page: Page, state: string) {
  const tools = page.locator('.preview-tools');
  if ((await tools.getAttribute('open')) === null) await tools.locator('summary').click();
  await page.getByLabel('화면 상태').selectOption(state);
}
test('home layout, data counts and responsive screenshots', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await home(page);
  await expect(page.getByRole('heading', { name: /^임박한 회의/ })).toHaveText('임박한 회의');
  await expect(page.getByText('30분 후', { exact: true })).toBeVisible();
  await expect(page.locator('.meeting-material')).toContainText('자료 2개 등록됨');
  await expect(page.locator('.meeting-card .avatar-more')).toHaveText('+1');
  await expect(page.locator('.meeting-calendar')).toBeVisible();
  await expect(page.locator('.timeline>li')).toHaveCount(3);
  await expect(page.locator('.topic-card')).toHaveCount(3);
  await expect(page.locator('.topic-card').last()).toContainText('회의 1개');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `test-results/home-${info.project.name}.png`, fullPage: true });
});
test('search autofocus, safe text, filters, result navigation and history restoration', async ({
  page,
}) => {
  await home(page);
  await page.locator('.search-trigger').click();
  const input = page.getByRole('textbox', { name: '검색어' });
  await expect(input).toBeFocused();
  await input.fill('전산기기');
  await expect(page.locator('.search-result')).toHaveCount(3);
  await page.screenshot({ path: `test-results/search-${test.info().project.name}.png` });
  await page.getByRole('button', { name: /^회의\s*2$/ }).click();
  await expect(page.locator('.search-result')).toHaveCount(2);
  await page.getByRole('button', { name: /전산기기 교체 · 2차 실무 회의/ }).click();
  await expect(page).toHaveURL(/\/meetings\/equipment/);
  await page.getByRole('button', { name: '검색 결과로 돌아가기' }).click();
  await expect(input).toHaveValue('전산기기');
  await expect(page.getByRole('button', { name: /^회의\s*2$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await input.fill('<img onerror=alert(1)>');
  await expect(page.getByRole('heading', { name: '검색 결과가 없어요' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.search-trigger')).toBeFocused();
});
test('modal traps focus and restores it after closing', async ({ page }) => {
  await home(page);
  await page.locator('.search-trigger').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '검색어' })).toBeFocused();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.locator('.search-trigger')).toBeFocused();
});
test('empty meetings preserve existing Topics; fully empty home never fabricates Topics', async ({
  page,
}) => {
  await home(page);
  await setState(page, 'empty-meetings');
  await expect(page.getByRole('heading', { name: '아직 예정된 회의가 없어요' })).toBeVisible();
  await expect(page.locator('.topic-card')).toHaveCount(3);
  await setState(page, 'empty');
  await expect(page.getByRole('heading', { name: '아직 참여 중인 토픽이 없어요' })).toBeVisible();
  await expect(page.locator('.topic-card')).toHaveCount(0);
  await page.screenshot({
    path: `test-results/empty-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test('loading, error, forbidden and expired states are distinct and retry stays honest', async ({
  page,
}) => {
  await home(page);
  for (const [state, title] of [
    ['error', '홈 정보를 불러오지 못했어요'],
    ['forbidden', '이 공간에 접근할 수 없어요'],
    ['expired', '로그인이 만료되었어요'],
  ]) {
    await setState(page, state);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByRole('heading', { name: /김하늘님/ })).toHaveCount(0);
  }
  await setState(page, 'loading');
  await expect(page.getByRole('status')).toBeVisible();
  await setState(page, 'normal');
  await expect(page.getByRole('heading', { name: /김하늘님/ })).toBeVisible();
});
test('restricted records cannot be read via search or direct detail links', async ({ page }) => {
  await home(page);
  await page.goto('/meetings/restricted');
  await expect(page.getByRole('heading', { name: '이 정보에 접근할 수 없어요' })).toBeVisible();
  await expect(page.getByText('비공개 인사 논의')).toHaveCount(0);
  await page.locator('.search-trigger').click();
  await page.getByRole('textbox', { name: '검색어' }).fill('비공개');
  await expect(page.getByRole('heading', { name: '검색 결과가 없어요' })).toBeVisible();
});
test('normal users have no admin menu or fake unread count; required notifications are locked', async ({
  page,
}) => {
  await home(page);
  await expect(page.locator('nav').getByRole('link', { name: /관리자/ })).toHaveCount(0);
  await expect(page.locator('.notification-link')).not.toContainText(/\d/);
  await page.getByRole('link', { name: '알림 설정', exact: true }).last().click();
  await expect(page.getByText('필수 · 항상 켜짐')).toHaveCount(3);
  await expect(page.getByRole('switch')).toHaveCount(2);
  await expect(page.getByRole('switch', { name: /회의 생성|일시|회의 취소/ })).toHaveCount(0);
});

test('switching example users recalculates visibility without granting management to attendees', async ({
  page,
}) => {
  await home(page);
  await page.locator('.preview-tools summary').click();
  await page.getByLabel('예시 사용자').selectOption('lee');
  await expect(page.getByRole('heading', { name: /이서준님/ })).toBeVisible();
  await expect(page.locator('.topic-card')).toHaveCount(1);
  await expect(page.locator('.topic-card')).toContainText('관리자');
  await expect(page.locator('.summary-notice')).toHaveCount(0);
  await page.getByLabel('예시 사용자').selectOption('park');
  await expect(page.getByRole('heading', { name: /박지우님/ })).toBeVisible();
  await expect(page.locator('.topic-card')).toHaveCount(1);
  await expect(page.locator('.topic-card')).not.toContainText('관리자');
  await expect(page.locator('.timeline>li')).toHaveCount(1);
});
test('menu and navigation work on each screen size', async ({ page }) => {
  await home(page);
  if (await page.getByRole('button', { name: '메뉴 열기' }).isVisible()) {
    await page.getByRole('button', { name: '메뉴 열기' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page
      .getByRole('navigation', { name: '모바일 메뉴' })
      .getByRole('link', { name: '토픽', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } else {
    await page
      .getByRole('navigation', { name: '주 메뉴' })
      .getByRole('link', { name: '토픽', exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/topics$/);
  await expect(page.getByRole('heading', { name: '토픽', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
