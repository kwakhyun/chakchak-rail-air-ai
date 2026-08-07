/**
 * Deterministic rail-connection risk engine.
 *
 * The public contract deliberately uses plain JSON values so it can run in a
 * browser, a Node server, or a Web Worker without an adapter.
 */

export const DEFAULT_SIMULATIONS = 1200;

const MINUTE_MS = 60_000;
const DEFAULT_BOARDING_BUFFER_MINUTES = 5;
const DEFAULT_SAFE_PROBABILITY = 0.85;

/**
 * Simulate the time at which an arriving international passenger reaches the
 * rail platform, then score each candidate train.
 *
 * @param {object} input
 * @param {string} input.scheduledArrival ISO-8601 aircraft arrival time.
 * @param {{id:string, departureTime:string, [key:string]:unknown}[]} input.trains
 * @param {number|string} [input.seed=2026]
 * @param {number} [input.simulations=1200]
 * @param {number} [input.boardingBufferMinutes=5]
 * @param {number} [input.safeProbability=0.85]
 * @param {object} [input.scenarios]
 * @param {object} [input.traveler]
 * @param {object} [input.tourismPlan]
 * @returns {object} JSON-safe simulation result.
 */
export function simulateConnection(input) {
  const config = normalizeInput(input);
  const random = mulberry32(hashSeed(config.seed));
  const normal = createNormalSampler(random);

  const stageSamples = Object.fromEntries(
    STAGE_NAMES.map((stage) => [stage, []]),
  );
  const platformArrivalOffsets = [];
  const platformArrivalTimes = [];

  for (let index = 0; index < config.simulations; index += 1) {
    const stages = sampleStages(config, normal);
    let totalMinutes = 0;

    for (const stage of STAGE_NAMES) {
      const value = stages[stage];
      stageSamples[stage].push(value);
      totalMinutes += value;
    }

    platformArrivalOffsets.push(totalMinutes);
    platformArrivalTimes.push(
      config.scheduledArrivalMs + totalMinutes * MINUTE_MS,
    );
  }

  platformArrivalOffsets.sort(ascending);
  platformArrivalTimes.sort(ascending);
  for (const values of Object.values(stageSamples)) values.sort(ascending);

  const arrivalP50Ms = quantile(platformArrivalTimes, 0.5);
  const arrivalP90Ms = quantile(platformArrivalTimes, 0.9);
  const arrivalP95Ms = quantile(platformArrivalTimes, 0.95);

  const candidates = config.trains.map((train, index) => {
    let boardable = 0;
    const cutoffMs =
      train.departureMs - train.boardingBufferMinutes * MINUTE_MS;

    for (const arrivalMs of platformArrivalTimes) {
      if (arrivalMs <= cutoffMs) boardable += 1;
      else break;
    }

    const boardingProbabilityRaw = boardable / config.simulations;
    const marginAtP50 =
      (train.departureMs - arrivalP50Ms) / MINUTE_MS -
      train.boardingBufferMinutes;
    const marginAtP90 =
      (train.departureMs - arrivalP90Ms) / MINUTE_MS -
      train.boardingBufferMinutes;
    const riskLevel = classifyRisk(
      boardingProbabilityRaw,
      marginAtP50,
      marginAtP90,
    );

    return {
      id: train.id,
      label: train.label,
      service: train.service,
      destination: train.destination,
      departureTime: toIso(train.departureMs),
      originalPriority: index + 1,
      boardingProbability: round(boardingProbabilityRaw, 3),
      boardingProbabilityPercent: round(boardingProbabilityRaw * 100, 1),
      bufferMinutes: {
        // p90 is the remaining buffer when platform-arrival time is at P90.
        // It is intentionally more conservative than p50.
        p50: round(marginAtP50, 1),
        p90: round(marginAtP90, 1),
      },
      riskLevel,
      isSafe:
        boardingProbabilityRaw >= config.safeProbability && marginAtP90 >= 0,
      riskReasons: buildRiskReasons(
        boardingProbabilityRaw,
        marginAtP50,
        marginAtP90,
        config,
      ),
    };
  });

  const recommendation = chooseRecommendation(candidates, config);

  return {
    schemaVersion: "1.0",
    seed: String(config.seed),
    simulationCount: config.simulations,
    assumptions: {
      scheduledArrival: toIso(config.scheduledArrivalMs),
      boardingBufferMinutes: config.boardingBufferMinutes,
      safeProbability: config.safeProbability,
      bufferDefinition:
        "train departure minus boarding buffer minus platform-arrival percentile",
      normalizedScenarios: config.scenarios,
      traveler: config.traveler,
      airport: config.airport,
      arrivalHourLocal: config.arrivalHourLocal,
    },
    platformArrival: {
      p50: toIso(arrivalP50Ms),
      p90: toIso(arrivalP90Ms),
      p95: toIso(arrivalP95Ms),
      minutesAfterScheduledArrival: {
        p50: round(quantile(platformArrivalOffsets, 0.5), 1),
        p90: round(quantile(platformArrivalOffsets, 0.9), 1),
        p95: round(quantile(platformArrivalOffsets, 0.95), 1),
      },
    },
    stageBreakdown: Object.fromEntries(
      STAGE_NAMES.map((stage) => [
        stage,
        {
          p50Minutes: round(quantile(stageSamples[stage], 0.5), 1),
          p90Minutes: round(quantile(stageSamples[stage], 0.9), 1),
          meanMinutes: round(mean(stageSamples[stage]), 1),
        },
      ]),
    ),
    candidates,
    recommendation,
    tourismAdjustment: buildTourismAdjustment(recommendation, candidates, config),
  };
}

// A discoverable alias for callers that think of the operation as journey risk.
export const calculateConnectionRisk = simulateConnection;

const STAGE_NAMES = [
  "flightArrivalDelay",
  "deplaning",
  "immigration",
  "baggageClaim",
  "airportMovement",
  "railPlatformAccess",
];

function sampleStages(config, normal) {
  const { scenarios, traveler } = config;
  const rain = scenarios.heavyRainSeverity;
  const immigration = scenarios.immigrationCongestionSeverity;
  const terminalT2 = config.airport.terminal === "T2" ? 1 : 0;
  const peak = peakSeverity(config.arrivalHourLocal);

  const flightMean = scenarios.flightDelayMinutes + rain * 9;
  const flightSd = 7 + rain * 7 + Math.min(scenarios.flightDelayMinutes * 0.12, 15);

  const deplaningMean =
    14 +
    (traveler.accessibilityNeeds ? 7 : 0) +
    (traveler.largeLuggage ? 2 : 0) +
    peak * 2;

  const immigrationMean = 22 + immigration * 23 + rain * 2 + peak * 8;
  const immigrationSd = 8 + immigration * 10;

  const baggageMean = traveler.checkedBaggage
    ? 18 +
      scenarios.baggageDelayMinutes +
      (traveler.largeLuggage ? 7 : 0) +
      rain * 3
    : 0;

  const movementMean =
    11 +
    rain * 3 +
    (traveler.accessibilityNeeds ? 8 : 0) +
    (traveler.largeLuggage ? 5 : 0) +
    terminalT2 * 4 +
    peak * 2;

  const platformMean =
    7 +
    rain * 2 +
    (traveler.accessibilityNeeds ? 5 : 0) +
    (traveler.largeLuggage ? 3 : 0) +
    terminalT2 * 2;

  return {
    flightArrivalDelay: clamp(
      flightMean + normal() * flightSd,
      -15,
      flightMean + 90,
    ),
    deplaning: samplePositive(normal, deplaningMean, 0.3, 5, 60),
    immigration: samplePositive(normal, immigrationMean, 0.48, 4, 180),
    baggageClaim: traveler.checkedBaggage
      ? samplePositive(normal, baggageMean, 0.46, 3, 180)
      : 0,
    airportMovement: samplePositive(normal, movementMean, 0.3, 4, 80),
    railPlatformAccess: samplePositive(normal, platformMean, 0.28, 2, 50),
  };
}

function chooseRecommendation(candidates, config) {
  const primary = candidates[0];
  const earliestSafe = candidates.find((candidate) => candidate.isSafe);
  const selected = earliestSafe ?? bestAvailableCandidate(candidates);
  const switched = selected.id !== primary.id;
  const noSafeCandidate = !earliestSafe;

  let action = "KEEP_PRIMARY";
  let reason = "최우선 열차의 P90 여유시간과 탑승확률이 안전 기준을 충족합니다.";

  if (switched && !noSafeCandidate) {
    action = "SWITCH_TO_SAFER_TRAIN";
    reason = `최우선 열차의 탑승확률이 ${primary.boardingProbabilityPercent}%여서 다음 안전 열차로 조정했습니다.`;
  } else if (noSafeCandidate) {
    action = "REPLAN_ROUTE";
    reason =
      "안전 기준을 충족하는 열차가 없습니다. 표시된 최선 후보를 유지하되 대체 노선 또는 현장 재예약이 필요합니다.";
  }

  return {
    action,
    primaryTrainId: primary.id,
    selectedTrainId: selected.id,
    alternateTrainId: switched ? selected.id : null,
    switched,
    noSafeCandidate,
    reason,
    confidence: selected.boardingProbability,
    safetyThreshold: config.safeProbability,
  };
}

function bestAvailableCandidate(candidates) {
  return candidates.reduce((best, candidate) => {
    if (candidate.boardingProbability > best.boardingProbability) return candidate;
    if (
      candidate.boardingProbability === best.boardingProbability &&
      candidate.bufferMinutes.p90 > best.bufferMinutes.p90
    ) {
      return candidate;
    }
    return best;
  });
}

function buildTourismAdjustment(recommendation, candidates, config) {
  const primary = candidates.find(
    (candidate) => candidate.id === recommendation.primaryTrainId,
  );
  const selected = candidates.find(
    (candidate) => candidate.id === recommendation.selectedTrainId,
  );
  const shiftMinutes = Math.max(
    0,
    Math.round(
      (Date.parse(selected.departureTime) - Date.parse(primary.departureTime)) /
        MINUTE_MS,
    ),
  );

  if (!recommendation.switched && !recommendation.noSafeCandidate) {
    return {
      required: false,
      action: "KEEP_SCHEDULE",
      shiftMinutes: 0,
      revisedStartTime: config.tourismPlan.startTime,
      message: "기존 관광 일정을 유지할 수 있습니다.",
    };
  }

  if (recommendation.noSafeCandidate) {
    return {
      required: true,
      action: "HOLD_AND_REPLAN",
      shiftMinutes,
      revisedStartTime: shiftIso(config.tourismPlan.startTime, shiftMinutes),
      message:
        "확정 가능한 안전 열차가 없어 첫 관광지 예약을 보류하고 대체 노선을 확인하세요.",
      suggestions: [
        "첫 관광지를 당일 취소 가능한 장소로 교체",
        "도착 후 실시간 열차 좌석과 막차를 다시 확인",
      ],
    };
  }

  const flex = config.tourismPlan.flexibleMinutes;
  const withinFlex = shiftMinutes <= flex;
  return {
    required: true,
    action: withinFlex ? "USE_FLEX_BUFFER" : "SHIFT_AND_TRIM",
    shiftMinutes,
    revisedStartTime: shiftIso(config.tourismPlan.startTime, shiftMinutes),
    message: withinFlex
      ? `예비시간 ${flex}분 안에서 관광 시작을 ${shiftMinutes}분 늦춥니다.`
      : `관광 시작을 ${shiftMinutes}분 늦추고 체류시간이 짧은 선택 일정을 축소합니다.`,
    suggestions: withinFlex
      ? ["예약 시간만 순연", "핵심 관광지는 유지"]
      : ["선택 관광지 1곳 생략", "식사·체크인 시간을 유연하게 조정"],
  };
}

function buildRiskReasons(probability, marginP50, marginP90, config) {
  const reasons = [];
  if (probability < config.safeProbability) {
    reasons.push("BOARDING_PROBABILITY_BELOW_TARGET");
  }
  if (marginP50 < 0) reasons.push("NEGATIVE_P50_BUFFER");
  if (marginP90 < 0) reasons.push("NEGATIVE_P90_BUFFER");
  if (config.scenarios.heavyRainSeverity > 0) reasons.push("HEAVY_RAIN");
  if (config.scenarios.flightDelayMinutes > 0) reasons.push("FLIGHT_DELAY");
  if (config.scenarios.immigrationCongestionSeverity > 0) {
    reasons.push("IMMIGRATION_CONGESTION");
  }
  if (config.scenarios.baggageDelayMinutes > 0) reasons.push("BAGGAGE_DELAY");
  if (config.traveler.accessibilityNeeds) reasons.push("ACCESSIBILITY_NEEDS");
  if (config.traveler.largeLuggage) reasons.push("LARGE_LUGGAGE");
  return reasons;
}

function classifyRisk(probability, marginP50, marginP90) {
  if (probability >= 0.9 && marginP90 >= 0) return "LOW";
  if (probability >= 0.75 && marginP50 >= 0) return "MEDIUM";
  if (probability >= 0.4) return "HIGH";
  return "CRITICAL";
}

function normalizeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("input must be an object");
  }

  const scheduledArrival =
    input.scheduledArrival ?? input.flight?.scheduledArrival;
  const scheduledArrivalMs = parseDate(scheduledArrival, "scheduledArrival");
  const simulations = integerInRange(
    input.simulations ?? DEFAULT_SIMULATIONS,
    1,
    100_000,
    "simulations",
  );
  const boardingBufferMinutes = numberInRange(
    input.boardingBufferMinutes ?? DEFAULT_BOARDING_BUFFER_MINUTES,
    0,
    60,
    "boardingBufferMinutes",
  );
  const safeProbability = numberInRange(
    input.safeProbability ?? DEFAULT_SAFE_PROBABILITY,
    0.5,
    0.999,
    "safeProbability",
  );

  if (!Array.isArray(input.trains) || input.trains.length === 0) {
    throw new TypeError("trains must be a non-empty array");
  }

  const seenIds = new Set();
  const trains = input.trains
    .map((train, index) => {
      if (!train || typeof train !== "object") {
        throw new TypeError(`trains[${index}] must be an object`);
      }
      const id = String(train.id ?? "").trim();
      if (!id) throw new TypeError(`trains[${index}].id is required`);
      if (seenIds.has(id)) throw new TypeError(`duplicate train id: ${id}`);
      seenIds.add(id);
      return {
        id,
        label: train.label ?? id,
        service: train.service ?? null,
        destination: train.destination ?? null,
        departureMs: parseDate(
          train.departureTime ?? train.departure,
          `trains[${index}].departureTime`,
        ),
        boardingBufferMinutes: numberInRange(
          train.boardingBufferMinutes ?? boardingBufferMinutes,
          0,
          60,
          `trains[${index}].boardingBufferMinutes`,
        ),
      };
    })
    .sort((a, b) => a.departureMs - b.departureMs);

  const scenarioInput = input.scenarios ?? input.scenario ?? {};
  const travelerInput = input.traveler ?? {};
  const estimatedDelay = deriveEstimatedDelay(input, scheduledArrivalMs);
  const scenarios = {
    heavyRainSeverity: severity(
      scenarioInput.heavyRain ?? scenarioInput.rain,
    ),
    flightDelayMinutes: numberInRange(
      scenarioInput.flightDelayMinutes ??
        input.flightDelayMinutes ??
        estimatedDelay ??
        0,
      0,
      720,
      "scenarios.flightDelayMinutes",
    ),
    immigrationCongestionSeverity: severity(
      scenarioInput.immigrationCongestion ?? scenarioInput.immigrationCrowding,
    ),
    baggageDelayMinutes: normalizeDelayScenario(
      scenarioInput.baggageDelayMinutes ?? scenarioInput.baggageDelay,
      20,
      "scenarios.baggageDelayMinutes",
    ),
  };
  const traveler = {
    checkedBaggage:
      travelerInput.checkedBaggage ?? input.checkedBaggage ?? true,
    accessibilityNeeds: Boolean(
      travelerInput.accessibilityNeeds ??
        travelerInput.reducedMobility ??
        scenarioInput.accessibilityNeeds ??
        false,
    ),
    largeLuggage: Boolean(
      travelerInput.largeLuggage ?? scenarioInput.largeLuggage ?? false,
    ),
  };

  if (typeof traveler.checkedBaggage !== "boolean") {
    throw new TypeError("traveler.checkedBaggage must be a boolean");
  }

  const tourismInput = input.tourismPlan ?? {};
  const tourismStart = tourismInput.startTime ?? null;
  if (tourismStart !== null) parseDate(tourismStart, "tourismPlan.startTime");

  return {
    scheduledArrivalMs,
    simulations,
    seed: input.seed ?? 2026,
    boardingBufferMinutes,
    safeProbability,
    trains,
    scenarios,
    traveler,
    airport: {
      terminal: normalizeTerminal(input.terminal ?? input.airport?.terminal)
    },
    arrivalHourLocal: numberInRange(
      input.arrivalHourLocal ?? localHour(scheduledArrivalMs),
      0,
      23.999,
      "arrivalHourLocal"
    ),
    tourismPlan: {
      startTime: tourismStart === null ? null : toIso(Date.parse(tourismStart)),
      flexibleMinutes: numberInRange(
        tourismInput.flexibleMinutes ?? 30,
        0,
        720,
        "tourismPlan.flexibleMinutes",
      ),
    },
  };
}

function normalizeTerminal(value) {
  const terminal = String(value || "T1").trim().toUpperCase();
  return terminal === "T1" || terminal === "1" || terminal === "P01" ? "T1" : "T2";
}

function localHour(timestampMs) {
  const date = new Date(timestampMs + 9 * 60 * MINUTE_MS);
  return date.getUTCHours() + date.getUTCMinutes() / 60;
}

function peakSeverity(hour) {
  if (hour >= 6 && hour < 9.5) return 0.7;
  if (hour >= 15.5 && hour < 20.5) return 1;
  if (hour >= 22 || hour < 4.5) return 0.35;
  return 0.15;
}

function deriveEstimatedDelay(input, scheduledArrivalMs) {
  const estimatedArrival =
    input.estimatedArrival ?? input.flight?.estimatedArrival;
  if (estimatedArrival == null) return null;
  return Math.max(
    0,
    (parseDate(estimatedArrival, "estimatedArrival") - scheduledArrivalMs) /
      MINUTE_MS,
  );
}

function normalizeDelayScenario(value, defaultWhenTrue, name) {
  if (value === true) return defaultWhenTrue;
  if (value === false || value == null) return 0;
  return numberInRange(value, 0, 360, name);
}

function severity(value) {
  if (value === true) return 1;
  if (value === false || value == null || value === "none") return 0;
  if (value === "moderate" || value === "medium") return 1;
  if (value === "severe" || value === "high") return 2;
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value, 0, 2);
  }
  throw new TypeError(`invalid scenario severity: ${String(value)}`);
}

function samplePositive(normal, targetMean, coefficientOfVariation, min, max) {
  if (targetMean <= 0) return 0;
  const varianceRatio = coefficientOfVariation ** 2;
  const sigma = Math.sqrt(Math.log(1 + varianceRatio));
  const mu = Math.log(targetMean) - sigma ** 2 / 2;
  return clamp(Math.exp(mu + sigma * normal()), min, max);
}

function createNormalSampler(random) {
  let spare = null;
  return function normal() {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = random();
    while (v === 0) v = random();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * v;
    spare = magnitude * Math.sin(angle);
    return magnitude * Math.cos(angle);
  };
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hashSeed(seed) {
  const text = String(seed);
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function quantile(sortedValues, probability) {
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseDate(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be an ISO-8601 string`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${name} must be a valid ISO-8601 string`);
  }
  return parsed;
}

function integerInRange(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function numberInRange(value, min, max, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a number from ${min} to ${max}`);
  }
  return value;
}

function shiftIso(value, minutes) {
  if (value === null) return null;
  return toIso(Date.parse(value) + minutes * MINUTE_MS);
}

function toIso(milliseconds) {
  return new Date(Math.round(milliseconds)).toISOString();
}

function round(value, digits) {
  const factor = 10 ** digits;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ascending(a, b) {
  return a - b;
}
