import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chakchakConnectionModel } from "../src/chakchak-model-data.js";
import { predictMonotonicQuantileGbdt } from "../src/monotonic-gbdt.js";
import { pinballLoss } from "./lib/monotonic-quantile-gbdt.mjs";

const DATASET_FILE = resolve("output/model/chakchak-simulation-v3.json");
const OUTPUT_FILE = resolve("output/audit/chakchak-model-v2-comparison.json");
const MARKDOWN_FILE = resolve("output/audit/chakchak-model-v2-comparison.md");
const dataset = JSON.parse(await readFile(DATASET_FILE, "utf8"));
const trainingRows = dataset.trainingRows;
const validationBySegment = dataset.validationBySegment;
const validationRows = Object.values(validationBySegment).flat();
const quantiles = [0.5, 0.9, 0.95];

const isotonicHeads = Object.fromEntries(quantiles.map((q) => [quantileId(q), fitCurrentIsotonic(trainingRows, q)]));
const methods = {
  domainNormalBaseline: {
    label: "단순 시간·정규근사",
    predict(row, q) {
      const z = q === 0.5 ? 0 : q === 0.9 ? 1.2816 : 1.6449;
      const legacy = legacyFeatureVector(row.input);
      return legacy.expectedProcessMinutes + z * legacy.uncertaintyMinutes;
    }
  },
  monteCarloReference: {
    label: "Monte Carlo 참고분포",
    predict(row, q) { return row.teacher[quantileId(q)]; }
  },
  currentIsotonic: {
    label: "현재 단조 보정",
    predict(row, q) {
      const head = isotonicHeads[quantileId(q)];
      const legacy = legacyFeatureVector(row.input);
      return legacy.expectedProcessMinutes + interpolateKnots(head.knots, legacy.uncertaintyMinutes);
    }
  },
  monotonicQuantileGbdt: {
    label: "신규 Monotonic Quantile GBDT",
    predict(row, q) {
      return predictMonotonicQuantileGbdt(chakchakConnectionModel.heads[`${quantileId(q)}Minutes`], row.features);
    }
  }
};

const overall = evaluateRows(validationRows);
const segments = Object.fromEntries(Object.entries(validationBySegment).map(([segment, rows]) => [segment, evaluateRows(rows)]));
const calibration = Object.fromEntries(Object.entries(methods).map(([id, method]) => [id, Object.fromEntries(
  quantiles.map((q) => [quantileId(q), coverageBins(validationRows, method, q)])
)]));
const comparison = buildComparison(overall);
const report = {
  schemaVersion: "1.0",
  auditId: "chakchak-four-method-comparison-2026-08-06",
  generatedAt: new Date().toISOString(),
  data: {
    datasetVersion: dataset.version,
    methodology: dataset.methodology,
    trainingRows: trainingRows.length,
    validationRows: validationRows.length,
    segments: Object.fromEntries(Object.entries(validationBySegment).map(([segment, rows]) => [segment, rows.length])),
    teacherSimulationsPerRow: dataset.teacherSimulationsPerRow,
    realWorldLabels: 0
  },
  metricDefinitions: {
    pinballLoss: "독립 시뮬레이션 관측 1건에 대한 분위수 손실(낮을수록 좋음)",
    observedMaeMinutes: "독립 시뮬레이션 관측과 예측의 절대 차이(분)",
    referenceMaeMinutes: "1,200회 Monte Carlo 참고 분위수와 예측 분위수의 절대 차이(분)",
    coverage: "독립 관측이 예측 분위수 이하에 포함된 비율"
  },
  overall,
  segments,
  calibration,
  comparison,
  caveat: "모든 수치는 터미널·시간대를 포함한 시뮬레이션 비교이며 실제 승객 운영 성능이 아닙니다."
};

await writeFile(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(MARKDOWN_FILE, renderMarkdown(report), "utf8");
console.log(JSON.stringify({ data: report.data, comparison, overall }, null, 2));
console.log(`비교 감사 저장: ${OUTPUT_FILE}`);

function evaluateRows(rows) {
  return Object.fromEntries(Object.entries(methods).map(([methodId, method]) => [methodId, {
    label: method.label,
    quantiles: Object.fromEntries(quantiles.map((q) => [quantileId(q), summarize(rows, method, q)])),
    monotonicCrossingRate: crossingRate(rows, method)
  }]));
}

function summarize(rows, method, q) {
  const predictions = rows.map((row) => ({
    observed: row.observedMinutes,
    reference: row.teacher[quantileId(q)],
    predicted: method.predict(row, q)
  }));
  return {
    rows: rows.length,
    pinballLoss: round(mean(predictions.map((item) => pinballLoss(item.observed, item.predicted, q))), 4),
    observedMaeMinutes: round(mean(predictions.map((item) => Math.abs(item.observed - item.predicted))), 3),
    referenceMaeMinutes: round(mean(predictions.map((item) => Math.abs(item.reference - item.predicted))), 3),
    coverage: round(predictions.filter((item) => item.observed <= item.predicted).length / rows.length, 4),
    coverageGap: round(Math.abs(predictions.filter((item) => item.observed <= item.predicted).length / rows.length - q), 4)
  };
}

function crossingRate(rows, method) {
  const crossings = rows.filter((row) => {
    const p50 = method.predict(row, 0.5);
    const p90 = method.predict(row, 0.9);
    const p95 = method.predict(row, 0.95);
    return p50 > p90 || p90 > p95;
  }).length;
  return round(crossings / rows.length, 4);
}

function coverageBins(rows, method, q) {
  const bins = new Map();
  for (const row of rows) {
    const terminal = row.input.terminal;
    const hourGroup = row.features.timePeakSeverity >= 0.7 ? "PEAK" : "OFF_PEAK";
    const key = `${terminal}_${hourGroup}`;
    const current = bins.get(key) || { terminal, hourGroup, rows: 0, covered: 0 };
    current.rows += 1;
    current.covered += Number(row.observedMinutes <= method.predict(row, q));
    bins.set(key, current);
  }
  return [...bins.values()].map((bin) => ({ ...bin, coverage: round(bin.covered / bin.rows, 4), target: q }));
}

function buildComparison(results) {
  const baseline = results.domainNormalBaseline.quantiles;
  const current = results.currentIsotonic.quantiles;
  const gbdt = results.monotonicQuantileGbdt.quantiles;
  return Object.fromEntries(quantiles.map((q) => {
    const id = quantileId(q);
    return [id, {
      gbdtPinballVsBaselineImprovement: improvement(baseline[id].pinballLoss, gbdt[id].pinballLoss),
      gbdtPinballVsCurrentImprovement: improvement(current[id].pinballLoss, gbdt[id].pinballLoss),
      gbdtReferenceMaeVsBaselineImprovement: improvement(baseline[id].referenceMaeMinutes, gbdt[id].referenceMaeMinutes),
      gbdtReferenceMaeVsCurrentImprovement: improvement(current[id].referenceMaeMinutes, gbdt[id].referenceMaeMinutes),
      gbdtCoverage: gbdt[id].coverage,
      targetCoverage: q
    }];
  }));
}

function fitCurrentIsotonic(rows, q) {
  const points = rows.map((row) => ({
    x: legacyFeatureVector(row.input).uncertaintyMinutes,
    y: row.teacher[quantileId(q)] - legacyFeatureVector(row.input).expectedProcessMinutes
  }));
  return { quantile: q, knots: fitIsotonicKnots(points) };
}

function legacyFeatureVector(input) {
  const flightDelayMinutes = Number(input.flightDelayMinutes);
  const weatherSeverity = Number(input.weatherSeverity);
  const immigrationSeverity = Number(input.immigrationSeverity);
  const baggageDelayMinutes = Number(input.baggageDelayMinutes);
  const checkedBaggage = Number(Boolean(input.checkedBaggage));
  const accessibilityNeeds = Number(Boolean(input.accessibilityNeeds));
  const largeLuggage = Number(Boolean(input.largeLuggage));
  const expectedProcessMinutes =
    flightDelayMinutes + weatherSeverity * 9 +
    14 + accessibilityNeeds * 7 + largeLuggage * 2 +
    22 + immigrationSeverity * 23 + weatherSeverity * 2 +
    (checkedBaggage ? 18 + baggageDelayMinutes + largeLuggage * 7 + weatherSeverity * 3 : 0) +
    11 + weatherSeverity * 3 + accessibilityNeeds * 8 + largeLuggage * 5 +
    7 + weatherSeverity * 2 + accessibilityNeeds * 5 + largeLuggage * 3;
  const flightStandardDeviation = 7 + weatherSeverity * 7 + Math.min(flightDelayMinutes * 0.12, 15);
  const deplaningMean = 14 + accessibilityNeeds * 7 + largeLuggage * 2;
  const immigrationMean = 22 + immigrationSeverity * 23 + weatherSeverity * 2;
  const baggageMean = checkedBaggage ? 18 + baggageDelayMinutes + largeLuggage * 7 + weatherSeverity * 3 : 0;
  const movementMean = 11 + weatherSeverity * 3 + accessibilityNeeds * 8 + largeLuggage * 5;
  const platformMean = 7 + weatherSeverity * 2 + accessibilityNeeds * 5 + largeLuggage * 3;
  const uncertaintyMinutes = Math.sqrt(
    flightStandardDeviation ** 2 +
    (deplaningMean * 0.3) ** 2 +
    (immigrationMean * 0.48) ** 2 +
    (baggageMean * 0.46) ** 2 +
    (movementMean * 0.3) ** 2 +
    (platformMean * 0.28) ** 2
  );
  return { expectedProcessMinutes, uncertaintyMinutes };
}

function fitIsotonicKnots(points) {
  const sorted = [...points].sort((left, right) => left.x - right.x);
  const blocks = [];
  for (const point of sorted) {
    blocks.push({ sumX: point.x, sumY: point.y, count: 1, value: point.y });
    while (blocks.length > 1 && blocks.at(-2).value >= blocks.at(-1).value) {
      const right = blocks.pop();
      const left = blocks.pop();
      const merged = { sumX: left.sumX + right.sumX, sumY: left.sumY + right.sumY, count: left.count + right.count };
      merged.value = merged.sumY / merged.count;
      blocks.push(merged);
    }
  }
  return blocks.map((block) => ({ x: block.sumX / block.count, value: block.value }));
}

function interpolateKnots(knots, value) {
  if (value <= knots[0].x) return knots[0].value;
  if (value >= knots.at(-1).x) return knots.at(-1).value;
  let low = 0;
  let high = knots.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (knots[middle].x <= value) low = middle;
    else high = middle;
  }
  const left = knots[low];
  const right = knots[high];
  return left.value + (value - left.x) / Math.max(1e-9, right.x - left.x) * (right.value - left.value);
}

function renderMarkdown(report) {
  const rows = Object.entries(report.overall).map(([id, method]) => {
    const q = method.quantiles;
    return `| ${method.label} | ${q.p50.pinballLoss} | ${q.p90.pinballLoss} | ${q.p95.pinballLoss} | ${q.p50.referenceMaeMinutes} | ${q.p90.referenceMaeMinutes} | ${q.p95.referenceMaeMinutes} | ${(q.p90.coverage * 100).toFixed(1)}% | ${(q.p95.coverage * 100).toFixed(1)}% |`;
  }).join("\n");
  return `# 착착 네 가지 시간 예측 방법 비교\n\n- 고정 검증: ${report.data.validationRows}개 상황, 구간별 ${Object.values(report.data.segments).join("·")}개\n- 참고 분포: 상황당 Monte Carlo ${report.data.teacherSimulationsPerRow.toLocaleString("ko-KR")}회\n- 실제 승객 라벨: 0건\n\n| 방법 | P50 pinball | P90 pinball | P95 pinball | P50 참고 MAE | P90 참고 MAE | P95 참고 MAE | P90 포함률 | P95 포함률 |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${rows}\n\n> ${report.caveat}\n`;
}

function quantileId(q) { return `p${Math.round(q * 100)}`; }
function improvement(before, after) { return round((before - after) / Math.max(1e-9, before), 4); }
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function round(value, digits) { const scale = 10 ** digits; return Math.round(value * scale) / scale; }
