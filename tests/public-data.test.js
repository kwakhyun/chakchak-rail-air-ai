import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDataFusion,
  normalizeAirportRail,
  normalizeFlight,
  normalizeKorailTrains,
  normalizeMetar,
  normalizeTourism,
  normalizeTrains
} from "../lib/public-data.mjs";

test("normalizers reduce different public schemas to one journey contract", () => {
  assert.deepEqual(
    normalizeFlight({ response: { body: { items: [{ flightId: "KE704", estimatedDateTime: "1740", terminalId: "P03", carousel: "8" }] } } }, "KE704"),
    { flightId: "KE704", estimatedTime: "1740", terminal: "P03", carousel: "8" }
  );

  assert.deepEqual(
    normalizeKorailTrains({ response: { body: { items: { item: { trn_no: "419", run_ymd: "20260812", dptre_stn_nm: "서울", arvl_stn_nm: "전주", trn_plan_dptre_dt: "20260812201200", trn_plan_arvl_dt: "20260812215400" } } } } }),
    [{ trainNo: "419", service: "열차 419", departureStation: "서울", arrivalStation: "전주", departureTime: "20260812201200", arrivalTime: "20260812215400", serviceDate: "20260812" }]
  );

  assert.deepEqual(
    normalizeTrains({ response: { body: { items: { item: { trainno: "419", traingradename: "KTX", depplandtime: "20260812201200", arrplandtime: "20260812215400", adultcharge: 34600 } } } } }),
    [{ trainNo: "419", service: "KTX", departureTime: "20260812201200", arrivalTime: "20260812215400", adultFare: 34600 }]
  );

  assert.equal(normalizeAirportRail({ items: [{ trnNo: "A101", planDptrDttm: "20260812184800" }] })[0].trainNo, "A101");
  assert.equal(normalizeTourism({ items: [{ contentid: "1", title: "전주한옥마을", mapx: "127.15", mapy: "35.81" }] })[0].title, "전주한옥마을");
  assert.equal(normalizeTourism({ items: [{ contentid: "2", contenttypeid: "39", title: "지역 음식" }] })[0].contentType, "food");
  assert.equal(normalizeMetar({ items: [{ icaoCode: "RKSI", metarMsg: "METAR RKSI" }] }).icaoCode, "RKSI");
});

test("fusion remains presentation-safe when keyed APIs are not configured", async () => {
  let calls = 0;
  const fusion = await buildDataFusion(
    { flightId: "KE704", targetDateTime: "2026-08-12T17:05:00+09:00" },
    {
      env: {},
      cache: false,
      fetchImpl: async (url) => {
        calls += 1;
        assert.match(url, /^https:\/\/api\.open-meteo\.com/);
        return {
          ok: true,
          headers: { get: () => "application/json" },
          json: async () => ({
            hourly: {
              time: ["2026-08-12T17:00"],
              precipitation_probability: [65],
              precipitation: [1.2],
              weather_code: [61],
              wind_speed_10m: [18]
            }
          })
        };
      }
    }
  );

  assert.equal(calls, 1);
  assert.equal(fusion.overallMode, "hybrid");
  assert.equal(fusion.sourceSummary.live, 1);
  assert.equal(fusion.sourceSummary.demo, 6);
  assert.equal(fusion.sources.find((source) => source.id === "open-weather").data.precipitationProbability, 65);
});

test("HTTP 200 public-data error payloads are not mislabeled as live", async () => {
  const fusion = await buildDataFusion(
    { flightId: "KE704", targetDateTime: "2026-08-05T17:05:00+09:00" },
    {
      env: { DATA_GO_KR_API_KEY: "test-key" },
      cache: false,
      fetchImpl: async (url) => ({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => url.includes("/TrainInfo/")
          ? { header: { resultCode: "01", resultMsg: "serviceKey required" } }
          : url.includes("open-meteo.com")
            ? {
                hourly: {
                  time: ["2026-08-05T17:00"],
                  precipitation_probability: [10],
                  precipitation: [0],
                  weather_code: [0],
                  wind_speed_10m: [8]
                }
              }
            : { response: { header: { resultCode: "00" }, body: { items: [] } } }
      })
    }
  );

  const tago = fusion.sources.find((source) => source.id === "tago-train");
  assert.equal(tago.mode, "fallback");
  assert.equal(tago.reasonCode, "TAGO_UPSTREAM_KEY_VALIDATION");
  assert.equal(tago.recoveryMode, "circuit-breaker");
  assert.equal(tago.provider, "local-snapshot");
  assert.equal(tago.snapshot.authoritative, false);
  assert.equal(tago.data.length, 4);
  assert.ok(tago.retryAt);
  assert.equal(fusion.sourceSummary.fallback, 1);
});

test("코레일 직접 운행계획이 승인되면 TAGO보다 먼저 사용한다", async () => {
  let korailCalls = 0;
  let tagoCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes("/B551457/run/v2/travelerTrainRunPlan2")) korailCalls += 1;
    if (url.includes("/TrainInfo/")) tagoCalls += 1;
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => url.includes("/B551457/run/v2/travelerTrainRunPlan2")
        ? {
            response: {
              header: { resultCode: "00" },
              body: {
                items: {
                  item: {
                    trn_no: "419",
                    run_ymd: "20260812",
                    dptre_stn_nm: "서울",
                    arvl_stn_nm: "전주",
                    trn_plan_dptre_dt: "20260812201200",
                    trn_plan_arvl_dt: "20260812215400"
                  }
                }
              }
            }
          }
        : url.includes("open-meteo.com")
          ? { hourly: { time: [], precipitation_probability: [], precipitation: [], weather_code: [], wind_speed_10m: [] } }
          : { response: { header: { resultCode: "00" }, body: { items: [] } } }
    };
  };

  const fusion = await buildDataFusion(
    { targetDateTime: "2026-08-12T17:05:00+09:00" },
    {
      env: { DATA_GO_KR_API_KEY: "test-key", KORAIL_OPEN_API_ENABLED: "true" },
      cache: false,
      fetchImpl
    }
  );
  const train = fusion.sources.find((source) => source.id === "tago-train");

  assert.equal(korailCalls, 1);
  assert.equal(tagoCalls, 0);
  assert.equal(train.mode, "live");
  assert.equal(train.provider, "korail-direct");
  assert.equal(train.data[0].trainNo, "419");
});

test("TAGO 인증 전달 오류는 회로를 열어 같은 실패 호출을 반복하지 않는다", async () => {
  let tagoCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes("/TrainInfo/")) tagoCalls += 1;
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => url.includes("/TrainInfo/")
        ? { header: { resultCode: "01", resultMsg: "serviceKey required" } }
        : url.includes("open-meteo.com")
          ? {
              hourly: {
                time: ["2026-08-05T17:00"],
                precipitation_probability: [10],
                precipitation: [0],
                weather_code: [0],
                wind_speed_10m: [8]
              }
            }
          : { response: { header: { resultCode: "00" }, body: { items: [] } } }
    };
  };

  const options = {
    env: { DATA_GO_KR_API_KEY: "test-key" },
    cache: false,
    fetchImpl,
    tagoRetryDelayMs: 0
  };
  const first = await buildDataFusion({ targetDateTime: "2026-08-05T17:05:00+09:00" }, options);
  const second = await buildDataFusion({ targetDateTime: "2026-08-05T18:05:00+09:00" }, options);
  const firstTago = first.sources.find((source) => source.id === "tago-train");
  const secondTago = second.sources.find((source) => source.id === "tago-train");

  assert.equal(tagoCalls, 1);
  assert.equal(firstTago.reasonCode, "TAGO_UPSTREAM_KEY_VALIDATION");
  assert.equal(secondTago.reasonCode, "TAGO_UPSTREAM_KEY_VALIDATION");
  assert.equal(secondTago.recoveryMode, "circuit-breaker");
});

test("TAGO 일시 장애는 한 번 재시도한 뒤 정상 시간표로 복구한다", async () => {
  let tagoCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes("/TrainInfo/")) {
      tagoCalls += 1;
      if (tagoCalls === 1) {
        return {
          ok: false,
          status: 503,
          headers: { get: () => "application/json" }
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({
          response: {
            header: { resultCode: "00" },
            body: {
              items: {
                item: {
                  trainno: "419",
                  traingradename: "KTX",
                  depplandtime: "20260805201200",
                  arrplandtime: "20260805215400"
                }
              }
            }
          }
        })
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => url.includes("open-meteo.com")
        ? {
            hourly: {
              time: ["2026-08-05T17:00"],
              precipitation_probability: [10],
              precipitation: [0],
              weather_code: [0],
              wind_speed_10m: [8]
            }
          }
        : { response: { header: { resultCode: "00" }, body: { items: [] } } }
    };
  };

  const fusion = await buildDataFusion(
    { targetDateTime: "2026-08-05T17:05:00+09:00" },
    {
      env: { DATA_GO_KR_API_KEY: "test-key" },
      cache: false,
      fetchImpl,
      tagoRetryDelayMs: 0
    }
  );
  const tago = fusion.sources.find((source) => source.id === "tago-train");

  assert.equal(tagoCalls, 2);
  assert.equal(tago.mode, "live");
  assert.equal(tago.data[0].trainNo, "419");
});
