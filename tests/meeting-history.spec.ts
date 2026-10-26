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
  await page.getByRole('button', { name: '임시 저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('요약을 저장했어요');
  await page.goto('/topics/brand');
  const card = page.locator('.history-card').filter({ hasText: '브랜드 방향성 정리' });
  const toggle = card;
  const panel = page.getByRole('region', { name: '선택한 회의 상세', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByRole('region', { name: '회의 요약', exact: true })).toHaveCount(0);
  await expect(card).not.toContainText('명동 · 3층 회의실 A');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/topics\/brand$/);
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
  await page.goto('/topics/system');
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

test('compact cards retain arrows and switch one panel below the entire flow', async ({
  page,
}, info) => {
  await page.goto('/topics/system');
  const cards = page.locator('.history-card');
  await expect(cards).toHaveCount(2);
  const panel = page.getByRole('region', { name: '선택한 회의 상세', exact: true });
  await expect(panel).toContainText('회의 카드를 선택해주세요');
  await cards.first().click();
  const firstTitle = await cards.first().locator('.history-title').innerText();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(firstTitle);
  await cards.last().click();
  await expect(cards.first()).toHaveAttribute('aria-pressed', 'false');
  await expect(cards.last()).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(
    await cards.last().locator('.history-title').innerText(),
  );
  const flow = await page.locator('.history-flow').boundingBox();
  const detail = await panel.boundingBox();
  expect(detail!.y).toBeGreaterThanOrEqual(flow!.y + flow!.height);
  expect((await cards.first().boundingBox())!.height).toBeLessThan(280);
  expect(
    await page
      .locator('.history-flow > li')
      .first()
      .evaluate((el) => getComputedStyle(el, '::after').content),
  ).toContain('→');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/history-flow-${info.project.name}.png`,
    fullPage: true,
  });
});
