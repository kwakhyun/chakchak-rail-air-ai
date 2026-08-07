import { snapshotRailData, snapshotRailMetadata } from "./rail-snapshot.mjs";

const API_TIMEOUT_MS = 5500;
const TAGO_RETRY_DELAY_MS = 250;
const TAGO_CIRCUIT_OPEN_MS = 5 * 60 * 1000;

const SOURCE_DEFINITIONS = Object.freeze([
  {
    id: "incheon-flight",
    owner: "인천국제공항공사",
    name: "여객편 운항현황(다국어)",
    fields: "도착 예정·변경 시각, 터미널, 게이트, 수하물 수취대",
    officialUrl: "https://www.data.go.kr/data/15095093/openapi.do"
  },
  {
    id: "incheon-immigration",
    owner: "인천국제공항공사",
    name: "입국장현황 정보 서비스",
    fields: "입국장별 내·외국인 대기 인원, 실제 도착 시각",
    officialUrl: "https://www.data.go.kr/data/15095061/openapi.do"
  },
  {
    id: "airport-rail",
    owner: "인천국제공항공사",
    name: "인천공항 공항철도 운행 정보",
    fields: "직통·일반열차 계획·실제 도착과 출발 시각",
    officialUrl: "https://www.data.go.kr/data/15098226/openapi.do"
  },
  {
    id: "tago-train",
    owner: "한국철도공사·국토교통부(TAGO)",
    name: "KTX 운행계획",
    fields: "열차 출발·도착 시각과 TAGO 운임",
    officialUrl: "https://www.data.go.kr/data/15125762/openapi.do",
    secondaryOfficialUrl: "https://www.data.go.kr/data/15098552/openapi.do"
  },
  {
    id: "tour-api",
    owner: "한국관광공사",
    name: "국문 관광정보 서비스_GW",
    fields: "전주 관광지, 주소, 위치, 이미지",
    officialUrl: "https://www.data.go.kr/data/15101578/openapi.do"
  },
  {
    id: "aviation-weather",
    owner: "기상청 항공기상청",
    name: "항공기상전문 조회서비스",
    fields: "인천공항 풍속, 시정, 강수 등 항공기상 전문",
    officialUrl: "https://www.data.go.kr/data/15058804/openapi.do"
  },
  {
    id: "open-weather",
    owner: "Open-Meteo",
    name: "인천공항 시간별 기상",
    fields: "강수 확률, 강수량, 풍속, 날씨 코드",
    officialUrl: "https://open-meteo.com/en/docs"
  }
]);

const fusionCache = new Map();
const tagoCircuitByFetch = new WeakMap();

function tagoCircuitFor(fetchImpl) {
  let state = tagoCircuitByFetch.get(fetchImpl);
  if (!state) {
    state = {
      openUntil: 0,
      lastFailureAt: null,
      lastFailureReason: null,
      lastSuccessAt: null,
      lastGood: null
    };
    tagoCircuitByFetch.set(fetchImpl, state);
  }
  return state;
}

function definition(id) {
  return SOURCE_DEFINITIONS.find((source) => source.id === id);
}

function cleanText(value, fallback = "", maxLength = 100) {
  if (value === undefined || value === null) return fallback;
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength) || fallback;
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function itemsFrom(payload) {
  const candidates = [
    payload?.response?.body?.items?.item,
    payload?.response?.body?.items,
    payload?.items?.item,
    payload?.items,
    payload?.body?.items?.item
  ];
  const found = candidates.find((value) => value !== undefined && value !== null);
  if (!found) return [];
  return Array.isArray(found) ? found : [found];
}

function publicDataParams(serviceKey, extra = {}) {
  return new URLSearchParams({ serviceKey, ...extra });
}

async function fetchJson(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || API_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const contentType = response.headers?.get?.("content-type") || "";
    if (!contentType.includes("json")) {
      const text = await response.text();
      if (/SERVICE KEY|APPLICATION_ERROR|Unauthorized|Forbidden/i.test(text)) throw new Error("PUBLIC_DATA_AUTH");
      return assertSuccessfulPayload(JSON.parse(text));
    }
    return assertSuccessfulPayload(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

function assertSuccessfulPayload(payload) {
  const gatewayError = payload?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gatewayError) {
    const reason = cleanText(gatewayError.errMsg || gatewayError.returnAuthMsg, "PUBLIC_DATA_AUTH", 50);
    throw new Error(reason);
  }

  const header = payload?.response?.header || payload?.header;
  const resultCode = header?.resultCode ?? header?.resultCd;
  if (resultCode !== undefined && resultCode !== null) {
    const normalizedCode = String(resultCode).trim();
    if (!["0", "00", "0000"].includes(normalizedCode)) {
      throw new Error(`PUBLIC_DATA_${cleanText(normalizedCode, "ERROR", 12)}`);
    }
  }
  return payload;
}

function sourceResult(definition, mode, summary, data = null, reasonCode = null, extra = {}) {
  return {
    ...definition,
    mode,
    summary,
    checkedAt: new Date().toISOString(),
    data,
    reasonCode,
    ...extra
  };
}

function unavailable(id, reasonCode = "KEY_NOT_CONFIGURED") {
  return sourceResult(definition(id), "demo", "API 활용신청 전이라 검증된 체험값을 사용해요.", null, reasonCode);
}

function fallback(id, error) {
  const reasonCode = error?.name === "AbortError" ? "TIMEOUT" : cleanText(error?.message, "UPSTREAM_ERROR", 40);
  return sourceResult(definition(id), "fallback", "지금은 응답이 불안정해 체험값으로 자동 전환했어요.", null, reasonCode);
}

function tagoReason(error) {
  const message = cleanText(error?.message, "UPSTREAM_ERROR", 40);
  if (message === "PUBLIC_DATA_01") return "TAGO_UPSTREAM_KEY_VALIDATION";
  if (error?.name === "AbortError" || message === "TIMEOUT") return "TAGO_TIMEOUT";
  if (/^HTTP_5\d\d$/.test(message) || /fetch failed/i.test(message)) return "TAGO_UPSTREAM_UNAVAILABLE";
  if (message === "HTTP_429") return "TAGO_RATE_LIMIT";
  return message;
}

function retryableTagoError(error) {
  const reason = tagoReason(error);
  return reason === "TAGO_TIMEOUT" || reason === "TAGO_UPSTREAM_UNAVAILABLE" || reason === "TAGO_RATE_LIMIT";
}

function tagoFallback(state, error, now = Date.now()) {
  const reasonCode = tagoReason(error);
  const isKeyForwardingFailure = reasonCode === "TAGO_UPSTREAM_KEY_VALIDATION";
  state.lastFailureAt = new Date(now).toISOString();
  state.lastFailureReason = reasonCode;
  state.openUntil = now + TAGO_CIRCUIT_OPEN_MS;
  const retryAt = new Date(state.openUntil).toISOString();
  const usingLastGood = Boolean(state.lastGood);
  const summary = usingLastGood
    ? "TAGO 응답을 다시 확인하는 동안 마지막 정상 시간표를 사용해요."
    : isKeyForwardingFailure
      ? "TAGO가 인증 정보를 받지 못해 시연용 기준 시간표로 자동 전환했어요."
      : "철도 API 응답을 기다리는 동안 시연용 기준 시간표로 자동 전환했어요.";
  return sourceResult(
    definition("tago-train"),
    "fallback",
    summary,
    state.lastGood?.data || snapshotRailData(),
    reasonCode,
    {
      retryAt,
      lastLiveAt: state.lastGood?.checkedAt || null,
      recoveryMode: "circuit-breaker",
      provider: usingLastGood ? state.lastGood.provider || "last-known-good" : "local-snapshot",
      snapshot: usingLastGood ? null : snapshotRailMetadata()
    }
  );
}

function circuitFallback(state, now = Date.now()) {
  const usingLastGood = Boolean(state.lastGood);
  return sourceResult(
    definition("tago-train"),
    "fallback",
    state.lastGood
      ? "TAGO 응답을 다시 확인하는 동안 마지막 정상 시간표를 사용해요."
      : "TAGO 복구를 기다리는 동안 시연용 기준 시간표를 사용해요.",
    state.lastGood?.data || snapshotRailData(),
    state.lastFailureReason || "TAGO_CIRCUIT_OPEN",
    {
      retryAt: new Date(Math.max(now, state.openUntil)).toISOString(),
      lastLiveAt: state.lastGood?.checkedAt || null,
      recoveryMode: "circuit-breaker",
      provider: usingLastGood ? state.lastGood.provider || "last-known-good" : "local-snapshot",
      snapshot: usingLastGood ? null : snapshotRailMetadata()
    }
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeFlight(payload, flightId) {
  const wanted = cleanText(flightId).toUpperCase();
  const items = itemsFrom(payload);
  const match = items.find((item) => cleanText(item.flightId || item.flight_id).replace(/\s/g, "").toUpperCase() === wanted) || items[0];
  if (!match) return null;
  return compactObject({
    flightId: cleanText(match.flightId || match.flight_id, wanted, 12),
    airline: cleanText(match.airline, "", 50),
    origin: cleanText(match.airport || match.airportCode || match.airport_code, "", 50),
    scheduledTime: cleanText(match.scheduleDateTime || match.scheduledDateTime || match.scheduleDatetime, "", 30),
    estimatedTime: cleanText(match.estimatedDateTime || match.estimatedDatetime, "", 30),
    terminal: cleanText(match.terminalId || match.terminalid || match.terminal, "", 12),
    gate: cleanText(match.gatenumber || match.gateNumber || match.gate, "", 12),
    carousel: cleanText(match.carousel || match.baggageClaim || match.carouselnumer, "", 12),
    status: cleanText(match.remark || match.status, "", 50)
  });
}

export function normalizeImmigration(payload) {
  const entries = itemsFrom(payload).slice(0, 12).map((item) => compactObject({
    terminal: cleanText(item.terno || item.terminal || item.terminalId, "", 12),
    hall: cleanText(item.entrygate || item.entryGate || item.gate, "", 12),
    flightId: cleanText(item.flightid || item.flightId, "", 12),
    scheduledTime: cleanText(item.cgtdt || item.scheduledTime, "", 30),
    actualTime: cleanText(item.cgthm || item.actualTime, "", 30),
    koreanWaiting: Number(item.korean || item.koreanWaiting || 0),
    foreignWaiting: Number(item.foreigner || item.foreignWaiting || 0)
  }));
  return entries;
}

export function normalizeTrains(payload) {
  return itemsFrom(payload).slice(0, 16).map((item) => compactObject({
    trainNo: cleanText(item.trainno || item.trainNo, "", 20),
    service: cleanText(item.traingradename || item.trainGradeName, "열차", 40),
    departureStation: cleanText(item.depplacename || item.depPlaceName, "", 30),
    arrivalStation: cleanText(item.arrplacename || item.arrPlaceName, "", 30),
    departureTime: cleanText(item.depplandtime || item.depPlandTime, "", 30),
    arrivalTime: cleanText(item.arrplandtime || item.arrPlandTime, "", 30),
    adultFare: Number(item.adultcharge || item.adultCharge || 0)
  }));
}

export function normalizeKorailTrains(payload) {
  return itemsFrom(payload).slice(0, 32).map((item) => {
    const trainNo = cleanText(item.trn_no || item.trainNo, "", 20);
    return compactObject({
      trainNo,
      service: trainNo ? `열차 ${trainNo}` : "열차",
      departureStation: cleanText(item.dptre_stn_nm || item.departureStation, "", 30),
      arrivalStation: cleanText(item.arvl_stn_nm || item.arrivalStation, "", 30),
      departureTime: cleanText(item.trn_plan_dptre_dt || item.departureTime, "", 30),
      arrivalTime: cleanText(item.trn_plan_arvl_dt || item.arrivalTime, "", 30),
      serviceDate: cleanText(item.run_ymd || item.serviceDate, "", 12)
    });
  });
}

export function normalizeAirportRail(payload) {
  return itemsFrom(payload).slice(0, 20).map((item) => compactObject({
    serviceDate: cleanText(item.drvDt, "", 12),
    trainNo: cleanText(item.trnNo, "", 20),
    stationCode: cleanText(item.stnCd, "", 20),
    service: cleanText(item.trnClsfNm, "공항철도", 40),
    plannedArrival: cleanText(item.planArrvDttm, "", 30),
    plannedDeparture: cleanText(item.planDptrDttm, "", 30),
    actualArrival: cleanText(item.accomArrvDttm, "", 30),
    actualDeparture: cleanText(item.accomDptrDttm, "", 30)
  }));
}

export function normalizeMetar(payload) {
  const item = itemsFrom(payload)[0];
  if (!item) return null;
  return compactObject({
    icaoCode: cleanText(item.icaoCode || item.icao, "RKSI", 8),
    airportName: cleanText(item.airportName, "인천국제공항", 50),
    observedAt: cleanText(item.tm || item.observationTime || item.baseTime, "", 30),
    metar: cleanText(item.metarMsg || item.metar, "", 500)
  });
}

function tourismContentType(value) {
  const typeId = String(value || "");
  if (typeId === "39") return "food";
  if (typeId === "32") return "stay";
  if (typeId === "14" || typeId === "15") return "culture";
  if (typeId === "28" || typeId === "38") return "experience";
  return "";
}

export function normalizeTourism(payload) {
  return itemsFrom(payload).slice(0, 8).map((item) => compactObject({
    contentId: cleanText(item.contentid || item.contentId, "", 30),
    contentType: tourismContentType(item.contenttypeid || item.contentTypeId),
    title: cleanText(item.title, "관광지", 80),
    address: cleanText(item.addr1 || item.address, "", 120),
    imageUrl: cleanText(item.firstimage || item.firstImage, "", 300),
    longitude: Number(item.mapx || item.longitude || 0),
    latitude: Number(item.mapy || item.latitude || 0)
  }));
}

function closestWeather(payload, targetDateTime) {
  const times = payload?.hourly?.time || [];
  if (!times.length) return null;
  const target = new Date(targetDateTime).getTime();
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  times.forEach((time, index) => {
    const distance = Math.abs(new Date(`${time}:00+09:00`).getTime() - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return {
    time: times[bestIndex],
    precipitationProbability: payload.hourly.precipitation_probability?.[bestIndex] ?? null,
    precipitationMm: payload.hourly.precipitation?.[bestIndex] ?? null,
    windSpeedKmh: payload.hourly.wind_speed_10m?.[bestIndex] ?? null,
    weatherCode: payload.hourly.weather_code?.[bestIndex] ?? null
  };
}

async function fetchFlight({ key, flightId, fetchImpl }) {
  if (!key) return unavailable("incheon-flight");
  try {
    const params = publicDataParams(key, { flight_id: flightId, lang: "K", type: "json" });
    const payload = await fetchJson(`https://apis.data.go.kr/B551177/StatusOfPassengerFlightsOdp/getPassengerArrivalsOdp?${params}`, { fetchImpl });
    const data = normalizeFlight(payload, flightId);
    return sourceResult(definition("incheon-flight"), "live", data ? `${data.flightId} 최신 도착 정보를 확인했어요.` : "현재 조회 구간에 해당 항공편이 없어요.", data);
  } catch (error) {
    return fallback("incheon-flight", error);
  }
}

async function fetchImmigration({ key, fetchImpl }) {
  if (!key) return unavailable("incheon-immigration");
  try {
    const params = publicDataParams(key, { numOfRows: "30", pageNo: "1", type: "json" });
    const payload = await fetchJson(`https://apis.data.go.kr/B551177/StatusOfArrivals/getArrivalsCongestion?${params}`, { fetchImpl });
    const data = normalizeImmigration(payload);
    return sourceResult(definition("incheon-immigration"), "live", data.length ? `입국장 ${data.length}개 관측값을 확인했어요.` : "현재 조회 구간의 입국장 관측값이 없어요.", data);
  } catch (error) {
    return fallback("incheon-immigration", error);
  }
}

async function fetchAirportRail({ key, date, fetchImpl }) {
  if (!key) return unavailable("airport-rail");
  try {
    const params = publicDataParams(key, {
      pageNo: "1",
      numOfRows: "100",
      trainClsf: "Dirc",
      drvDt: date.replaceAll("-", ""),
      type: "json"
    });
    const payload = await fetchJson(`https://apis.data.go.kr/B551177/AirportRailroadOperationInfo/getAirportRailroad?${params}`, { fetchImpl });
    const data = normalizeAirportRail(payload);
    return sourceResult(definition("airport-rail"), "live", data.length ? `공항철도 운행값 ${data.length}건을 확인했어요.` : "공개 범위(D-3~D+3) 밖이거나 운행값이 없어요.", data);
  } catch (error) {
    return fallback("airport-rail", error);
  }
}

async function fetchKorailTrainPlan({ key, date, fetchImpl }) {
  const compactDate = date.replaceAll("-", "");
  const params = publicDataParams(key, {
    pageNo: "1",
    numOfRows: "100",
    returnType: "JSON",
    "cond[run_ymd::GTE]": compactDate,
    "cond[run_ymd::LTE]": compactDate,
    "cond[dptre_stn_nm::EQ]": "서울",
    "cond[arvl_stn_nm::EQ]": "전주"
  });
  const payload = await fetchJson(`https://apis.data.go.kr/B551457/run/v2/travelerTrainRunPlan2?${params}`, { fetchImpl });
  return normalizeKorailTrains(payload);
}

async function fetchTrains({ key, date, fetchImpl, retryDelayMs = TAGO_RETRY_DELAY_MS, korailEnabled = false }) {
  if (!key) return unavailable("tago-train");
  const circuit = tagoCircuitFor(fetchImpl);
  const now = Date.now();
  if (circuit.openUntil > now) return circuitFallback(circuit, now);

  if (korailEnabled) {
    try {
      const data = await fetchKorailTrainPlan({ key, date, fetchImpl });
      if (data.length) {
        const checkedAt = new Date().toISOString();
        circuit.openUntil = 0;
        circuit.lastFailureAt = null;
        circuit.lastFailureReason = null;
        circuit.lastSuccessAt = checkedAt;
        circuit.lastGood = { checkedAt, data, provider: "korail-direct" };
        return sourceResult(
          definition("tago-train"),
          "live",
          `코레일 서울–전주 운행계획 ${data.length}편을 확인했어요.`,
          data,
          null,
          { provider: "korail-direct", fareMode: "official-channel-check" }
        );
      }
    } catch {
      // Direct KORAIL access is optional. TAGO remains the secondary provider.
    }
  }

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const params = publicDataParams(key, {
        pageNo: "1",
        numOfRows: "100",
        _type: "json",
        depPlaceId: "NAT010000",
        arrPlaceId: "NAT040257",
        depPlandTime: date.replaceAll("-", ""),
        trainGradeCode: "00"
      });
      const payload = await fetchJson(`https://apis.data.go.kr/1613000/TrainInfo/GetStrtpntAlocFndTrainInfo?${params}`, { fetchImpl });
      const data = normalizeTrains(payload);
      const checkedAt = new Date().toISOString();
      circuit.openUntil = 0;
      circuit.lastFailureAt = null;
      circuit.lastFailureReason = null;
      circuit.lastSuccessAt = checkedAt;
      circuit.lastGood = { checkedAt, data, provider: "tago" };
      return sourceResult(definition("tago-train"), "live", data.length ? `TAGO 서울–전주 열차 ${data.length}편을 확인했어요.` : "해당 날짜의 공개 시간표가 아직 없어요.", data, null, { provider: "tago" });
    } catch (error) {
      lastError = error;
      if (attempt === 0 && retryableTagoError(error)) {
        await wait(Math.max(0, retryDelayMs));
        continue;
      }
      break;
    }
  }
  return tagoFallback(circuit, lastError);
}

async function fetchTourism({ key, fetchImpl }) {
  if (!key) return unavailable("tour-api");
  try {
    const params = publicDataParams(key, {
      MobileOS: "WEB",
      MobileApp: "CHAKCHAK",
      _type: "json",
      pageNo: "1",
      numOfRows: "12",
      arrange: "S",
      mapX: "127.1535",
      mapY: "35.8152",
      radius: "10000"
    });
    const payload = await fetchJson(`https://apis.data.go.kr/B551011/KorService2/locationBasedList2?${params}`, { fetchImpl });
    const data = normalizeTourism(payload);
    return sourceResult(definition("tour-api"), "live", data.length ? `전주 관광 콘텐츠 ${data.length}곳을 확인했어요.` : "현재 조건에 맞는 관광 콘텐츠가 없어요.", data);
  } catch (error) {
    return fallback("tour-api", error);
  }
}

async function fetchAviationWeather({ key, fetchImpl }) {
  if (!key) return unavailable("aviation-weather");
  try {
    const params = new URLSearchParams({
      ServiceKey: key,
      pageNo: "1",
      numOfRows: "10",
      dataType: "JSON",
      icao: "RKSI"
    });
    const payload = await fetchJson(`https://apis.data.go.kr/1360000/AmmService/getMetar?${params}`, { fetchImpl });
    const data = normalizeMetar(payload);
    return sourceResult(definition("aviation-weather"), "live", data ? "인천공항 최신 METAR 관측을 확인했어요." : "현재 제공된 METAR 관측이 없어요.", data);
  } catch (error) {
    return fallback("aviation-weather", error);
  }
}

async function fetchWeather({ targetDateTime, fetchImpl }) {
  try {
    const params = new URLSearchParams({
      latitude: "37.4602",
      longitude: "126.4407",
      hourly: "precipitation_probability,precipitation,weather_code,wind_speed_10m",
      timezone: "Asia/Seoul",
      forecast_days: "16"
    });
    const payload = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`, { fetchImpl });
    const data = closestWeather(payload, targetDateTime);
    return sourceResult(definition("open-weather"), "live", data ? `${data.time.replace("T", " ")} 공항 기상 예보를 확인했어요.` : "해당 시각의 기상 예보가 아직 없어요.", data);
  } catch (error) {
    return fallback("open-weather", error);
  }
}

export function publicDataStatus(env = process.env) {
  const tagoCircuit = tagoCircuitByFetch.get(fetch);
  const now = Date.now();
  return {
    publicDataConfigured: Boolean(env.DATA_GO_KR_API_KEY),
    tourismConfigured: Boolean(env.TOUR_API_KEY || env.DATA_GO_KR_API_KEY),
    openWeatherConfigured: true,
    tagoRecovery: {
      mode: tagoCircuit?.openUntil > now ? "automatic-fallback" : "ready-to-check",
      retryAt: tagoCircuit?.openUntil > now ? new Date(tagoCircuit.openUntil).toISOString() : null,
      lastIssueCode: tagoCircuit?.lastFailureReason || null,
      lastLiveAt: tagoCircuit?.lastSuccessAt || null,
      providerOrder: env.KORAIL_OPEN_API_ENABLED === "true"
        ? ["korail-direct", "tago", "local-snapshot"]
        : ["tago", "local-snapshot"],
      snapshot: snapshotRailMetadata()
    }
  };
}

export async function buildDataFusion(query = {}, options = {}) {
  const env = options.env || process.env;
  const flightId = cleanText(query.flightId, "KE704", 10).toUpperCase().replace(/[^A-Z0-9]/g, "") || "KE704";
  const targetDateTime = cleanText(query.targetDateTime, "2026-08-12T17:05:00+09:00", 40);
  const date = /^\d{4}-\d{2}-\d{2}/.test(targetDateTime) ? targetDateTime.slice(0, 10) : "2026-08-12";
  const key = env.DATA_GO_KR_API_KEY || "";
  const tourismKey = env.TOUR_API_KEY || key;
  const fetchImpl = options.fetchImpl || fetch;

  const cacheKey = `${flightId}:${date}`;
  const cached = fusionCache.get(cacheKey);
  if (options.cache !== false && cached && Date.now() - cached.createdAt < 45_000) {
    return { ...cached.value, cache: { hit: true, maxAgeSeconds: 45 } };
  }

  const sources = await Promise.all([
    fetchFlight({ key, flightId, fetchImpl }),
    fetchImmigration({ key, fetchImpl }),
    fetchAirportRail({ key, date, fetchImpl }),
    fetchTrains({
      key,
      date,
      fetchImpl,
      retryDelayMs: options.tagoRetryDelayMs,
      korailEnabled: env.KORAIL_OPEN_API_ENABLED === "true"
    }),
    fetchTourism({ key: tourismKey, fetchImpl }),
    fetchAviationWeather({ key, fetchImpl }),
    fetchWeather({ targetDateTime, fetchImpl })
  ]);

  const liveCount = sources.filter((source) => source.mode === "live").length;
  const overallMode = liveCount === sources.length ? "live" : liveCount > 0 ? "hybrid" : "demo";

  const value = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    journey: { flightId, destination: "전주", targetDateTime },
    overallMode,
    sourceSummary: {
      live: liveCount,
      fallback: sources.filter((source) => source.mode === "fallback").length,
      demo: sources.filter((source) => source.mode === "demo").length
    },
    sources,
    notice: "기관 관측값, 계산 결과, 체험값을 구분해 사용합니다. 좌석과 승차권 변경은 운영사에서 최종 확인해야 합니다.",
    cache: { hit: false, maxAgeSeconds: 45 }
  };
  if (options.cache !== false) fusionCache.set(cacheKey, { createdAt: Date.now(), value });
  return value;
}

export { SOURCE_DEFINITIONS };
