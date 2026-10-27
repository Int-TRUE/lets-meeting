import { test, expect } from '@playwright/test';

test('participants share summary edits before and after creator completion', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('robot-butler:preview-user:v1'))
      sessionStorage.setItem('robot-butler:preview-user:v1', 'jung');
  });
  await page.goto('/meetings/strategy?tab=summary');
  await page.getByRole('link', { name: '요약 작성', exact: true }).last().click();
  await expect(page.getByRole('button', { name: '요약 저장 및 회의 완료' })).toHaveCount(0);
  await page.getByLabel('주요 논의 내용', { exact: true }).fill('참가자 공동 요약');
  await page.getByRole('button', { name: '요약 저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('요약을 저장했어요');
  await page.reload();
  await expect(page.getByLabel('주요 논의 내용', { exact: true })).toHaveValue('참가자 공동 요약');
  await page.evaluate(() => sessionStorage.setItem('robot-butler:preview-user:v1', 'kim'));
  await page.reload();
  await page.getByRole('button', { name: '요약 저장 및 회의 완료' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '저장 및 완료', exact: true }).click();
  await expect(page.getByText('완료된 요약', { exact: true })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('robot-butler:preview-user:v1', 'jung'));
  await page.reload();
  await page.getByRole('link', { name: '요약 수정', exact: true }).last().click();
  await page.getByLabel('결정 사항', { exact: true }).fill('완료 후 참가자 수정');
  await page.getByRole('button', { name: '요약 저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('완료 상태는 유지');
  await page.reload();
  await expect(page.getByLabel('결정 사항', { exact: true })).toHaveValue('완료 후 참가자 수정');
  await expect(page.getByRole('button', { name: '요약 저장 및 회의 완료' })).toHaveCount(0);
});
