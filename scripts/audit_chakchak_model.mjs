import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { predictChakchakConnection, predictChakchakJourney } from "../src/chakchak-ai.js";
import { simulateConnection } from "../src/engine.js";

const MODEL_AUDIT_VERSION = "chakchak-independent-audit-2026-08-v2";
const ROWS_PER_SEGMENT = 100;
const DECISION_ROWS_PER_SEGMENT = 40;
const SIMULATIONS_PER_ROW = 1200;
const OUTPUT_FILE = resolve("output/audit/chakchak-model-v2-independent.json");
const segments = ["iid", "stress", "lowRisk", "accessibility"];

const resultsBySegment = {};
for (const [segmentIndex, segment] of segments.entries()) {
  const random = mulberry32(0x20261000 + segmentIndex);
  const rows = [];
  for (let index = 0; index < ROWS_PER_SEGMENT; index += 1) {
    const input = sampleInput(segment, random);
    const predicted = predictChakchakConnection(input);
    const teacher = simulateTeacher(input, `${MODEL_AUDIT_VERSION}-${segment}-${index}`);
    rows.push({
      p50Error: predicted.platformArrivalMinutes.p50 - teacher.p50,
      p90Error: predicted.platformArrivalMinutes.p90 - teacher.p90,
      p95Error: predicted.platformArrivalMinutes.p95 - teacher.p95,
      probabilityError: predicted.boardingProbability - teacher.probability,
      fallbackRequired: predicted.inputCoverage.fallbackRequired
    });
  }
  resultsBySegment[segment] = summarize(rows);
}

const monotonicAudit = auditMonotonicity();
const decisionAudit = auditDecisionPolicy();
const overall = summarize(Object.values(resultsBySegment).flatMap((segment) => segment.raw));
for (const segment of Object.values(resultsBySegment)) delete segment.raw;
delete overall.raw;

const report = {
  schemaVersion: "1.0",
  auditVersion: MODEL_AUDIT_VERSION,
  modelVersion: predictChakchakConnection(sampleInput("iid", mulberry32(1))).modelVersion,
  rows: ROWS_PER_SEGMENT * segments.length,
  rowsPerSegment: ROWS_PER_SEGMENT,
  simulationsPerRow: SIMULATIONS_PER_ROW,
  overall,
  segments: resultsBySegment,
  monotonicAudit,
  decisionAudit
};

const failures = [];
if (overall.p90MaeMinutes > 7) failures.push(`전체 P90 MAE ${overall.p90MaeMinutes}`);
if (overall.p95MaeMinutes > 10) failures.push(`전체 P95 MAE ${overall.p95MaeMinutes}`);
if (resultsBySegment.stress.p90MaeMinutes > 10) failures.push(`스트레스 P90 MAE ${resultsBySegment.stress.p90MaeMinutes}`);
if (overall.unexpectedFallbackRate > 0) failures.push(`범위 내 자동전환률 ${overall.unexpectedFallbackRate}`);
if (monotonicAudit.violations > 0) failures.push(`단조성 위반 ${monotonicAudit.violations}`);
if (decisionAudit.guardrailViolations > 0) failures.push(`의사결정 안전 가드레일 위반 ${decisionAudit.guardrailViolations}`);
if (decisionAudit.accessibilityViolations > 0) failures.push(`접근성 제약 위반 ${decisionAudit.accessibilityViolations}`);
if (decisionAudit.constraintOptimizerViolations > 0) failures.push(`제약 최적화기 선택 불일치 ${decisionAudit.constraintOptimizerViolations}`);
if (decisionAudit.waterfallResidualViolations > 0) failures.push(`워터폴 합계 위반 ${decisionAudit.waterfallResidualViolations}`);
if (failures.length) throw new Error(`독립 모델 감사 실패: ${failures.join(", ")}`);

await mkdir(dirname(OUTPUT_FILE), { recursive: true });
await writeFile(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
console.log(`독립 감사 저장: ${OUTPUT_FILE}`);

function simulateTeacher(input, seed) {
  const scheduledArrival = "2026-08-12T17:00:00+09:00";
  const departureTime = new Date(Date.parse(scheduledArrival) + input.connectionWindowMinutes * 60_000).toISOString();
  const result = simulateConnection({
    scheduledArrival,
    trains: [{ id: "AUDIT", departureTime }],
    seed,
    simulations: SIMULATIONS_PER_ROW,
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
    },
    terminal: input.terminal,
    arrivalHourLocal: input.arrivalHourLocal
  });
  return {
    p50: result.platformArrival.minutesAfterScheduledArrival.p50,
    p90: result.platformArrival.minutesAfterScheduledArrival.p90,
    p95: result.platformArrival.minutesAfterScheduledArrival.p95,
    probability: result.candidates[0].boardingProbability
  };
}

function summarize(rows) {
  return {
    p50MaeMinutes: round(mean(rows.map((row) => Math.abs(row.p50Error))), 3),
    p90MaeMinutes: round(mean(rows.map((row) => Math.abs(row.p90Error))), 3),
    p95MaeMinutes: round(mean(rows.map((row) => Math.abs(row.p95Error))), 3),
    p90UnderpredictionRate: round(rows.filter((row) => row.p90Error < 0).length / rows.length, 3),
    p90MeanSafetyBiasMinutes: round(mean(rows.map((row) => row.p90Error)), 3),
    probabilityMae: round(mean(rows.map((row) => Math.abs(row.probabilityError))), 4),
    unexpectedFallbackRate: round(rows.filter((row) => row.fallbackRequired).length / rows.length, 3),
    raw: rows
  };
}

function auditMonotonicity() {
  const random = mulberry32(0x20261014);
  let violations = 0;
  let comparisons = 0;
  for (let index = 0; index < 300; index += 1) {
    const input = sampleInput("iid", random);
    const current = predictChakchakConnection(input);
    for (const [feature, increment] of [["flightDelayMinutes", 10], ["weatherSeverity", 0.2], ["immigrationSeverity", 0.2]]) {
      const increased = predictChakchakConnection({ ...input, [feature]: input[feature] + increment });
      violations += Number(increased.platformArrivalMinutes.p50 < current.platformArrivalMinutes.p50);
      violations += Number(increased.platformArrivalMinutes.p90 < current.platformArrivalMinutes.p90);
      violations += Number(increased.platformArrivalMinutes.p95 < current.platformArrivalMinutes.p95);
      violations += Number(increased.boardingProbability > current.boardingProbability);
      comparisons += 4;
    }
    const later = predictChakchakConnection({ ...input, connectionWindowMinutes: input.connectionWindowMinutes + 20 });
    violations += Number(later.boardingProbability < current.boardingProbability);
    comparisons += 1;
  }
  return { comparisons, violations, violationRate: round(violations / comparisons, 6) };
}

function auditDecisionPolicy() {
  const rows = [];
  const scheduledArrival = "2026-08-12T17:00:00+09:00";
  for (const [segmentIndex, segment] of segments.entries()) {
    const random = mulberry32(0x20261100 + segmentIndex);
    for (let index = 0; index < DECISION_ROWS_PER_SEGMENT; index += 1) {
      const input = sampleInput(segment, random);
      const windows = [80, 140, 220, 320];
      const journey = predictChakchakJourney({
        scheduledArrival,
        context: input,
        candidates: windows.map((window, candidateIndex) => ({
          id: `${segment}-${index}-${candidateIndex}`,
          departureTime: new Date(Date.parse(scheduledArrival) + window * 60_000).toISOString(),
          destinationArrivalTime: new Date(Date.parse(scheduledArrival) + (window + 120) * 60_000).toISOString(),
          accessibilityReady: input.accessibilityNeeds ? candidateIndex > 0 : undefined
        }))
      });
      const selected = journey.candidates.find((candidate) => candidate.id === journey.recommendation.selectedTrainId);
      const eligible = journey.candidates.filter((candidate) => candidate.decisionProfile.eligible);
      const earliestEligibleWait = eligible.length ? Math.min(...eligible.map((candidate) => candidate.decisionProfile.avoidableWaitMinutes)) : null;
      rows.push({
        guardrailViolation: eligible.length > 0 && !selected.decisionProfile.eligible,
        accessibilityViolation: selected.decisionProfile.accessibility.violation,
        constraintOptimizerViolation: journey.recommendation.selectedTrainId !== journey.optimization.selectedCandidateId || (journey.optimization.feasible && !journey.optimization.selectedPlan.feasible),
        waterfallResidualViolation: journey.candidates.some((candidate) => candidate.probabilityWaterfall.residualPercentPoints !== 0),
        avoidableWaitRegretMinutes: earliestEligibleWait === null ? null : selected.decisionProfile.avoidableWaitMinutes - earliestEligibleWait,
        modelEngineDisagreement: !journey.decision.reconciliation.agreement,
        conservativeIntervention: journey.recommendation.modelSelectedTrainId !== journey.recommendation.selectedTrainId,
        noSafeCandidate: journey.recommendation.noSafeCandidate
      });
    }
  }
  const waitRegrets = rows.map((row) => row.avoidableWaitRegretMinutes).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    rows: rows.length,
    rowsPerSegment: DECISION_ROWS_PER_SEGMENT,
    guardrailViolations: rows.filter((row) => row.guardrailViolation).length,
    accessibilityViolations: rows.filter((row) => row.accessibilityViolation).length,
    constraintOptimizerViolations: rows.filter((row) => row.constraintOptimizerViolation).length,
    waterfallResidualViolations: rows.filter((row) => row.waterfallResidualViolation).length,
    modelEngineDisagreementRate: round(rows.filter((row) => row.modelEngineDisagreement).length / rows.length, 3),
    conservativeInterventionRate: round(rows.filter((row) => row.conservativeIntervention).length / rows.length, 3),
    noSafeCandidateRate: round(rows.filter((row) => row.noSafeCandidate).length / rows.length, 3),
    averageAvoidableWaitRegretMinutes: waitRegrets.length ? round(mean(waitRegrets), 2) : 0,
    p90AvoidableWaitRegretMinutes: waitRegrets.length ? round(waitRegrets[Math.floor((waitRegrets.length - 1) * 0.9)], 1) : 0
  };
}

function sampleInput(segment, random) {
  const checkedBaggage = random() < (segment === "stress" ? 0.84 : segment === "lowRisk" ? 0.55 : 0.74);
  if (segment === "stress") return buildInput(random, checkedBaggage, [90, 240], [0.75, 2], [0.7, 2], [20, 90], [35, 360], [0, 30], 0.28, 0.48);
  if (segment === "lowRisk") return buildInput(random, checkedBaggage, [0, 25], [0, 0.4], [0, 0.5], [0, 10], [100, 360], [3, 10], 0.08, 0.15);
  if (segment === "accessibility") return buildInput(random, checkedBaggage, [0, 210], [0, 2], [0, 2], [0, 65], [55, 330], [5, 20], 1, 0.62);
  return buildInput(random, checkedBaggage, [0, 205], [0, 2], [0, 2], [0, 55], [55, 330], [3, 15], 0.16, 0.28);
}

function buildInput(random, checkedBaggage, flight, weather, immigration, baggage, window, buffer, accessibilityRate, luggageRate) {
  return {
    flightDelayMinutes: between(random, flight),
    weatherSeverity: between(random, weather),
    immigrationSeverity: between(random, immigration),
    baggageDelayMinutes: checkedBaggage ? between(random, baggage) : 0,
    checkedBaggage,
    accessibilityNeeds: random() < accessibilityRate,
    largeLuggage: random() < luggageRate,
    terminal: random() < 0.55 ? "T2" : "T1",
    arrivalHourLocal: between(random, [0, 23.9]),
    connectionWindowMinutes: between(random, window),
    boardingBufferMinutes: between(random, buffer)
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

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
