import test from "node:test";
import assert from "node:assert/strict";
import { cachedUpstream, resourceKey } from "../lib/upstream-cache.mjs";
import { buildDataFusion, normalizeMetNorway } from "../lib/public-data.mjs";
import { buildRailPlan } from "../src/rail-plan.js";
import { deriveJourneySignals } from "../src/live-journey.js";
import { demoTrip } from "../src/data.js";

const at = "2030-09-05T17:05:00+09:00";
const now = new Date("2030-09-05T16:00:00+09:00");
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const weather = { hourly: { time: ["2030-09-05T17:00", "2030-09-05T18:00"], precipitation_probability: [20, 80], precipitation: [0, 2], wind_speed_10m: [10, 20] } };
const met = { properties: { meta: { updated_at: "2030-09-05T06:00:00Z" }, timeseries: [
  { time: "2030-09-05T08:00:00Z", data: { instant: { details: { wind_speed: 5 } }, next_1_hours: { details: { precipitation_amount: 1.2 } } } },
  { time: "2030-09-05T09:00:00Z", data: { instant: { details: { wind_speed: 6 } }, next_6_hours: { details: { precipitation_amount: 4 } } } }
] } };
const getSource = (fusion, id) => fusion.sources.find(source => source.id === id);
const railRow = stnCd => ({ drvDt: "20300905", trnNo: "A1002", stnCd, trnClsfNm: "Dirc",
  planDptrDttm: stnCd === "110" ? "20300905183000" : stnCd === "100" ? "20300905183800" : "",
  planArrvDttm: stnCd === "010" ? "20300905192200" : "" });

function railResponse(url) {
  const station = url.searchParams.get("stnCd");
  // Real provider ignores trainClsf, returns both classes, and omits station names.
  return json({ response: { body: { totalCount: 2, items: [railRow(station), { ...railRow(station), trnClsfNm: "Comm", trnNo: "A2002" }] } } });
}
function otherResponse(url) {
  if (url.includes("open-meteo.com")) return json(weather);
  if (url.includes("TrainInfo/")) return json({ items: [{ trainno: "999", depplandtime: "20300905201200", arrplandtime: "20300905225400" }] });
  return json({ items: [] });
}

test("공항철도는 세 역만 조회하고 무시된 열차 필터를 보완해 실제 연결편을 만든다", async () => {
  const calls = [];
  const fetchImpl = async value => {
    const url = new URL(value);
    if (!url.pathname.includes("AirportRailroad")) return otherResponse(value);
    calls.push(url);
    assert.equal(url.searchParams.get("numOfRows"), "1000");
    return railResponse(url);
  };
  const options = { env: { DATA_GO_KR_API_KEY: "test-key" }, fetchImpl, now, cache: false };
  const [first, second] = await Promise.all([
    buildDataFusion({ targetDateTime: at, flightId: "KE704" }, options),
    buildDataFusion({ targetDateTime: "2030-09-05T18:05:00+09:00", flightId: "OZ102" }, options)
  ]);
  assert.deepEqual(calls.map(url => url.searchParams.get("stnCd")).sort(), ["010", "100", "110"]);
  const source = getSource(first, "airport-rail");
  assert.equal(source.mode, "live");
  assert.equal(source.data.length, 3);
  assert.deepEqual(new Set(source.data.map(row => row.stationName)), new Set(["서울", "인천공항1터미널", "인천공항2터미널"]));
  assert.equal(getSource(second, "airport-rail").cacheHit, true);
  const plan = buildRailPlan(demoTrip, at, first, "T2", now, { allowDemo: false });
  assert.equal(plan.authoritative, true);
  assert.equal(plan.trains[0].service, "KTX 999");
  assert.equal(plan.airportRail[0].service, "공항철도 직통열차");
});

test("공항철도 페이지 필터는 페이지를 모두 읽은 다음 적용한다", async () => {
  const pages = [];
  const fusion = await buildDataFusion({ targetDateTime: at }, { env: { DATA_GO_KR_API_KEY: "pagination" }, now, cache: false, fetchImpl: async value => {
    const url = new URL(value);
    if (!url.pathname.includes("AirportRailroad")) return otherResponse(value);
    const page = Number(url.searchParams.get("pageNo")); pages.push(page);
    const station = url.searchParams.get("stnCd");
    const items = page === 1 ? Array.from({ length: 1000 }, (_, i) => ({ ...railRow(station), trnNo: `A2${i}`, trnClsfNm: "Comm" })) : [railRow(station)];
    return json({ response: { body: { totalCount: 1001, items } } });
  } });
  assert.deepEqual(pages.sort(), [1, 1, 1, 2, 2, 2]);
  assert.equal(getSource(fusion, "airport-rail").data.length, 3);
});

test("기존 5.5초보다 늦은 공항철도 응답은 15초 제한 안에서 정상 처리한다", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let railCalls = 0;
  const pending = buildDataFusion({ targetDateTime: at }, { env: { DATA_GO_KR_API_KEY: "slow-test" }, now, cache: false, fetchImpl: async (value, options) => {
    if (!value.includes("AirportRailroad")) return otherResponse(value);
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true });
      setTimeout(() => resolve(railResponse(new URL(value))), 6000);
      if (++railCalls === 3) started();
    });
  } });
  await ready;
  t.mock.timers.tick(6000);
  assert.equal(getSource(await pending, "airport-rail").mode, "live");
});

test("공항철도 제공 범위 밖은 호출하지 않고 미제공 상태를 표시한다", async () => {
  const fusion = await buildDataFusion({ targetDateTime: "2030-09-09T17:05:00+09:00" }, { env: { DATA_GO_KR_API_KEY: "range" }, now, cache: false, fetchImpl: async value => {
    assert.ok(!value.includes("AirportRailroad")); return otherResponse(value);
  } });
  const source = getSource(fusion, "airport-rail");
  assert.equal(source.mode, "unavailable");
  assert.equal(source.reasonCode, "DATE_OUT_OF_RANGE");
});

test("동시 항공편과 다른 도착 시각은 한 기상 예보를 공유하고 각 시각 값을 고른다", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return json(weather); };
  const options = { env: {}, fetchImpl, cache: false };
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => buildDataFusion({ flightId: `KE${i}`, targetDateTime: i % 2 ? "2030-09-05T18:05:00+09:00" : at }, options)));
  assert.equal(calls, 1);
  assert.equal(getSource(results[0], "open-weather").data.precipitationProbability, 20);
  assert.equal(getSource(results[1], "open-weather").data.precipitationProbability, 80);
});

test("429의 Retry-After 동안 재호출하지 않고 독립 예보를 사용한 뒤 정상 복구한다", async () => {
  let clock = +now;
  let primaryCalls = 0;
  let secondaryCalls = 0;
  const fetchImpl = async (value, options) => {
    if (value.includes("open-meteo.com")) {
      primaryCalls++;
      return primaryCalls === 1 ? json({ reason: "Too many requests" }, 429, { "retry-after": "120" }) : json(weather);
    }
    secondaryCalls++;
    assert.match(options.headers["User-Agent"], /github.com\/kwakhyun\/chakchak/);
    return json(met);
  };
  const options = { env: {}, fetchImpl, cache: false, upstreamCache: { now: () => clock } };
  const first = getSource(await buildDataFusion({ targetDateTime: at }, options), "open-weather");
  assert.equal(first.mode, "live");
  assert.equal(first.provider, "met-norway");
  assert.equal(first.primaryFailure.reasonCode, "HTTP_429");
  assert.equal(Date.parse(first.primaryFailure.retryAt), clock + 120_000);
  assert.equal(first.data.precipitationProbability, null);
  assert.equal(first.data.windSpeedKmh, 18);
  clock += 119_000;
  await buildDataFusion({ targetDateTime: at }, options);
  assert.equal(primaryCalls, 1); assert.equal(secondaryCalls, 1);
  clock += 1001;
  assert.equal(getSource(await buildDataFusion({ targetDateTime: at }, options), "open-weather").provider, "open-meteo");
  assert.equal(primaryCalls, 2);
});

test("일일 제한과 대체 제공기관 장애도 정상 예보로 위장하지 않는다", async () => {
  const fetchImpl = async value => value.includes("open-meteo.com") ? json({ reason: "Daily API request limit exceeded. Please try again tomorrow" }, 429) : json({}, 503);
  const source = getSource(await buildDataFusion({ targetDateTime: at }, { env: {}, fetchImpl, cache: false }), "open-weather");
  assert.equal(source.mode, "fallback"); assert.equal(source.data, null);
  assert.equal(source.upstreamIssue, "RATE_LIMIT_DAILY");
  assert.ok(Date.parse(source.retryAt) >= Date.now() + 86_390_000);
  assert.equal(source.secondaryFailure.reasonCode, "HTTP_503");
});

test("대체 예보의 누락 확률과 6시간 강수량, 조회범위를 그대로 유지한다", () => {
  const first = normalizeMetNorway(met, at);
  assert.equal(first.precipitationProbability, null);
  const signals = deriveJourneySignals({ sources: [{ id: "open-weather", mode: "live", data: first }] }, at);
  assert.equal(signals.precipitationProbability, null);
  assert.equal(signals.precipitationMm, 1.2);
  assert.ok(signals.weatherSeverity >= 1);
  const later = normalizeMetNorway(met, "2030-09-05T23:05:00+09:00");
  assert.equal(later.precipitationPeriodHours, 6);
  assert.equal(later.precipitationMm, 4);
  assert.equal(normalizeMetNorway(met, "2030-09-06T01:00:00+09:00"), null);
  assert.equal(normalizeMetNorway(met, "2030-09-05T16:59:00+09:00"), null);
});

test("Worker 인스턴스가 바뀌어도 저장된 성공과 호출 제한을 재사용한다", async () => {
  const records = new Map();
  const storage = { match: async request => records.get(request.url)?.clone(), put: async (request, response) => { records.set(request.url, response.clone()); } };
  let clock = 1000;
  let calls = 0;
  const options = { key: await resourceKey("credential-must-not-appear-in-URL"), origin: "https://chakchak.test", storage, ttlMs: 1000, now: () => clock, load: async () => { calls++; return { value: "official" }; } };
  const first = await cachedUpstream({ ...options, fetchImpl: async () => {} });
  const second = await cachedUpstream({ ...options, fetchImpl: async () => {} });
  assert.equal(calls, 1); assert.equal(first.value, second.value); assert.equal(second.cacheHit, true);
  assert.doesNotMatch([...records.keys()][0], /credential-must/);
  clock += 1001;
  const failure = { ...options, load: async () => { calls++; throw Object.assign(new Error("HTTP_429"), { retryAfterMs: 120_000 }); } };
  await assert.rejects(cachedUpstream({ ...failure, fetchImpl: async () => {} }), /HTTP_429/);
  await assert.rejects(cachedUpstream({ ...failure, fetchImpl: async () => {} }), /HTTP_429/);
  assert.equal(calls, 2); // Expired success was not used as fresh data.
});

test("캐시 저장소 장애도 실제 조회를 막거나 무기한 실패를 고정하지 않는다", async () => {
  let clock = 0;
  const fetchImpl = async () => {};
  const options = { key: "cache-outage", fetchImpl, origin: "https://chakchak.test", storage: { match: async () => { throw new Error("storage down"); }, put: async () => { throw new Error("storage down"); } }, ttlMs: 1000, now: () => clock };
  await assert.rejects(cachedUpstream({ ...options, load: async () => { throw new Error("HTTP_503"); } }), /HTTP_503/);
  clock += 60_001;
  assert.equal((await cachedUpstream({ ...options, load: async () => ({ value: "recovered" }) })).value, "recovered");
});
