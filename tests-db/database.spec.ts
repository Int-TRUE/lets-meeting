import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test('shared SQLite history, permissions, PDFs and cross-browser persistence', async ({
  page,
  browser,
  request,
}) => {
  await page.goto('/topics');
  await expect(page.getByRole('heading', { name: 'Topic', exact: true })).toBeVisible();
  await page.getByRole('link').filter({ hasText: '2026년 IT운영팀 팀 회의' }).click();
  await expect(page.getByText('강경희 팀장 · IT운영팀', { exact: false })).toBeVisible();
  await expect(page.getByText('3명씩 업무분장을 묶기로 함.')).toBeVisible();
  await page.goto('/topics/autopay');
  await expect(page.getByText('/prov2를 만들자.')).toBeVisible();
  await expect(page.getByText('/prov3를 만들자.')).toBeVisible();
  await page.goto('/meetings/autopay-prov2?tab=files');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /자동이체_동의자료_보관_2023.pdf/ }).click();
  expect((await download).suggestedFilename()).toBe('자동이체_동의자료_보관_2023.pdf');
  await page.goto('/meetings/equipment-vendor');
  await expect(page.getByText('이 정보에 접근할 수 없어요')).toBeVisible();
  await mkdir('docs/qa/database-refinement', { recursive: true });
  for (const [name, path] of [
    ['home', '/'],
    ['history', '/topics/it-2026'],
    ['autopay', '/topics/autopay'],
    ['notifications', '/settings/notifications'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.screenshot({ path: `docs/qa/database-refinement/${name}.png`, fullPage: true });
  }
  const second = await browser.newContext({ baseURL: 'http://127.0.0.1:4175' });
  await second.addInitScript(() =>
    sessionStorage.setItem('robot-butler:preview-user:v1', 'juhyung'),
  );
  const other = await second.newPage();
  await other.goto('/topics/equipment-2026');
  await expect(other.getByRole('heading', { name: '공급사 일정·예산 검토' })).toBeVisible();
  const res = await request.post('/api/demo/createTopic', {
    data: [
      'juhyung',
      {
        title: 'DB 공동 저장 확인',
        description: '다른 브라우저에서도 같은 자료를 읽습니다.',
        managerIds: ['me'],
      },
      'browser-shared-topic',
    ],
  });
  expect(res.ok()).toBe(true);
  const { result: id } = await res.json();
  await page.goto(`/topics/${id}`);
  await expect(page.getByRole('heading', { name: 'DB 공동 저장 확인' })).toBeVisible();
  await other.goto(`/topics/${id}`);
  await expect(other.getByRole('heading', { name: 'DB 공동 저장 확인' })).toBeVisible();
  const forbidden = await request.post('/api/demo/download', {
    data: ['juhyung', 'autopay-prov2', 'file-autopay-prov2'],
  });
  expect(forbidden.status()).toBe(400);
  await other.goto('/topics/equipment-2026/meetings/new');
  await other.getByLabel(/^회의명/).fill('DB 브라우저 생성 회의');
  await other.getByLabel(/^회의 내용·안건/).fill('SQLite 저장 및 파일 재조회 검증');
  await other.getByRole('button', { name: '다음', exact: true }).click();
  await other.getByLabel('회의 일자 *').fill('2026-10-24');
  await other.getByRole('button', { name: '14:00 예약 가능', exact: true }).click();
  await other.getByRole('button', { name: '다음', exact: true }).click();
  await other.getByRole('checkbox', { name: /나\(데모\)/ }).check();
  await other.getByRole('radio', { name: '자료 첨부', exact: true }).check();
  await other.getByLabel('회의 자료 선택', { exact: true }).setInputFiles({
    name: '공유자료.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('DB에 저장한 자료'),
  });
  await other.getByRole('button', { name: '회의 생성', exact: true }).click();
  await expect(other.getByRole('heading', { name: '회의 생성이 완료되었어요!' })).toBeVisible();
  await other.getByRole('link', { name: '회의 상세 보기', exact: true }).click();
  await page.goto(other.url());
  await expect(
    page.getByRole('heading', { name: 'DB 브라우저 생성 회의', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '자료 1', exact: true }).click();
  const sharedFile = page.waitForEvent('download');
  await page.getByRole('button', { name: '공유자료.txt 다운로드' }).click();
  expect((await sharedFile).suggestedFilename()).toBe('공유자료.txt');
  await second.close();
});
