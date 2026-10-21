import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataFusion, normalizeTrains, normalizeKorailTrains, normalizeAirportRail } from '../lib/public-data.mjs';
import { buildRailPlan, MAX_STALE_RAIL_MS } from '../src/rail-plan.js';
import { demoTrip } from '../src/data.js';
import { createJourneyModel } from '../src/journey-model.js';
import { buildTicketProtectionAdvice } from '../src/ticket-protection.js';
import { refreshValidationSession } from '../src/validation-client.js';
import { compactModelInput } from '../lib/model-input.mjs';
import { predictChakchakJourney } from '../src/chakchak-ai.js';
import { optimizeConstrainedJourney } from '../src/journey-optimizer.js';
import { loadJourneySession, saveJourneySession, JOURNEY_SESSION_STORAGE_KEY } from '../src/journey-session.js';
import { createConfirmedJourney, saveConfirmedJourney, loadConfirmedJourney } from '../src/journey-decision.js';

const at = '2030-09-05T17:05:00+09:00';
const now = new Date('2030-09-05T16:00:00+09:00');
const late = { trainno: '999', depplandtime: '20300905211200', arrplandtime: '20300905225400', adultcharge: 35000 };
const earlyRows = n => Array.from({ length: n }, (_, i) => ({ trainno: String(i), depplandtime: '20300905080000', arrplandtime: '20300905100000' }));
const airport = { id: 'airport-rail', mode: 'live', data: [{ trainNo: 'A9', departureStation: '인천공항2터미널', arrivalStation: '서울', plannedDeparture: '20300905194800', plannedArrival: '20300905203900' }] };
const railSource = (mode = 'live', extra = {}) => ({ id: 'tago-train', mode, data: normalizeTrains({ items: [late] }), ...extra });
const plan = source => buildRailPlan(demoTrip, at, { sources: [airport, source] }, 'T2', now, { allowDemo: false });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });

// The row caps formerly removed the only usable late connection.
test('KTX 17번째, 코레일 33번째, 공항철도 21번째 이후 운행을 유지한다', () => {
  const rows = normalizeTrains({ items: [...earlyRows(16), late] });
  assert.equal(rows.length, 17);
  assert.deepEqual(plan(railSource('live', { data: rows })).trains.map(t => t.service), ['KTX 999']);
  const korail = normalizeKorailTrains({ items: [...earlyRows(32).map(r => ({ trn_no: r.trainno, trn_plan_dptre_dt: r.depplandtime, trn_plan_arvl_dt: r.arrplandtime })), { trn_no: '999', trn_plan_dptre_dt: late.depplandtime, trn_plan_arvl_dt: late.arrplandtime }] });
  assert.equal(plan(railSource('live', { data: korail })).unavailable, false);
  const rawAirport = Array.from({ length: 20 }, (_, i) => ({ trnNo: String(i), stnNm: '인천공항2터미널', planDptrDttm: '20300905080000' }));
  rawAirport.push({ trnNo: 'A9', stnNm: '인천공항2터미널', planDptrDttm: '20300905194800' }, { trnNo: 'A9', stnNm: '서울', planArrvDttm: '20300905203900' });
  const result = buildRailPlan(demoTrip, at, { sources: [{ ...airport, data: normalizeAirportRail({ items: rawAirport }) }, railSource()] }, 'T2', now, { allowDemo: false });
  assert.equal(result.authoritative, true);
  assert.equal(result.trains[0].service, 'KTX 999');
});

test('공식 시간표의 다음 페이지까지 읽고 부분 응답을 정상으로 표시하지 않는다', async () => {
  const pages = [];
  const fusion = await buildDataFusion({ targetDateTime: at }, { cache: false, env: { DATA_GO_KR_API_KEY: 'test-only' }, fetchImpl: async value => {
    const url = new URL(value);
    if (url.pathname.includes('GetStrtpntAlocFndTrainInfo')) {
      const page = Number(url.searchParams.get('pageNo')); pages.push(page);
      return response({ response: { body: { totalCount: 101, items: { item: page === 1 ? earlyRows(100) : [late] } } } });
    }
    return response({ items: [] });
  } });
  assert.deepEqual(pages, [1, 2]);
  const source = fusion.sources.find(s => s.id === 'tago-train');
  assert.equal(source.mode, 'live');
  assert.equal(source.data.length, 101);
  assert.equal(plan(source).trains[0].service, 'KTX 999');
  const partial = await buildDataFusion({ targetDateTime: at }, { cache: false, env: { DATA_GO_KR_API_KEY: 'test-only' }, fetchImpl: async value => response(new URL(value).pathname.includes('GetStrtpntAlocFndTrainInfo') ? { totalCount: 200, items: earlyRows(100) } : { items: [] }) });
  assert.equal(partial.sources.find(s => s.id === 'tago-train').mode, 'fallback');
});

test('마지막 정상 시간표는 같은 운행 날짜와 15분 유효기간 안에서만 재사용한다', () => {
  const saved = railSource('fallback', { provider: 'tago', lastLiveAt: new Date(+now - 300_000).toISOString(), snapshot: null });
  assert.equal(plan(saved).trains[0].service, 'KTX 999');
  assert.equal(plan(saved).authoritative, false);
  assert.match(plan(saved).sourceLabel, /마지막 정상/);
  for (const source of [
    { ...saved, lastLiveAt: new Date(+now - MAX_STALE_RAIL_MS - 1).toISOString() },
    { ...saved, lastLiveAt: new Date(+now + 1).toISOString() },
    { ...saved, data: saved.data.map(r => ({ ...r, departureTime: '20300904211200', arrivalTime: '20300904225400' })) },
    { ...saved, provider: 'local-snapshot', snapshot: { authoritative: false } },
    railSource('fallback', { data: null }), railSource('unavailable', { data: [] }), railSource('unavailable')
  ]) {
    assert.equal(plan(source).unavailable, true);
    assert.equal(plan(source).trains.length, 0);
  }
  assert.equal(buildRailPlan(demoTrip, at, null, 'T2', now, { allowDemo: false }).unavailable, true);
  assert.equal(buildRailPlan(demoTrip, at, null, 'T2', now).unavailable, false);
});

function journey() {
  return { flightId: 'KE123', arrivalAt: at, destination: '전주', checkedBags: 2, mobility: 'assisted', largeLuggage: true, useExampleFlight: false, ticket: { hasBookedTicket: true, korail: true, arex: false, ticketType: 'standard', bookings: { korail: { service: 'KTX 123', departure: '2030-09-05T20:12:00+09:00' } } } };
}
test('시간표가 갱신되어도 예매한 승차권 안내의 열차와 출발시각은 바뀌지 않는다', () => {
  const state = { scenarioId: 'normal', previewDelayMinutes: 0, journey: journey(), signals: null, fusion: { sources: [airport, railSource()] }, confirmedJourney: null };
  const before = createJourneyModel(state).getViewModel().ticketProtection;
  state.fusion = { sources: [airport, railSource('live', { data: [{ ...normalizeTrains({ items: [late] })[0], trainNo: '777', departureTime: '20300905221200', arrivalTime: '20300905235400' }] })] };
  const after = createJourneyModel(state).getViewModel().ticketProtection;
  assert.deepEqual(after.operators, before.operators);
  assert.equal(after.operators[0].service, 'KTX 123');
});

test('예매편 미확인 또는 잘못된 출발시각에는 시간별 반환 금액을 추정하지 않는다', () => {
  for (const existingKtx of [undefined, { service: 'KTX 123', departure: 'not-a-date' }]) {
    const result = buildTicketProtectionAdvice({ ticket: { hasBookedTicket: true, korail: true }, existingKtx });
    assert.match(result.operators[0].deadline, /출발일시 확인 필요/);
    assert.doesNotMatch(result.operators[0].feeBand, /\d/);
  }
});

test('실측 토큰은 500, 429, 응답 손상, 네트워크 장애에서 보존하고 복구 후 재사용한다', async () => {
  const stored = { token: 'only-access-token', session: { status: 'ENROLLED' } };
  for (const fetchImpl of [async () => response({}, 500), async () => response({}, 429), async () => response({}, 200), async () => response({ session: {} }), async () => { throw new Error('offline'); }, async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } })]) {
    const result = await refreshValidationSession(stored, fetchImpl);
    assert.equal(result.stored, stored);
    assert.ok(result.warning);
  }
  const recovered = await refreshValidationSession(stored, async (_, options) => {
    assert.equal(JSON.parse(options.body).token, stored.token);
    return response({ session: { status: 'COMPLETE' } });
  });
  assert.equal(recovered.stored.token, stored.token);
  assert.equal(recovered.stored.session.status, 'COMPLETE');
  for (const [status, code] of [[401, 'INVALID_TOKEN'], [404, 'SESSION_NOT_FOUND'], [410, 'SESSION_EXPIRED']]) {
    assert.equal((await refreshValidationSession(stored, async () => response({ code }, status))).stored, null);
  }
  assert.equal((await refreshValidationSession(stored, async () => response({}, 404))).stored, stored);
});

const candidate = i => ({ id: `A${i}`, departureTime: '2030-09-05T20:00:00+09:00', destinationArrivalTime: '2030-09-05T22:00:00+09:00', decisionProfile: { eligible: true, conservativeProbability: .99, p90BufferMinutes: 20 } });
const activity = i => ({ id: `P${i}`, title: '장소', openingTime: '2030-09-06T09:00:00+09:00', closingTime: '2030-09-06T18:00:00+09:00', durationMinutes: 30 });
test('8개 일정은 공개 입력, 직접 모델 호출과 최적화기에서 모두 계산 전에 차단한다', () => {
  const input = { scheduledArrival: at, candidates: [candidate(0)], activities: Array.from({ length: 8 }, (_, i) => activity(i)) };
  for (const fn of [compactModelInput, predictChakchakJourney, optimizeConstrainedJourney]) assert.throws(() => fn(input), /TOO_MANY/);
});

test('최대 입력 12개 열차와 4개 일정은 780개 노드 이내에서 완전 탐색한다', () => {
  const result = optimizeConstrainedJourney({ candidates: Array.from({ length: 12 }, (_, i) => candidate(i)), activities: Array.from({ length: 4 }, (_, i) => activity(i)), now: () => 0 });
  assert.equal(result.search.complete, true);
  assert.ok(result.search.visitedNodes <= 780);
  assert.equal(result.selectedPlan.itinerary.items.length, 4);
  const pruned = optimizeConstrainedJourney({ candidates: [candidate(0)], activities: [{ ...activity(0), required: true, closingTime: '2030-09-04T12:00:00+09:00' }], now: () => 0 });
  assert.equal(pruned.feasible, false);
  assert.equal(pruned.search.visitedNodes, 2);
  let time = 0;
  assert.throws(() => optimizeConstrainedJourney({ candidates: [candidate(0)], activities: [activity(0)], now: () => (time += 201) }), error => error.message === 'OPTIMIZATION_BUDGET_EXCEEDED' && error.statusCode === 503);
});

test('새로고침 시 개인 여행조건과 사용자 지정 지연을 먼저 복원하고 대체편을 유지한다', () => {
  const values = new Map();
  const storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const state = { journey: journey(), scenarioId: 'normal', previewDelayMinutes: 55, customDelayActive: true };
  const confirmed = createConfirmedJourney({ journey: state.journey, selectedArex: { id: 'A9' }, selectedKtx: { id: 'K9' } });
  assert.equal(saveJourneySession(storage, state), true);
  saveConfirmedJourney(storage, confirmed);
  const loaded = loadJourneySession(storage);
  assert.equal(loaded.journey.flightId, 'KE123');
  assert.equal(loaded.journey.checkedBags, 2);
  assert.equal(loaded.journey.ticket.bookings.korail.service, 'KTX 123');
  assert.equal(loaded.previewDelayMinutes, 55);
  assert.equal(loaded.customDelayActive, true);
  assert.deepEqual(loadConfirmedJourney(storage, loaded.journey), confirmed);
  storage.setItem(JOURNEY_SESSION_STORAGE_KEY, '{bad-json');
  assert.equal(loadJourneySession(storage), null);
  storage.setItem(JOURNEY_SESSION_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, ...state, scenarioId: '__proto__' }));
  assert.equal(loadJourneySession(storage), null);
  assert.equal(saveJourneySession({ setItem: () => { throw new Error('quota'); } }, state), false);
});
