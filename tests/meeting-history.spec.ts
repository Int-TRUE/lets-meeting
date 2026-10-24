import { test, expect } from '@playwright/test';

test('history expands in place, saves checklist state and keeps detail navigation separate', async ({
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
  const toggle = card.getByRole('button', { name: /요약 펼치기/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(card.getByRole('region', { name: '회의 요약', exact: true })).toHaveCount(0);
  await expect(card).not.toContainText('명동 · 3층 회의실 A');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/topics\/brand$/);
  await expect(card.getByRole('region', { name: '회의 요약', exact: true })).toContainText(
    '새 브랜드의 방향',
  );
  await card.getByLabel('디자인 시안 공유하기', { exact: true }).check();
  await expect(card.getByLabel('디자인 시안 공유하기', { exact: true })).toBeEnabled();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  await card.getByRole('button', { name: /요약 접기/ }).click();
  await expect(card.getByRole('checkbox')).toHaveCount(0);
  await card.getByRole('button', { name: /요약 펼치기/ }).click();
  await expect(card.getByLabel('디자인 시안 공유하기', { exact: true })).toBeChecked();
  await page.reload();
  await card.getByRole('button', { name: /요약 펼치기/ }).click();
  await expect(card.getByLabel('디자인 시안 공유하기', { exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/polished-history-${info.project.name}.png`,
    fullPage: true,
  });
  await card.getByRole('link', { name: '상세보기', exact: true }).click();
  await expect(page).toHaveURL(/\/meetings\/strategy$/);
  const delivery = page.getByRole('region', { name: '매터모스트 발송 결과' });
  await expect(delivery.getByRole('button', { name: '발송 결과 새로고침' })).toBeEnabled();
  await delivery.getByRole('button', { name: '발송 결과 새로고침' }).click();
  await expect(delivery.getByRole('status')).not.toContainText('확인 중');
  await page.screenshot({
    path: `test-results/polished-delivery-${info.project.name}.png`,
    fullPage: true,
  });
});

test('history without summary opens an honest empty state', async ({ page }) => {
  await page.goto('/topics/system');
  const card = page.locator('.history-card').filter({ hasText: '전산기기 교체 · 2차 실무 회의' });
  await card.getByRole('button', { name: /요약 펼치기/ }).click();
  await expect(card).toContainText('아직 등록된 요약이 없어요');
  await expect(card).toContainText('등록된 후속 작업이 없어요');
  await expect(card.getByRole('checkbox')).toHaveCount(0);
});
