import { expect, test } from '@playwright/test';

test('Topic creation entry stays fresh after leaving an existing meeting edit', async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem('robot-butler:preview-user:v1', 'lee'));
  await page.goto('/meetings/equipment/edit');
  await expect(page.getByRole('heading', { level: 1, name: '회의 수정' })).toBeVisible();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '초안 지우고 나가기' }).click();
  await page.getByRole('link', { name: '회의 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '회의 만들기' })).toBeVisible();
  await expect(page.getByLabel(/^회의명/)).toHaveValue('');
});

test('explicit new meeting starts empty even when an earlier draft exists', async ({ page }) => {
  await page.goto('/topics/system/meetings/new');
  await page.getByLabel(/^회의명/).fill('이전에 작성한 회의');
  await page.getByLabel(/^회의 내용·안건/).fill('이전 초안 내용');
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/topics/system');
  await page.getByRole('link', { name: '회의 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '회의 만들기' })).toBeVisible();
  await expect(page.getByLabel(/^회의명/)).toHaveValue('');
  await expect(page.getByLabel(/^회의 내용·안건/)).toHaveValue('');
  await page.getByLabel(/^회의명/).fill('새로운 회의');
  await page.getByLabel(/^회의 내용·안건/).fill('새 회의 안건');
  await page.reload();
  await expect(page.getByLabel(/^회의명/)).toHaveValue('새로운 회의');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('회의 일자 *').fill('2026-10-21');
  await page.getByRole('button', { name: '14:00 예약 가능', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '회의 생성', exact: true }).click();
  await expect(page.getByRole('heading', { name: '회의 생성이 완료되었어요!' })).toBeVisible();
  await page.getByRole('link', { name: 'Topic으로 이동', exact: true }).click();
  await expect(page.locator('.flow-card')).toHaveCount(3);
  await expect(
    page.locator('.flow-card').filter({ hasText: '전산기기 교체 · 2차 실무 회의' }),
  ).toBeVisible();
  await page.getByRole('link', { name: '회의 만들기', exact: true }).click();
  await expect(page.getByLabel(/^회의명/)).toHaveValue('');
});
