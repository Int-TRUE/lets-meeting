import { expect, test, type Page } from '@playwright/test';
async function open(page: Page, path = '/topics') {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
async function createMeeting(page: Page, title = '테스트 협업 회의', upload = false) {
  await open(page, '/topics/system/meetings/new');
  await page.getByLabel(/^회의명/).fill(title);
  await page.getByLabel(/^회의 내용·안건/).fill('도입 일정과 준비 자료를 함께 확인합니다.');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByLabel('회의 일자 *').fill('2026-10-21');
  await page.getByRole('button', { name: '14:00 예약 가능', exact: true }).click();
  await page.getByRole('button', { name: '14:30 예약 가능', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.locator('.people-picker').getByRole('searchbox').fill('박지우');
  await page.getByRole('checkbox', { name: /박지우/ }).check();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  if (upload) {
    await page.getByRole('radio', { name: '자료 첨부', exact: true }).check();
    await page.getByLabel('회의 자료 선택', { exact: true }).setInputFiles({
      name: '회의자료.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('회의 안건과 자료'),
    });
  }
  await page.getByRole('button', { name: '회의 생성', exact: true }).click();
  await expect(page.getByRole('heading', { name: '회의 생성이 완료되었어요!' })).toBeVisible();
  await expect(page.getByRole('region', { name: '매터모스트 발송 결과' })).toHaveCount(0);
  await page.getByRole('link', { name: '회의 상세 보기', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  return page.url();
}
async function user(page: Page, id: string) {
  const tools = page.locator('.preview-tools');
  if ((await tools.getAttribute('open')) === null) await tools.locator('summary').click();
  await page.getByLabel('예시 사용자').selectOption(id);
  await expect(page.getByRole('status', { name: '홈 정보를 불러오는 중' })).toHaveCount(0);
}
test('토픽 creation, filters, owner editing and reload persistence', async ({ page }, info) => {
  await open(page);
  await page.getByRole('link', { name: '토픽 만들기', exact: true }).click();
  await expect(page.locator('.people-options').getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '전체 추가', exact: true })).toHaveCount(0);
  const optionsBox = (await page.locator('.people-options').boundingBox())!;
  const noticeBox = (await page.locator('.people-search-status').boundingBox())!;
  expect(
    Math.abs(optionsBox.x + optionsBox.width / 2 - noticeBox.x - noticeBox.width / 2),
  ).toBeLessThan(2);
  await page.getByLabel(/^주제명/).fill('장기 협업 프로젝트');
  await page.getByLabel(/^한줄 설명/).fill('여러 회의를 하나의 흐름으로 관리합니다.');
  await page.locator('.people-picker').getByRole('searchbox').fill('이서준');
  await page.getByRole('checkbox', { name: /이서준/ }).check();
  await page.getByRole('button', { name: '토픽 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '장기 협업 프로젝트' })).toBeVisible();
  await expect(page.getByText('Owner', { exact: true })).toBeVisible();
  const url = page.url();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: '장기 협업 프로젝트' })).toBeVisible();
  await page.getByRole('link', { name: '토픽 설정', exact: true }).click();
  await page.getByLabel(/^주제명/).fill('새 이름의 협업 프로젝트');
  await page.getByRole('button', { name: '변경 저장', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '새 이름의 협업 프로젝트' }),
  ).toBeVisible();
  expect(page.url()).toBe(url);
  await page.screenshot({ path: `test-results/topic-${info.project.name}.png`, fullPage: true });
  await page.goto('/topics?filter=managed');
  await expect(page.locator('.topic-card')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('토픽 modal keeps inputs when discarding is declined', async ({ page }) => {
  await open(page, '/topics/new');
  await page.getByLabel(/^주제명/).fill('저장 전 주제');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '입력을 닫을까요?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '돌아가기', exact: true }).click();
  await expect(page.getByLabel(/^주제명/)).toHaveValue('저장 전 주제');
});
test('four-step meeting creation, attachment download, cancellation and persistence', async ({
  page,
}, info) => {
  const url = await createMeeting(page, '자료와 함께하는 실무 회의', true);
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: '자료와 함께하는 실무 회의' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '자료 1', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '회의자료.txt 다운로드' }).click();
  expect((await download).suggestedFilename()).toBe('회의자료.txt');
  await expect(page.getByRole('button', { name: '자료 등록', exact: true })).toBeVisible();
  await page.screenshot({
    path: `test-results/meeting-files-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '회의 취소', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '예정 회의 취소 확인' });
  await expect(dialog.getByRole('button', { name: '회의 취소 확정' })).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '회의 취소 확정' }).click();
  await expect(page.getByText('취소된 회의입니다.', { exact: false })).toBeVisible();
  await expect(page.locator('.meeting-header-meta .status-cancelled')).toContainText('취소');
  await page.goto(url);
  await expect(page.locator('.meeting-header-meta .status-cancelled')).toContainText('취소');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('wizard preserves input and a reloadable draft across four steps', async ({ page }, info) => {
  await open(page, '/topics/system/meetings/new');
  await page.getByLabel(/^회의명/).fill('초안 유지 확인');
  await page.getByLabel(/^회의 내용·안건/).fill('초안 보존');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.locator('.stepper li')).toHaveCount(4);
  await page.getByLabel('회의 일자 *').fill('2026-10-21');
  await page.getByRole('button', { name: '15:00 예약 가능', exact: true }).click();
  await page.screenshot({
    path: `test-results/reservation-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await expect(page.getByLabel(/^회의명/)).toHaveValue('초안 유지 확인');
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByLabel(/^회의명/)).toHaveValue('초안 유지 확인');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByRole('button', { name: '15:00 선택', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('ended meeting summary draft is not completion; explicit completion persists', async ({
  page,
}, info) => {
  await open(page, '/meetings/strategy/summary');
  await page
    .getByLabel('주요 논의 내용', { exact: true })
    .fill('프로젝트의 핵심 가치를 정리했습니다.');
  await page
    .getByLabel('결정 사항', { exact: true })
    .fill('기존 방향을 유지하고 세부안을 보완합니다.');
  await page.getByRole('button', { name: '후속 작업 추가' }).click();
  await page.getByLabel('후속 작업 1', { exact: true }).fill('다음 회의 전 자료 공유');
  await page.getByRole('button', { name: '요약 저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('아직 완료되지');
  await page.reload();
  await expect(page.getByLabel('주요 논의 내용', { exact: true })).toHaveValue(
    '프로젝트의 핵심 가치를 정리했습니다.',
  );
  await page.getByRole('button', { name: '요약 저장 및 회의 완료', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '저장 및 완료', exact: true }).click();
  await expect(page.locator('.status-completed').first()).toContainText('완료');
  await expect(page.getByText('회의실 가는 길', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `test-results/summary-${info.project.name}.png`, fullPage: true });
  await page.reload();
  await expect(
    page.getByText('프로젝트의 핵심 가치를 정리했습니다.', { exact: true }),
  ).toBeVisible();
});
test('preferences persist and room administration stays restricted without delivery history', async ({
  page,
}, info) => {
  await createMeeting(page);
  await page.goto('/settings/notifications');
  await expect(page.getByRole('switch', { name: '자료 등록·수정' })).toBeEnabled();
  await page.getByRole('switch', { name: '자료 등록·수정' }).uncheck();
  await page.getByRole('checkbox', { name: '1시간 전', exact: true }).check();
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('알림 설정을 저장');
  await page.reload();
  await expect(page.getByRole('switch', { name: '자료 등록·수정' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: '1시간 전', exact: true })).toBeChecked();
  await expect(page.getByText('필수 · 항상 켜짐')).toHaveCount(3);
  await page.goto('/admin/notifications');
  await expect(page.getByRole('heading', { name: '이 정보에 접근할 수 없어요' })).toBeVisible();
  await user(page, 'ops');
  await expect(page.getByRole('heading', { name: '관리자 발송 이력' })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '관리자 회의실 관리', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `test-results/admin-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('Attendee and other Master cannot access privileged creation or settings routes', async ({
  page,
}) => {
  await open(page, '/topics/team/meetings/new');
  await expect(page.getByRole('heading', { name: '이 정보에 접근할 수 없어요' })).toBeVisible();
  await page.goto('/topics/brand/settings');
  await expect(page.getByRole('heading', { name: '이 정보에 접근할 수 없어요' })).toBeVisible();
  await page.goto('/meetings/equipment/summary');
  await expect(page.getByRole('heading', { name: '이 정보에 접근할 수 없어요' })).toBeVisible();
  await page.goto('/admin/rooms');
  await expect(page.getByRole('heading', { name: '이 정보에 접근할 수 없어요' })).toBeVisible();
});

test('meeting edit, file registration and deletion respect actor permissions', async ({ page }) => {
  const url = await createMeeting(page, '수정 전 회의');
  await page.getByRole('link', { name: '회의 수정', exact: true }).click();
  await page.getByLabel(/^회의명/).fill('수정된 회의');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByText('변경 전 장소·시간', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '변경 저장', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '변경 내용을 저장했어요', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '회의 상세 보기', exact: true }).click();
  await page.getByRole('button', { name: '자료 0', exact: true }).click();
  await page
    .getByLabel('회의 자료 선택', { exact: true })
    .setInputFiles({ name: '초안.txt', mimeType: 'text/plain', buffer: Buffer.from('draft') });
  await page.getByRole('button', { name: '자료 등록', exact: true }).click();
  await expect(page.getByRole('button', { name: '자료 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '초안.txt 삭제', exact: true }).click();
  await page.getByRole('button', { name: '자료 삭제', exact: true }).click();
  await expect(page.getByText('자료 등록 예정', { exact: true })).toBeVisible();
  await expect(page.getByText('초안.txt', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '자료 0', exact: true })).toBeVisible();
  await user(page, 'park');
  await expect(page.getByRole('heading', { level: 1, name: '수정된 회의' })).toBeVisible();
  await expect(page.getByRole('button', { name: '자료 등록', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '회의 수정', exact: true })).toHaveCount(0);
  await page.goto(url + '/edit');
  await expect(page.getByRole('heading', { name: '이 정보에 접근할 수 없어요' })).toBeVisible();
});
