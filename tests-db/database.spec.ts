import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';

test('clean workspace: four accounts, staff directory, first meeting and shared files', async ({
  page,
  browser,
  request,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('robot-butler:preview-user:v1'))
      sessionStorage.setItem('robot-butler:preview-user:v1', 'me');
  });
  const catalog = await (await request.get('/api/demo/directory')).json();
  expect(catalog.people).toHaveLength(4);
  expect(catalog.people.filter((p: { isTestAccount?: boolean }) => p.isTestAccount)).toHaveLength(
    4,
  );
  expect(catalog.rooms).toHaveLength(5);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: '테스트 계정 선택' })).toBeVisible();
  await mkdir('test-results/clean-workspace', { recursive: true });
  await page.screenshot({ path: 'test-results/clean-workspace/accounts.png', fullPage: true });
  for (const name of ['태평양', '정금결', '장금별', '김금달']) {
    await page.getByRole('button', { name: `${name}으로 시작` }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
    await expect(page.getByText('아직 예정된 회의가 없어요')).toBeVisible();
    await expect(page.getByText('아직 참여 중인 토픽이 없어요')).toBeVisible();
    await expect(page.getByRole('link', { name: '관리자 관리', exact: true })).toHaveCount(
      name === '태평양' ? 1 : 0,
    );
    await expect(page.locator('.account-chooser')).toHaveCount(0);
    await expect(page.locator('.test-session-bar')).toHaveCount(0);
    await page.getByRole('button', { name: '내 프로필', exact: true }).click();
    await page.getByRole('button', { name: '테스트 계정 변경', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('navigation', { name: '주 메뉴' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '테스트 계정 선택' })).toBeVisible();
    await page.getByRole('button', { name: `${name}으로 시작` }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
    await page.getByRole('button', { name: '내 프로필', exact: true }).click();
    await page.getByRole('button', { name: '테스트 계정 변경', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
  await page.getByRole('button', { name: '정금결으로 시작' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('정금결');
  await page.screenshot({ path: 'test-results/clean-workspace/empty-home.png', fullPage: true });
  await page.getByRole('link', { name: '토픽 만들기', exact: true }).first().click();
  await page.getByLabel(/^주제명/).fill('첫 회의 테스트');
  await page.getByLabel(/^한줄 설명/).fill('빈 상태에서 시작하는 회의 생성');
  await page
    .getByRole('group', { name: 'Master', exact: true })
    .getByRole('searchbox')
    .fill('장금별');
  await page.getByRole('checkbox', { name: /장금별/ }).check();
  await page
    .getByRole('group', { name: 'Master', exact: true })
    .getByRole('searchbox')
    .fill('김금달');
  await page.getByRole('checkbox', { name: /김금달/ }).check();
  await page
    .getByRole('group', { name: 'Master', exact: true })
    .getByRole('searchbox')
    .fill('박성민');
  await page.getByRole('checkbox', { name: /박성민/ }).check();
  await page.getByRole('button', { name: '토픽 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '첫 회의 테스트' })).toBeVisible();
  await page.getByRole('link', { name: '회의 만들기', exact: true }).click();
  await page.getByLabel(/^회의명/).fill('처음 만드는 회의');
  await page.getByLabel(/^회의 내용·안건/).fill('직원 선택과 자료 저장 확인');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel('회의 일자 *').fill(date);
  await page.getByRole('button', { name: '14:00 예약 가능', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  const picker = page.locator('.people-picker');
  await expect(picker.getByRole('checkbox')).toHaveCount(4);
  await picker.getByRole('button', { name: '전체 추가', exact: true }).click();
  await expect(picker.getByRole('checkbox', { name: /장금별/ })).toBeChecked();
  await picker.getByRole('searchbox').fill('CMS개발팀');
  await expect(picker.getByRole('checkbox')).toHaveCount(1);
  await picker.getByRole('checkbox', { name: /김금달/ }).check();
  await picker.getByRole('searchbox').fill('박성민');
  await expect(picker.getByRole('checkbox')).toHaveCount(1);
  await expect(picker.locator('.person-option .person-avatar')).toHaveText('박');
  await expect(picker.getByText('시스템관리팀 · 팀장')).toBeVisible();
  await picker.getByRole('checkbox', { name: /박성민/ }).check();
  await picker.getByRole('searchbox').fill('');
  await page.screenshot({ path: 'test-results/clean-workspace/staff-picker.png', fullPage: true });
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('radio', { name: '자료 첨부', exact: true }).check();
  await page.getByLabel('회의 자료 선택', { exact: true }).setInputFiles({
    name: '첫회의.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('첫 회의 자료'),
  });
  await page.getByRole('button', { name: '회의 생성', exact: true }).click();
  await expect(page.getByRole('heading', { name: '회의 생성이 완료되었어요!' })).toBeVisible();
  await page.getByRole('link', { name: '회의 상세 보기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '처음 만드는 회의', exact: true })).toBeVisible();
  const url = page.url();
  await page.reload();
  await expect(page.getByRole('heading', { name: '처음 만드는 회의', exact: true })).toBeVisible();
  const second = await browser.newContext({ baseURL: 'http://127.0.0.1:4175' });
  await second.addInitScript(() =>
    sessionStorage.setItem('robot-butler:preview-user:v1', 'jooyoung'),
  );
  const other = await second.newPage();
  await other.goto(url);
  await expect(other.getByRole('heading', { name: '처음 만드는 회의', exact: true })).toBeVisible();
  await other.getByRole('button', { name: '자료 1', exact: true }).click();
  const download = other.waitForEvent('download');
  await other.getByRole('button', { name: '첫회의.txt 다운로드' }).click();
  expect((await readFile((await (await download).path())!)).toString()).toBe('첫 회의 자료');
  await other.screenshot({
    path: 'test-results/clean-workspace/shared-meeting.png',
    fullPage: true,
  });
  await other.goto('/rooms');
  await other.locator('.room-list-item').filter({ hasText: '9층 대회의실' }).click();
  // A reservation three days ahead can belong to the next month at month-end.
  const [bookingYear, bookingMonth] = date.split('-').map(Number);
  const calendarHeading = other.locator('.room-calendar-header h3');
  const displayedMonth = await calendarHeading.innerText();
  const [currentYear, currentMonth] = displayedMonth.match(/\d+/g)!.map(Number);
  const monthOffset = (bookingYear - currentYear) * 12 + bookingMonth - currentMonth;
  for (let i = 0; i < Math.abs(monthOffset); i++)
    await other
      .getByRole('button', { name: monthOffset > 0 ? '다음 달' : '이전 달', exact: true })
      .click();
  await expect(calendarHeading).toHaveText(`${bookingYear}년 ${bookingMonth}월`);
  await other.getByRole('button', { name: new RegExp(`^${date}, 회의`) }).click();
  await expect(other.locator('.room-agenda')).toContainText('처음 만드는 회의');
  await page.route('**/api/demo/roomSchedule', (route) =>
    route.fulfill({ status: 500, json: { error: 'test' } }),
  );
  await page.goto('/rooms');
  await expect(page.getByRole('alert')).toContainText('회의실 일정을 불러오지 못했어요');
  await expect(page.locator('.room-agenda')).not.toContainText('표시할 예정 회의가 없어요');
  await page.unroute('**/api/demo/roomSchedule');
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const forbidden = await request.post('/api/demo/snapshot', { data: ['employee-01'] });
  expect(forbidden.status()).toBe(400);
  await second.close();
});
