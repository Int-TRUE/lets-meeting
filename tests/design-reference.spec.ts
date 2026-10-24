import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Source app rectangles, not the outside presentation-board captions.
const frames: Record<string, [string, number, number, number, number]> = {
  '01-login': ['01-brand-and-entry', 20, 34, 740, 496],
  '02-home': ['01-brand-and-entry', 776, 34, 742, 496],
  '03-search': ['01-brand-and-entry', 20, 570, 740, 438],
  '04-empty': ['01-brand-and-entry', 776, 568, 742, 440],
  '05-topics': ['02-topic-and-permissions', 22, 40, 730, 480],
  '06-topic-create': ['02-topic-and-permissions', 790, 40, 724, 480],
  '07-topic-detail': ['02-topic-and-permissions', 22, 566, 730, 440],
  '08-topic-settings': ['02-topic-and-permissions', 790, 568, 724, 438],
  '09-meeting-info': ['03-meeting-creation', 20, 20, 742, 484],
  '10-reservation': ['03-meeting-creation', 776, 20, 742, 484],
  '11-participants': ['03-meeting-creation', 20, 520, 742, 482],
  '12-created': ['03-meeting-creation', 776, 520, 742, 482],
  '13-meeting-detail': ['04-meeting-lifecycle', 20, 10, 742, 494],
  '14-materials': ['04-meeting-lifecycle', 776, 10, 742, 494],
  '15-summary': ['04-meeting-lifecycle', 20, 518, 742, 484],
  '16-cancel': ['04-meeting-lifecycle', 776, 518, 742, 484],
  '17-notifications': ['05-notifications-and-admin', 16, 10, 748, 508],
  '19-admin': ['05-notifications-and-admin', 16, 528, 748, 484],
  '20-rooms': ['05-notifications-and-admin', 776, 528, 746, 484],
};

test('desktop reference captures across the approved screen flow', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Desktop design reference');
  test.setTimeout(180_000);
  const out = 'test-results/desktop-reference';
  await mkdir(out, { recursive: true });
  const reference = await context.newPage();
  async function capture(id: string) {
    const [board, x, y, w, h] = frames[id];
    await page.setViewportSize({ width: w * 2, height: h * 2 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${out}/${id}-actual.png` });
    await reference.setViewportSize({ width: w * 2, height: h * 2 });
    await reference.setContent(
      `<style>body{margin:0;overflow:hidden}img{position:absolute;width:3072px;max-width:none;left:-${x * 2}px;top:-${y * 2}px}</style><img src="http://127.0.0.1:4173/docs/design/assets/${board}.png">`,
    );
    await reference.locator('img').evaluate((img: HTMLImageElement) => img.decode());
    await reference.screenshot({ path: `${out}/${id}-reference.png` });
  }
  async function open(path: string) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  await open('/login');
  await capture('01-login');
  await open('/');
  await capture('02-home');
  await page.locator('.search-trigger').click();
  await page.getByRole('textbox', { name: '검색어' }).fill('전산기기');
  await capture('03-search');
  await page.keyboard.press('Escape');
  await page.locator('.preview-tools summary').click();
  await page.getByLabel('화면 상태').selectOption('empty-meetings');
  await expect(page.getByRole('heading', { name: '아직 예정된 회의가 없어요' })).toBeVisible();
  await page.locator('.preview-tools summary').click();
  await capture('04-empty');
  await open('/topics');
  await capture('05-topics');
  await page.getByRole('link', { name: 'Topic 만들기', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await capture('06-topic-create');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await open('/topics/system');
  await capture('07-topic-detail');
  await open('/topics/system/settings');
  await capture('08-topic-settings');
  await open('/topics/system/meetings/new');
  await page.getByLabel(/^회의명/).fill('전산기기 교체 · 2차 실무 회의');
  await page
    .getByLabel(/^회의 내용·안건/)
    .fill('교체 대상 장비와 설치 일정, 부서별 준비 사항을 확인합니다.');
  await capture('09-meeting-info');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('회의 일자 *').fill('2026-10-22');
  await page.getByRole('button', { name: '14:00 예약 가능', exact: true }).click();
  await page.getByRole('button', { name: '14:30 예약 가능', exact: true }).click();
  await capture('10-reservation');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await capture('11-participants');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '회의 생성', exact: true }).click();
  await expect(page.getByRole('heading', { name: '회의 생성이 완료되었어요!' })).toBeVisible();
  await capture('12-created');
  await open('/meetings/equipment');
  await capture('13-meeting-detail');
  await page.getByRole('button', { name: '자료 2', exact: true }).click();
  await capture('14-materials');
  await open('/meetings/strategy/summary');
  await capture('15-summary');
  await open('/meetings/equipment');
  await page.getByRole('button', { name: '회의 취소', exact: true }).click();
  await capture('16-cancel');
  await page.getByRole('button', { name: '돌아가기', exact: true }).click();
  await open('/settings/notifications');
  await expect(page.getByRole('switch', { name: '자료 등록·수정' })).toBeEnabled();
  await capture('17-notifications');
  await page.locator('.preview-tools summary').click();
  await page.getByLabel('예시 사용자').selectOption('ops');
  await expect(page.getByRole('status', { name: '홈 정보를 불러오는 중' })).toHaveCount(0);
  await open('/admin/notifications');
  await expect(page.getByRole('heading', { name: '관리자 발송 이력' })).toBeVisible();
  await capture('19-admin');
  await open('/admin/rooms');
  await capture('20-rooms');
  await reference.close();
});
