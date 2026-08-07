import { buildChakchakFeatureVector } from "../../src/chakchak-features.js";
import { simulateConnection } from "../../src/engine.js";

export const DATASET_VERSION = "chakchak-simulator-2026-08-v3-terminal-time";
export const TRAINING_SEGMENTS = Object.freeze({ iid: 1000, stress: 600, lowRisk: 400, accessibility: 400 });
export const CALIBRATION_SEGMENTS = Object.freeze({ iid: 50, stress: 50, lowRisk: 50, accessibility: 50 });
export const VALIDATION_SEGMENTS = Object.freeze({ iid: 200, stress: 200, lowRisk: 200, accessibility: 200 });
export const TEACHER_SIMULATIONS_PER_ROW = 1200;

export function generateChakchakSimulationDataset() {
  const trainingRows = buildSplitRows("train", TRAINING_SEGMENTS, 0x20260821);
  const calibrationRows = buildSplitRows("calibration", CALIBRATION_SEGMENTS, 0x20260822);
  const validationBySegment = Object.fromEntries(
    Object.entries(VALIDATION_SEGMENTS).map(([segment, count], index) => [
      segment,
      buildRows(segment, count, 0x20260920 + index, `validation-${segment}`)
    ])
  );
  return {
    version: DATASET_VERSION,
    trainingRows,
    calibrationRows,
    validationBySegment,
    validationRows: Object.values(validationBySegment).flat()
  };
}

function buildSplitRows(split, segmentCounts, seedBase) {
  return Object.entries(segmentCounts).flatMap(([segment, count], index) =>
    buildRows(segment, count, seedBase + index, `${split}-${segment}`)
  );
}

function buildRows(segment, count, seed, seedPrefix) {
  const random = mulberry32(seed);
  return Array.from({ length: count }, (_, index) => {
    const input = sampleInput(segment, random);
    return simulateRow({ segment, index, input, seedPrefix });
  });
}

function sampleInput(segment, random) {
  const base = sampleBase(segment, random);
  const arrivalHourLocal = sampleArrivalHour(segment, random);
  return {
    ...base,
    terminal: random() < (segment === "stress" ? 0.68 : 0.56) ? "T2" : "T1",
    arrivalHourLocal
  };
}

function sampleBase(segment, random) {
  if (segment === "stress") {
    const checkedBaggage = random() < 0.84;
    return buildBase(random, checkedBaggage, [90, 240], [0.75, 2], [0.7, 2], [20, 90], [35, 360], [0, 30], 0.27, 0.48);
  }
  if (segment === "lowRisk") {
    const checkedBaggage = random() < 0.55;
    return buildBase(random, checkedBaggage, [0, 25], [0, 0.4], [0, 0.5], [0, 10], [100, 360], [3, 10], 0.08, 0.15);
  }
  if (segment === "accessibility") {
    const checkedBaggage = random() < 0.8;
    return buildBase(random, checkedBaggage, [0, 210], [0, 2], [0, 2], [0, 65], [55, 330], [5, 20], 1, 0.62);
  }
  const checkedBaggage = random() < 0.72;
  return buildBase(random, checkedBaggage, [0, 205], [0, 2], [0, 2], [0, 55], [55, 330], [3, 15], 0.16, 0.28);
}

function buildBase(random, checkedBaggage, flight, weather, immigration, baggage, window, buffer, accessibilityRate, luggageRate) {
  return {
    flightDelayMinutes: between(random, flight),
    weatherSeverity: between(random, weather),
    immigrationSeverity: between(random, immigration),
    baggageDelayMinutes: checkedBaggage ? between(random, baggage) : 0,
    checkedBaggage,
    accessibilityNeeds: random() < accessibilityRate,
    largeLuggage: random() < luggageRate,
    connectionWindowMinutes: between(random, window),
    boardingBufferMinutes: between(random, buffer)
  };
}

function sampleArrivalHour(segment, random) {
  if (segment === "stress" && random() < 0.72) return round(15.5 + random() * 5, 3);
  if (random() < 0.34) return round(6 + random() * 3.5, 3);
  if (random() < 0.62) return round(15.5 + random() * 5, 3);
  return round(random() * 24, 3);
}

function simulateRow({ segment, index, input, seedPrefix }) {
  const scheduledArrival = "2026-08-12T17:00:00+09:00";
  const departureTime = new Date(Date.parse(scheduledArrival) + input.connectionWindowMinutes * 60_000).toISOString();
  const common = {
    scheduledArrival,
    trains: [{ id: `${seedPrefix}-${index}`, departureTime }],
    boardingBufferMinutes: input.boardingBufferMinutes,
    terminal: input.terminal,
    arrivalHourLocal: input.arrivalHourLocal,
    scenarios: {
      flightDelayMinutes: input.flightDelayMinutes,
      heavyRain: input.weatherSeverity,
      immigrationCongestion: input.immigrationSeverity,
      baggageDelayMinutes: input.baggageDelayMinutes
    },
    traveler: {
      checkedBaggage: input.checkedBaggage,
      accessibilityNeeds: input.accessibilityNeeds,
      largeLuggage: input.largeLuggage
    }
  };
  const teacher = simulateConnection({
    ...common,
    seed: `${DATASET_VERSION}-${seedPrefix}-${index}-teacher`,
    simulations: TEACHER_SIMULATIONS_PER_ROW
  });
  const observation = simulateConnection({
    ...common,
    seed: `${DATASET_VERSION}-${seedPrefix}-${index}-observation`,
    simulations: 1
  });
  return {
    splitId: seedPrefix,
    segment,
    input,
    features: buildChakchakFeatureVector(input),
    observedMinutes: observation.platformArrival.minutesAfterScheduledArrival.p50,
    teacher: {
      p50: teacher.platformArrival.minutesAfterScheduledArrival.p50,
      p90: teacher.platformArrival.minutesAfterScheduledArrival.p90,
      p95: teacher.platformArrival.minutesAfterScheduledArrival.p95,
      boardingProbability: teacher.candidates[0].boardingProbability
    }
  };
}

function between(random, [minimum, maximum]) {
  return round(minimum + random() * (maximum - minimum), 3);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
