import { expect, test } from '@playwright/test';
import { liveFusionFor } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2030-09-05T07:00:00Z'));
  await page.route('**/api/data/fusion?**', route => route.fulfill({ json: liveFusionFor(new URL(route.request().url()).searchParams.get('at') || undefined) }));
});

test('개인 여행조건, 예매편과 저장한 대체편을 새로고침 후 복원한다', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '항공편·여행조건 바꾸기' }).click();
  await page.locator('#journey-flight').fill('KE123');
  await page.locator('#journey-bags').selectOption('2');
  await page.locator('#journey-large-luggage').check();
  await page.locator('#booked-korail-service').fill('KTX 123');
  await page.locator('#booked-korail-departure').fill('2030-09-06T20:12');
  await page.getByRole('button', { name: '이 여정으로 계산하기' }).click();
  await expect(page.locator('.mode-pill')).not.toHaveText('예시 여정 체험');
  await page.locator('.topnav').getByRole('button', { name: '다음 열차', exact: true }).click();
  await page.getByRole('button', { name: '대체편·표 보호 순서 확인', exact: true }).click();
  await expect(page.locator('#recovery-dialog')).toContainText('KTX 123');
  await page.getByRole('button', { name: '대체 일정 후보 저장', exact: true }).click();
  const selected = await page.locator('.confirmed-journey-banner h2').textContent();
  await page.reload();
  await expect(page.locator('.confirmed-journey-banner h2')).toHaveText(selected!);
  await page.getByRole('button', { name: '항공편·여행조건 바꾸기' }).click();
  await expect(page.locator('#journey-flight')).toHaveValue('KE123');
  await expect(page.locator('#journey-bags')).toHaveValue('2');
  await expect(page.locator('#journey-large-luggage')).toBeChecked();
  await expect(page.locator('#journey-live-flight')).toBeChecked();
  await expect(page.locator('#booked-korail-service')).toHaveValue('KTX 123');
  await expect(page.locator('#booked-korail-departure')).toHaveValue('2030-09-06T20:12');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('사용자가 조절한 지연 시간도 저장한 대체편과 함께 복원한다', async ({ page }) => {
  await page.goto('/#routes');
  await page.locator('#journey-time-scrubber').evaluate(el => {
    (el as HTMLInputElement).value = '45';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: '대체편·표 보호 순서 확인', exact: true }).click();
  await page.getByRole('button', { name: '대체 일정 후보 저장', exact: true }).click();
  await page.reload();
  await expect(page.locator('.confirmed-journey-banner')).toBeVisible();
  await page.locator('.topnav').getByRole('button', { name: '다음 열차', exact: true }).click();
  await expect(page.locator('#journey-time-scrubber')).toHaveValue('45');
});

test('실측 조회 500 이후 토큰을 보존해 복구와 동의 철회를 완료한다', async ({ page }) => {
  const stored = { token: 'test-only-session-token', session: { status: 'TRACKING', platformArrived: false } };
  await page.goto('/');
  await page.evaluate(value => localStorage.setItem('chakchak-p2-validation-session', JSON.stringify(value)), stored);
  let status = 500;
  await page.route('**/api/validation/session', route => route.fulfill({ status, json: status === 500 ? { error: 'temporary' } : { session: { ...stored.session, platformArrived: true } } }));
  await page.goto('/#validation');
  await page.reload();
  await expect(page.locator('.inline-error')).toContainText('접근 정보는 보관');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chakchak-p2-validation-session')!).token)).toBe(stored.token);
  status = 200;
  await page.reload();
  await expect(page.getByRole('button', { name: '승강장 도착 기록됨' })).toBeDisabled();
  await page.route('**/api/validation/withdraw', async route => {
    expect(route.request().postDataJSON().token).toBe(stored.token);
    await route.fulfill({ json: { withdrawn: true } });
  });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '동의 철회하고 이 여정 기록 모두 삭제' }).click();
  await expect(page.locator('.validation-session-summary')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('chakchak-p2-validation-session'))).toBeNull();
});

test('실제 조회 장애는 체험편으로 대체하지 않고 최신 공식 시간표만 제한적으로 사용한다', async ({ page }) => {
  let cached = true;
  await page.route('**/api/data/fusion?**', route => {
    const fusion = liveFusionFor();
    const train = fusion.sources.find(s => s.id === 'tago-train')!;
    Object.assign(train, { mode: 'fallback', provider: 'tago', lastLiveAt: cached ? '2030-09-05T06:59:00Z' : '2030-09-05T06:00:00Z', snapshot: null });
    return route.fulfill({ json: fusion });
  });
  await page.goto('/?mode=live#routes');
  await expect(page.locator('.schedule-source')).toContainText('마지막 정상 시간표');
  await expect(page.locator('body')).not.toContainText('체험 시간표');
  cached = false;
  await page.reload();
  await expect(page.locator('#view-title')).toHaveText('연결 가능한 열차를 찾지 못했어요');
  await expect(page.locator('body')).toContainText('실제 운행시간표 조회 불가');
  await expect(page.locator('#apply-recovery')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('KTX 419');
});

test('공개 예측 API는 과도한 일정 입력을 거부한 뒤 정상 요청을 처리한다', async ({ request }) => {
  const invalid = await request.post('/api/chakchak/predict', { data: { activities: Array.from({ length: 8 }, () => ({})), candidates: [{}] } });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).code).toBe('TOO_MANY_CANDIDATES_OR_ACTIVITIES');
  const valid = await request.post('/api/chakchak/predict', { data: { scheduledArrival: '2030-09-06T17:05:00+09:00', candidates: [{ id: 'A', departureTime: '2030-09-06T20:48:00+09:00', destinationArrivalTime: '2030-09-06T23:54:00+09:00' }], activities: [] } });
  expect(valid.status()).toBe(200);
  expect((await valid.json()).candidates).toHaveLength(1);
});
