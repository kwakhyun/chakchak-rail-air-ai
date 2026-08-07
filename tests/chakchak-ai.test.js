import assert from "node:assert/strict";
import test from "node:test";

import { chakchakModelStatus, predictChakchakConnection, predictChakchakJourney } from "../src/chakchak-ai.js";
import { simulateConnection } from "../src/engine.js";

const base = {
  flightDelayMinutes: 0,
  weatherSeverity: 0.2,
  immigrationSeverity: 0.35,
  baggageDelayMinutes: 0,
  checkedBaggage: true,
  accessibilityNeeds: false,
  largeLuggage: false,
  connectionWindowMinutes: 150,
  boardingBufferMinutes: 5,
  flightMode: "live",
  immigrationMode: "live",
  weatherMode: "live"
};

test("착착 자체 모델은 독립 버전·학습 증거·품질지표를 제공한다", () => {
  const status = chakchakModelStatus();
  assert.equal(status.id, "chakchak-connection-ai");
  assert.equal(status.version, "2.0.0-sim");
  assert.equal(status.training.realWorldCalibrated, false);
  assert.equal(status.training.trainingRows, 2400);
  assert.equal(status.training.calibrationRows, 200);
  assert.equal(status.training.validationRows, 800);
  assert.equal(status.training.teacherSimulationsPerRow, 1200);
  assert.equal(status.treeCount, 264);
  assert.equal(status.headCount, 4);
  assert.equal(status.timeHead, "monotonic-quantile-gbdt");
  assert.equal(status.safetyHead, "monotonic-isotonic-v3");
  assert.equal(status.decisionPolicy.id, "chakchak-p1b-balanced-safety-v1");
  assert.deepEqual(status.decisionPolicy.weights, { safety: 0.55, destinationArrival: 0.2, avoidableWait: 0.15, accessibility: 0.1 });
  assert.equal(status.constraintPolicy.id, "chakchak-exact-journey-optimizer-v1");
  assert.equal(status.metrics.quantiles.p95.rows, 800);
  assert.ok(status.metrics.quantiles.p95.coverage >= 0.95);
  assert.ok(status.metrics.p90MaeMinutes < 7);
  assert.ok(status.metrics.simulatorProbabilityMse < 0.01);
  assert.equal(status.metrics.brierScore, undefined);
  assert.equal(status.metrics.segments.stress.validationRows, 200);
  assert.ok(status.metrics.segments.stress.p90MaeMinutes < 10);
  assert.equal(status.metrics.crossingRateBeforeOrdering, 0);
  assert.equal(status.metrics.monotonicAudit.violations, 0);
});

test("항공지연·날씨·입국 위험과 열차 여유에 대한 확률 단조성을 지킨다", () => {
  const random = mulberry32(0x20260804);
  for (let index = 0; index < 300; index += 1) {
    const input = {
      ...base,
      flightDelayMinutes: random() * 150,
      weatherSeverity: random() * 1.5,
      immigrationSeverity: random() * 1.5,
      baggageDelayMinutes: random() * 30,
      connectionWindowMinutes: 80 + random() * 180
    };
    const current = predictChakchakConnection(input);
    for (const increased of [
      predictChakchakConnection({ ...input, flightDelayMinutes: input.flightDelayMinutes + 20 }),
      predictChakchakConnection({ ...input, weatherSeverity: input.weatherSeverity + 0.4 }),
      predictChakchakConnection({ ...input, immigrationSeverity: input.immigrationSeverity + 0.4 })
    ]) {
      assert.ok(increased.boardingProbability <= current.boardingProbability);
      assert.ok(increased.platformArrivalMinutes.p50 >= current.platformArrivalMinutes.p50);
      assert.ok(increased.platformArrivalMinutes.p90 >= current.platformArrivalMinutes.p90);
    }
    assert.ok(predictChakchakConnection({ ...input, connectionWindowMinutes: input.connectionWindowMinutes + 20 }).boardingProbability >= current.boardingProbability);
  }
});

test("학습 범위를 벗어나면 1,200회 안전 엔진으로 자동 전환한다", () => {
  const journey = predictChakchakJourney({
    scheduledArrival: "2026-08-12T17:00:00+09:00",
    context: { ...base, flightDelayMinutes: 300, baggageDelayMinutes: 120 },
    candidates: [
      { id: "AREX-A", departureTime: "2026-08-12T19:00:00+09:00" },
      { id: "AREX-B", departureTime: "2026-08-12T20:00:00+09:00" },
      { id: "AREX-C", departureTime: "2026-08-12T21:00:00+09:00" }
    ]
  });
  assert.equal(journey.decision.fallbackRequired, true);
  assert.equal(journey.decision.source, "MONTE_CARLO_SAFETY_FALLBACK");
  assert.equal(journey.decision.simulationCount, 1200);
  assert.ok(journey.decision.oodReasons.some((reason) => reason.feature === "flightDelayMinutes"));
  assert.equal(journey.recommendation.selectedTrainId, journey.safetyFallback.recommendation.selectedTrainId);
});

test("P1 시간 모델은 복합 장기지연에서도 안전 엔진 P90을 10분 안에서 근사한다", () => {
  const input = {
    ...base,
    flightDelayMinutes: 210,
    weatherSeverity: 1.8,
    immigrationSeverity: 1.7,
    baggageDelayMinutes: 80,
    accessibilityNeeds: true,
    largeLuggage: true,
    connectionWindowMinutes: 330,
    boardingBufferMinutes: 15
  };
  const predicted = predictChakchakConnection(input);
  const scheduledArrival = "2026-08-12T17:00:00+09:00";
  const teacher = simulateConnection({
    scheduledArrival,
    trains: [{ id: "STRESS", departureTime: "2026-08-12T22:30:00+09:00" }],
    seed: "p1-independent-stress",
    simulations: 1200,
    boardingBufferMinutes: input.boardingBufferMinutes,
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
  });
  const teacherP90 = teacher.platformArrival.minutesAfterScheduledArrival.p90;
  assert.ok(Math.abs(predicted.platformArrivalMinutes.p90 - teacherP90) < 10);
  assert.ok(predicted.platformArrivalMinutes.p90 >= predicted.platformArrivalMinutes.p50);
  assert.equal(predicted.inputCoverage.fallbackRequired, false);
});

test("항공지연·폭우가 커지면 자체 모델의 탑승 가능성이 낮아진다", () => {
  const normal = predictChakchakConnection(base);
  const disrupted = predictChakchakConnection({
    ...base,
    flightDelayMinutes: 70,
    weatherSeverity: 1.4,
    immigrationSeverity: 1.2
  });
  assert.ok(normal.boardingProbability > disrupted.boardingProbability);
  assert.ok(disrupted.platformArrivalMinutes.p90 > normal.platformArrivalMinutes.p90);
  assert.ok(disrupted.factorEffects.some((effect) => effect.id === "flight" && effect.effectPercentPoints < 0));
  assert.equal(disrupted.inputCoverage.liveRiskSignals, 3);
});

test("착착 모델은 위험한 첫 열차를 배제하고 안전한 적격 후보를 선택한다", () => {
  const journey = predictChakchakJourney({
    scheduledArrival: "2026-08-12T17:00:00+09:00",
    context: { ...base, flightDelayMinutes: 45, weatherSeverity: 1.1 },
    candidates: [
      { id: "AREX-A", departureTime: "2026-08-12T18:40:00+09:00" },
      { id: "AREX-B", departureTime: "2026-08-12T19:40:00+09:00" },
      { id: "AREX-C", departureTime: "2026-08-12T20:40:00+09:00" }
    ]
  });
  assert.equal(journey.recommendation.primaryTrainId, "AREX-A");
  assert.equal(journey.recommendation.switched, true);
  assert.notEqual(journey.recommendation.selectedTrainId, "AREX-A");
  const selected = journey.candidates.find((candidate) => candidate.id === journey.recommendation.selectedTrainId);
  assert.equal(selected.isSafe, true);
});

test("P1-B 확률 설명은 일곱 조건의 합이 현재 예측과 정확히 일치한다", () => {
  const prediction = predictChakchakConnection({
    ...base,
    flightDelayMinutes: 70,
    weatherSeverity: 1.4,
    immigrationSeverity: 1.2,
    baggageDelayMinutes: 25,
    connectionWindowMinutes: 190
  });
  const waterfall = prediction.probabilityWaterfall;
  assert.equal(waterfall.method, "exact-shapley-additive-waterfall");
  assert.equal(waterfall.contributions.length, 7);
  assert.equal(waterfall.reconstructedPercent, waterfall.predictedPercent);
  assert.equal(waterfall.residualPercentPoints, 0);
  assert.equal(
    Math.round((waterfall.baselinePercent + waterfall.contributions.reduce((sum, item) => sum + item.effectPercentPoints, 0)) * 10) / 10,
    waterfall.predictedPercent
  );
  assert.ok(waterfall.uncertaintyBand.halfWidthPercentPoints > 0);
  assert.match(waterfall.uncertaintyBand.disclaimer, /실측 신뢰구간이 아니라/);
});

test("P1-B는 안전 후보 중 목적지 도착과 불필요한 대기를 함께 최적화한다", () => {
  const journey = predictChakchakJourney({
    scheduledArrival: "2026-08-12T17:00:00+09:00",
    context: base,
    candidates: [
      { id: "TOO-EARLY", departureTime: "2026-08-12T18:20:00+09:00", destinationArrivalTime: "2026-08-12T20:20:00+09:00" },
      { id: "BALANCED", departureTime: "2026-08-12T20:00:00+09:00", destinationArrivalTime: "2026-08-12T22:00:00+09:00" },
      { id: "OVER-WAIT", departureTime: "2026-08-12T22:00:00+09:00", destinationArrivalTime: "2026-08-13T00:00:00+09:00" }
    ]
  });
  assert.equal(journey.schemaVersion, "1.2");
  assert.equal(journey.recommendation.selectedTrainId, "BALANCED");
  assert.equal(journey.decision.safetySimulationCount, 1200);
  assert.ok(journey.recommendation.selectedUtilityScore > 0);
  const selected = journey.candidates.find((candidate) => candidate.id === "BALANCED").decisionProfile;
  assert.equal(Object.keys(selected.components).length, 4);
  assert.equal(selected.eligible, true);
  assert.ok(selected.avoidableWaitMinutes < journey.candidates.find((candidate) => candidate.id === "OVER-WAIT").decisionProfile.avoidableWaitMinutes);
  assert.ok(journey.decision.reconciliation.summary.length > 20);
});

test("P1-B는 이동지원 위반 후보를 높은 확률이어도 제외한다", () => {
  const journey = predictChakchakJourney({
    scheduledArrival: "2026-08-12T17:00:00+09:00",
    context: { ...base, accessibilityNeeds: true },
    candidates: [
      { id: "NOT-ACCESSIBLE", departureTime: "2026-08-12T21:00:00+09:00", destinationArrivalTime: "2026-08-12T23:00:00+09:00", accessibilityReady: false },
      { id: "ACCESSIBLE", departureTime: "2026-08-12T22:00:00+09:00", destinationArrivalTime: "2026-08-13T00:00:00+09:00", accessibilityReady: true }
    ]
  });
  const rejected = journey.candidates.find((candidate) => candidate.id === "NOT-ACCESSIBLE").decisionProfile;
  assert.equal(rejected.accessibility.status, "VIOLATION");
  assert.equal(rejected.eligible, false);
  assert.ok(rejected.guardrailFailures.includes("ACCESSIBILITY_VIOLATION"));
  assert.equal(journey.recommendation.selectedTrainId, "ACCESSIBLE");
  assert.equal(journey.recommendation.accessibilityStatus, "CONFIRMED");
});

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
