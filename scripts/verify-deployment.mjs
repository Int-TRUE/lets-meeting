import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const target = new URL(process.env.DEPLOYMENT_URL ?? '');
assert.equal(target.protocol, 'https:');
assert.ok(target.hostname.endsWith('.vercel.app'));
const auth = process.env.VERCEL_OIDC_TOKEN
  ? { 'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN }
  : {};
const rpc = async (method, args) => {
  const response = await fetch(new URL('/api/demo/' + method, target), {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  assert.equal(response.status, 200, `API ${method}: HTTP ${response.status}`);
  return (await response.json()).result;
};
const directory = await fetch(new URL('/api/demo/directory', target), { headers: auth });
assert.equal(directory.status, 200, 'directory API must be accessible');
assert.equal((await directory.json()).people.length, 15);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const output = 'test-results/deployment';
await mkdir(output, { recursive: true });
try {
  const newContext = async (actor) => {
    const context = await browser.newContext({
      baseURL: target.origin,
      viewport: { width: 1484, height: 992 },
    });
    // Limit the short-lived credential to this exact deployment origin.
    await context.route(target.origin + '/**', (route) =>
      route.continue({ headers: { ...route.request().headers(), ...auth } }),
    );
    await context.addInitScript(
      (actor) => sessionStorage.setItem('robot-butler:preview-user:v1', actor),
      actor,
    );
    return context;
  };
  const context = await newContext('me');
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('나(데모)');
  await page.screenshot({ path: output + '/home.png', fullPage: true });
  await page.goto('/topics/it-2026');
  await expect(page.getByText('3명씩 업무분장을 묶기로 함.')).toBeVisible();
  await page.screenshot({ path: output + '/history.png', fullPage: true });
  await page.goto('/meetings/autopay-prov2?tab=files');
  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: /자동이체_동의자료_보관_2023.pdf/ }).click();
  const pdfBytes = await readFile(await (await pdf).path());
  assert.equal(pdfBytes.subarray(0, 4).toString(), '%PDF');
  await page.goto('/meetings/equipment-vendor');
  await expect(page.getByText('이 정보에 접근할 수 없어요')).toBeVisible();

  if (process.env.DEPLOYMENT_WRITE_TEST === 'true') {
    // Only enable writes for an isolated Preview namespace, never Production.
    assert.notEqual(target.hostname, 'robot-butler.vercel.app');
    const id = await rpc('createTopic', [
      'juhyung',
      {
        title: '배포 DB 검증 ' + randomUUID().slice(0, 8),
        description: '격리된 미리보기에서 생성·재조회·자료 다운로드 확인',
        managerIds: ['me'],
      },
      randomUUID(),
    ]);
    const blocked = await rpc('availability', ['juhyung', 'it-room', '2026-10-24']);
    const hour = ['14:00', '15:00', '16:00', '10:00'].find((value) => !blocked.includes(value));
    assert.ok(hour, 'a free test slot is required');
    const otherContext = await newContext('juhyung');
    const other = await otherContext.newPage();
    other.setDefaultTimeout(30_000);
    await other.goto(`/topics/${id}/meetings/new`);
    await other.getByLabel(/^회의명/).fill('Vercel DB 저장 검증');
    await other
      .getByLabel(/^회의 내용·안건/)
      .fill('다른 브라우저에서 같은 회의와 파일을 읽습니다.');
    await other.getByRole('button', { name: '다음', exact: true }).click();
    await other.getByLabel('회의 일자 *').fill('2026-10-24');
    await other.getByRole('button', { name: hour + ' 예약 가능', exact: true }).click();
    await other.getByRole('button', { name: '다음', exact: true }).click();
    await other.getByRole('checkbox', { name: /나\(데모\)/ }).check();
    await other.getByRole('radio', { name: '자료 첨부', exact: true }).check();
    await other.getByLabel('회의 자료 선택', { exact: true }).setInputFiles({
      name: '배포검증.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('영속 DB 공유 자료'),
    });
    await other.getByRole('button', { name: '회의 생성', exact: true }).click();
    await expect(other.getByRole('heading', { name: '회의 생성이 완료되었어요!' })).toBeVisible();
    await other.getByRole('link', { name: '회의 상세 보기', exact: true }).click();
    await page.goto(other.url());
    await expect(
      page.getByRole('heading', { name: 'Vercel DB 저장 검증', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '자료 1', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '배포검증.txt 다운로드' }).click();
    assert.equal((await readFile(await (await download).path())).toString(), '영속 DB 공유 자료');
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Vercel DB 저장 검증', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: output + '/persisted-meeting.png', fullPage: true });
    await otherContext.close();
  }
  console.log(
    JSON.stringify({
      status: 'passed',
      origin: target.origin,
      checks: [
        'directory',
        'home',
        'history',
        'PDF bytes',
        'permissions',
        ...(process.env.DEPLOYMENT_WRITE_TEST === 'true'
          ? ['meeting creation', 'cross-browser persistence', 'uploaded file bytes', 'reload']
          : []),
      ],
      screenshots: output,
    }),
  );
} finally {
  await browser.close();
}
