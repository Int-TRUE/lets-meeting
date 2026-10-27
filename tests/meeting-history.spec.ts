import { test, expect } from '@playwright/test';

test('history selection shows a shared panel and persists checklist state', async ({
  page,
}, info) => {
  await page.goto('/meetings/strategy/summary');
  await page
    .getByLabel('주요 논의 내용', { exact: true })
    .fill('새 브랜드의 방향을 함께 정리했습니다.');
  await page.getByLabel('결정 사항', { exact: true }).fill('밝은 블루와 민트의 시안을 공유합니다.');
  await page.getByRole('button', { name: '후속 작업 추가' }).click();
  await page.getByLabel('후속 작업 1', { exact: true }).fill('디자인 시안 공유하기');
  await page.getByRole('button', { name: '후속 작업 추가' }).click();
  await page.getByLabel('후속 작업 2', { exact: true }).fill('팀별 의견 정리하기');
  await page.screenshot({
    path: `test-results/polished-editor-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '요약 저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('요약을 저장했어요');
  await page.goto('/topics/brand');
  const card = page.locator('.history-card').filter({ hasText: '브랜드 방향성 정리' });
  const toggle = card;
  const panel = page.getByRole('region', { name: '선택한 회의 상세', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('region', { name: '회의 요약', exact: true })).toHaveCount(1);
  await expect(card).not.toContainText('명동 · 3층 회의실 A');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/topics\/brand(?:\?|$)/);
  await expect(panel.getByRole('region', { name: '회의 요약', exact: true })).toContainText(
    '새 브랜드의 방향',
  );
  await panel.getByLabel('디자인 시안 공유하기', { exact: true }).check();
  await expect(panel.getByLabel('디자인 시안 공유하기', { exact: true })).toBeEnabled();
  await expect(panel.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  await page.reload();
  await card.click();
  await expect(panel.getByLabel('디자인 시안 공유하기', { exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/polished-history-${info.project.name}.png`,
    fullPage: true,
  });
  await panel.getByRole('link', { name: '회의 상세 보기', exact: true }).click();
  await expect(page).toHaveURL(/\/meetings\/strategy$/);
  await expect(page.getByRole('region', { name: '매터모스트 발송 결과' })).toHaveCount(0);
  await page.screenshot({
    path: `test-results/polished-delivery-${info.project.name}.png`,
    fullPage: true,
  });
});

test('history without summary opens an honest empty state', async ({ page }) => {
  await page.goto('/topics/system?historyView=list');
  const card = page.locator('.history-card').filter({ hasText: '전산기기 교체 · 2차 실무 회의' });
  await card.click();
  await expect(page.getByRole('region', { name: '선택한 회의 상세', exact: true })).toContainText(
    '아직 등록된 요약이 없어요',
  );
  await expect(page.getByRole('region', { name: '선택한 회의 상세', exact: true })).toContainText(
    '등록된 후속 작업이 없어요',
  );
  await expect(
    page.getByRole('region', { name: '선택한 회의 상세', exact: true }).getByRole('checkbox'),
  ).toHaveCount(0);
});

test('vertical timeline selects one panel beside the list and stacks on mobile', async ({
  page,
}, info) => {
  await page.goto('/topics/system?historyView=list');
  const cards = page.locator('.history-card');
  await expect(cards).toHaveCount(2);
  const panel = page.getByRole('region', { name: '선택한 회의 상세', exact: true });
  await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');
  await cards.first().click();
  const firstTitle = await cards.first().locator('.history-title').innerText();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(firstTitle);
  await cards.last().click();
  await expect(cards.first()).toHaveAttribute('aria-pressed', 'false');
  await expect(cards.last()).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(
    await cards.last().locator('.history-title').innerText(),
  );
  const flow = await page.locator('.history-timeline').boundingBox();
  const detail = await panel.boundingBox();
  if (info.project.name === 'mobile')
    expect(detail!.y).toBeGreaterThanOrEqual(flow!.y + flow!.height);
  else expect(detail!.x).toBeGreaterThanOrEqual(flow!.x + flow!.width);
  const first = await cards.first().boundingBox(),
    last = await cards.last().boundingBox();
  expect(last!.y).toBeGreaterThan(first!.y);
  expect(first!.height).toBeLessThan(280);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/history-flow-${info.project.name}.png`,
    fullPage: true,
  });
});

test('history search separates title, host and participant and preserves filters on reload', async ({
  page,
}) => {
  await page.goto('/topics/system?historyView=list');
  const history = page.getByRole('region', { name: '회의 히스토리', exact: true });
  const cards = history.locator('.history-card');
  await history.getByRole('button', { name: /^검색 조건:/ }).click();
  await history.getByRole('option', { name: '회의명', exact: true }).click();
  await history.getByLabel('검색어', { exact: true }).pressSequentially('missing-fast-query');
  await expect(history.getByLabel('검색어', { exact: true })).toHaveValue('missing-fast-query');
  await expect(page).toHaveURL(/historySearch=missing-fast-query/);
  await history.getByLabel('검색어', { exact: true }).fill('1차');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('1차 현황 점검');
  await history.getByRole('button', { name: /^검색 조건:/ }).click();
  await history.getByRole('option', { name: '주최자', exact: true }).click();
  await history.getByLabel('검색어', { exact: true }).fill('이서준');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('2차 실무 회의');
  await history.getByRole('button', { name: /^검색 조건:/ }).click();
  await history.getByRole('option', { name: '참가자', exact: true }).click();
  await history.getByLabel('검색어', { exact: true }).fill('최민준');
  await expect(cards).toHaveCount(1);
  await page.reload();
  await expect(history.getByLabel('검색어', { exact: true })).toHaveValue('최민준');
  await expect(cards).toHaveCount(1);
  await history.getByRole('button', { name: /^검색 조건:/ }).click();
  await history.getByRole('option', { name: '회의명', exact: true }).click();
  await expect(cards).toHaveCount(0);
  await expect(history).toContainText('검색 결과가 없어요');
  await expect(page.getByRole('region', { name: '선택한 회의 상세', exact: true })).toHaveCount(0);
  await history.getByLabel('검색어', { exact: true }).fill('');
  await history.getByRole('button', { name: /^정렬:/ }).click();
  await history.getByRole('option', { name: '오래된순', exact: true }).click();
  await expect(cards.first()).toContainText('1차 현황 점검');
  await history.getByRole('button', { name: /^정렬:/ }).click();
  await history.getByRole('option', { name: '최신순', exact: true }).click();
  await expect(cards.first()).toContainText('2차 실무 회의');
  await history.getByRole('button', { name: /^연도:/ }).click();
  await history.getByRole('option', { name: '2026년', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await page.goto('/topics/team?historyView=list&historySearch=비공개');
  await expect(page.locator('.history-card')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '회의 히스토리', exact: true })).toContainText(
    '검색 결과가 없어요',
  );
});

test('view switching keeps the selection and custom menus dismiss with Escape', async ({
  page,
}) => {
  await page.goto('/topics/system?historyOrder=desc');
  await expect(page.locator('.history-card').first()).toContainText('1차 현황 점검');
  await expect(page.locator('.history-card').last()).toContainText('2차 실무 회의');
  await expect(page.getByRole('button', { name: '간략히 보기', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('searchbox', { name: '검색어' })).toHaveCount(0);
  await page.locator('.history-card').last().click();
  const title = await page.locator('.history-card').last().locator('.history-title').innerText();
  await page.getByRole('button', { name: '간략히 보기', exact: true }).click();
  await expect(page.locator('.history-layout')).toHaveClass(/is-compact/);
  await expect(page.getByRole('searchbox', { name: '검색어' })).toHaveCount(0);
  await expect(page.locator('.history-detail-panel h2')).toHaveText(title);
  await page.getByRole('button', { name: '리스트로 보기', exact: true }).click();
  await expect(page.locator('.history-layout')).not.toHaveClass(/is-compact/);
  await expect(page.locator('.history-card').first()).toContainText('2차 실무 회의');
  await expect(page.locator('.history-detail-panel h2')).toHaveText(title);
  const trigger = page.getByRole('button', { name: /^검색 조건:/ });
  await trigger.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('home search aligns with the greeting on desktop', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile');
  await page.goto('/');
  const search = await page.locator('.search-trigger').boundingBox();
  const greeting = await page.locator('.page-intro h1').boundingBox();
  expect(Math.abs(search!.x - greeting!.x)).toBeLessThan(2);
});
