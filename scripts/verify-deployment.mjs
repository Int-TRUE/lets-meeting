import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
const directoryResponse = await fetch(new URL('/api/demo/directory', target), { headers: auth });
assert.equal(directoryResponse.status, 200);
const catalog = await directoryResponse.json();
assert.equal(catalog.people.length, 24);
assert.deepEqual(
  catalog.people
    .filter((p) => p.isTestAccount)
    .map((p) => p.name)
    .sort(),
  ['김태헌', '정수진', '장우석', '김주영'].sort(),
);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const output = 'test-results/deployment';
await mkdir(output, { recursive: true });
try {
  const newContext = async (actor) => {
    const context = await browser.newContext({
      baseURL: target.origin,
      viewport: { width: 1484, height: 992 },
    });
    // The short-lived credential is sent only to this exact deployment origin.
    await context.route(target.origin + '/**', (route) =>
      route.continue({ headers: { ...route.request().headers(), ...auth } }),
    );
    if (actor)
      await context.addInitScript(
        (actor) => sessionStorage.setItem('robot-butler:preview-user:v1', actor),
        actor,
      );
    return context;
  };
  const context = await newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: '테스트 계정 선택' })).toBeVisible();
  await page.screenshot({ path: output + '/accounts.png', fullPage: true });
  await page.getByRole('button', { name: '정수진으로 시작' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('정수진');
  await page.locator('img').evaluateAll((images) => Promise.all(images.map((img) => img.decode())));
  await page.screenshot({ path: output + '/home.png', fullPage: true });
  await page.goto('/rooms');
  const center = page.getByLabel('센터', { exact: true });
  await expect(center).toHaveValue('명동');
  await expect(center.locator('option')).toHaveText(['명동', '분당']);
  await expect(page.locator('.room-list-item')).toHaveCount(4);
  await center.selectOption('분당');
  await expect(page.locator('.room-list-item')).toHaveCount(1);
  await expect(page.locator('.room-list-item')).toContainText('분당');
  await expect(page.locator('.room-schedule h2')).toHaveText('분당 · 3층 회의실 일정');
  await center.selectOption('명동');
  await expect(page.getByRole('group', { name: '회의실 일정 달력' })).toBeVisible();
  await expect(page.locator('.room-agenda > h3')).toContainText(/예정 회의 \d+개/);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const roomInfo = page.getByRole('region', { name: '회의실 정보' });
  await expect(roomInfo).toBeVisible();
  const listBox = await page.locator('.rooms-list').boundingBox();
  const infoBox = await roomInfo.boundingBox();
  assert.ok(infoBox.y > listBox.y + listBox.height);
  assert.ok(Math.abs(infoBox.x - listBox.x) < 2);
  await page.screenshot({ path: output + '/rooms.png', fullPage: true });
  if (process.env.DEPLOYMENT_WRITE_TEST === 'true') {
    // The caller must verify this is a Preview deployment before enabling writes.
    assert.notEqual(target.hostname, 'robot-butler.vercel.app');
    const topicId = await rpc('createTopic', [
      'sujin',
      {
        title: '배포 검증 ' + randomUUID().slice(0, 8),
        description: '빈 DB의 첫 회의·참가자·자료 검증',
        managerIds: ['wooseok', 'jooyoung', 'employee-01'],
      },
      randomUUID(),
    ]);
    await page.goto(`/topics/${topicId}/meetings/new`);
    await page.getByLabel(/^회의명/).fill('첫 회의 배포 검증');
    await page.getByLabel(/^회의 내용·안건/).fill('다른 계정과 브라우저에서 자료를 공유합니다.');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    await page.getByLabel('회의 일자 *').fill(date);
    await page.getByRole('button', { name: '14:00 예약 가능', exact: true }).click();
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expect(page.locator('.people-picker').getByRole('checkbox')).toHaveCount(4);
    await page.getByRole('checkbox', { name: /김주영/ }).check();
    await page.getByRole('checkbox', { name: /박성민/ }).check();
    await page.screenshot({ path: output + '/staff-picker.png', fullPage: true });
    await page.getByRole('radio', { name: '자료 첨부', exact: true }).check();
    await page.getByLabel('회의 자료 선택', { exact: true }).setInputFiles({
      name: '배포검증.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('새 테스트 환경의 공유 자료'),
    });
    await page.getByRole('button', { name: '회의 생성', exact: true }).click();
    await expect(page.getByRole('heading', { name: '회의 생성이 완료되었어요!' })).toBeVisible();
    await page.getByRole('link', { name: '회의 상세 보기', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '첫 회의 배포 검증', exact: true }),
    ).toBeVisible();
    const meetingUrl = page.url();
    const meetingId = new URL(meetingUrl).pathname.split('/').pop();
    await writeFile(
      output + '/created-records.json',
      JSON.stringify({ origin: target.origin, topicId, meetingId }),
    );
    const outsiderRows = await rpc('roomSchedule', [
      'taeheon',
      catalog.rooms[0].id,
      date.slice(0, 7),
    ]);
    assert.ok(outsiderRows.some((row) => row.id === meetingId && row.canOpen === false));
    const outsiderSnapshot = await rpc('snapshot', ['taeheon']);
    assert.ok(!outsiderSnapshot.meetings.some((row) => row.id === meetingId));
    const otherContext = await newContext('jooyoung');
    const other = await otherContext.newPage();
    other.setDefaultTimeout(30_000);
    await other.goto(meetingUrl);
    await expect(
      other.getByRole('heading', { name: '첫 회의 배포 검증', exact: true }),
    ).toBeVisible();
    await other.getByRole('button', { name: '자료 1', exact: true }).click();
    const download = other.waitForEvent('download');
    await other.getByRole('button', { name: '배포검증.txt 다운로드' }).click();
    assert.equal(
      (await readFile(await (await download).path())).toString(),
      '새 테스트 환경의 공유 자료',
    );
    await other.reload();
    await expect(
      other.getByRole('heading', { name: '첫 회의 배포 검증', exact: true }),
    ).toBeVisible();
    await other.screenshot({ path: output + '/persisted-meeting.png', fullPage: true });
    await otherContext.close();
  }
  console.log(
    JSON.stringify({
      status: 'passed',
      origin: target.origin,
      checks: [
        '24 employees',
        '4 account choices',
        'home',
        ...(process.env.DEPLOYMENT_WRITE_TEST === 'true'
          ? ['first meeting', 'staff picker', 'cross-browser persistence', 'file bytes', 'reload']
          : []),
      ],
      screenshots: output,
    }),
  );
} finally {
  await browser.close();
}
