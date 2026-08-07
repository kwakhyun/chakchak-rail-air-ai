import { predictMonotonicQuantileGbdt } from "../../src/monotonic-gbdt.js";

export function fitMonotonicQuantileGbdt(rows, {
  quantile: quantileLevel,
  target = (row) => row.observedMinutes,
  featureIds,
  constraints = {},
  baselineFeature = "expectedProcessMinutes",
  estimators = 96,
  learningRate = 0.06,
  thresholdCandidates = 18,
  minimumLeafRows = 48,
  minimumImprovement = 1e-7
}) {
  if (!Array.isArray(rows) || rows.length < minimumLeafRows * 2) {
    throw new RangeError("Monotonic Quantile GBDT 학습 표본이 부족합니다.");
  }
  const residualTargets = rows.map((row) => target(row) - Number(row.features[baselineFeature] || 0));
  const head = {
    type: "monotonic-quantile-gbdt",
    quantile: quantileLevel,
    baselineFeature,
    baseValue: round(quantile(residualTargets, quantileLevel), 8),
    learningRate,
    estimators,
    minimumLeafRows,
    featureIds,
    constraints,
    trees: [],
    safetyOffsetMinutes: 0
  };
  let predictions = rows.map((row) => Number(row.features[baselineFeature] || 0) + head.baseValue);
  let currentLoss = mean(rows.map((row, index) => pinballLoss(target(row), predictions[index], quantileLevel)));

  for (let iteration = 0; iteration < estimators; iteration += 1) {
    let best = null;
    for (const feature of featureIds) {
      const thresholds = candidateThresholds(rows.map((row) => Number(row.features[feature])), thresholdCandidates);
      for (const threshold of thresholds) {
        const left = [];
        const right = [];
        for (let index = 0; index < rows.length; index += 1) {
          const residual = target(rows[index]) - predictions[index];
          if (Number(rows[index].features[feature]) <= threshold) left.push(residual);
          else right.push(residual);
        }
        if (left.length < minimumLeafRows || right.length < minimumLeafRows) continue;
        let leftValue = quantile(left, quantileLevel);
        let rightValue = quantile(right, quantileLevel);
        const direction = Number(constraints[feature] || 0);
        if ((direction > 0 && leftValue > rightValue) || (direction < 0 && leftValue < rightValue)) {
          const pooled = quantile([...left, ...right], quantileLevel);
          leftValue = pooled;
          rightValue = pooled;
        }
        const nextLoss = mean(rows.map((row, index) => {
          const leaf = Number(row.features[feature]) <= threshold ? leftValue : rightValue;
          return pinballLoss(target(row), predictions[index] + learningRate * leaf, quantileLevel);
        }));
        const improvement = currentLoss - nextLoss;
        if (!best || improvement > best.improvement) {
          best = { feature, threshold, leftValue, rightValue, nextLoss, improvement, leftRows: left.length, rightRows: right.length };
        }
      }
    }
    if (!best || best.improvement < minimumImprovement) break;
    head.trees.push({
      feature: best.feature,
      threshold: round(best.threshold, 8),
      leftValue: round(best.leftValue, 8),
      rightValue: round(best.rightValue, 8),
      leftRows: best.leftRows,
      rightRows: best.rightRows,
      improvement: round(best.improvement, 10)
    });
    predictions = rows.map((row) => predictMonotonicQuantileGbdt(head, row.features));
    currentLoss = best.nextLoss;
  }

  return {
    ...head,
    estimators: head.trees.length,
    trainingPinballLoss: round(currentLoss, 6)
  };
}

export function evaluateQuantileHead(rows, head, {
  target = (row) => row.observedMinutes,
  reference = (row) => row.teacher?.[`p${Math.round(head.quantile * 100)}`]
} = {}) {
  const values = rows.map((row) => ({
    observed: target(row),
    reference: reference(row),
    predicted: predictMonotonicQuantileGbdt(head, row.features)
  }));
  return summarizeQuantilePredictions(values, head.quantile);
}

export function summarizeQuantilePredictions(values, quantileLevel) {
  const referenceValues = values.filter((item) => Number.isFinite(item.reference));
  return {
    quantile: quantileLevel,
    rows: values.length,
    pinballLoss: round(mean(values.map((item) => pinballLoss(item.observed, item.predicted, quantileLevel))), 4),
    observedMaeMinutes: round(mean(values.map((item) => Math.abs(item.observed - item.predicted))), 3),
    referenceMaeMinutes: referenceValues.length
      ? round(mean(referenceValues.map((item) => Math.abs(item.reference - item.predicted))), 3)
      : null,
    coverage: round(values.filter((item) => item.observed <= item.predicted).length / values.length, 4),
    meanPredictionMinutes: round(mean(values.map((item) => item.predicted)), 3)
  };
}

export function pinballLoss(observed, predicted, quantileLevel) {
  const error = observed - predicted;
  return error >= 0 ? quantileLevel * error : (quantileLevel - 1) * error;
}

export function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const ratio = position - lower;
  return sorted[lower] * (1 - ratio) + sorted[upper] * ratio;
}

function candidateThresholds(values, count) {
  const sorted = [...new Set(values.filter(Number.isFinite))].sort((left, right) => left - right);
  if (sorted.length < 2) return [];
  const thresholds = [];
  for (let index = 1; index <= count; index += 1) {
    const position = Math.floor(index / (count + 1) * (sorted.length - 1));
    const next = Math.min(sorted.length - 1, position + 1);
    if (sorted[position] === sorted[next]) continue;
    thresholds.push((sorted[position] + sorted[next]) / 2);
  }
  return [...new Set(thresholds)];
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
