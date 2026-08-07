export function predictMonotonicQuantileGbdt(head, features) {
  if (!head || head.type !== "monotonic-quantile-gbdt") {
    throw new TypeError("monotonic-quantile-gbdt 헤드가 필요합니다.");
  }
  const baseline = head.baselineFeature ? Number(features[head.baselineFeature]) || 0 : 0;
  let prediction = baseline + Number(head.baseValue || 0);
  for (const tree of head.trees || []) {
    const value = Number(features[tree.feature]);
    const leafValue = value <= tree.threshold ? tree.leftValue : tree.rightValue;
    prediction += Number(head.learningRate || 0.05) * leafValue;
  }
  return prediction + Number(head.safetyOffsetMinutes || 0);
}

export function predictGbdtTreeContributions(head, features) {
  const contributions = new Map();
  for (const tree of head?.trees || []) {
    const value = Number(features[tree.feature]);
    const leafValue = value <= tree.threshold ? tree.leftValue : tree.rightValue;
    const contribution = Number(head.learningRate || 0.05) * leafValue;
    contributions.set(tree.feature, (contributions.get(tree.feature) || 0) + contribution);
  }
  return Object.fromEntries([...contributions.entries()].map(([feature, value]) => [feature, round(value, 4)]));
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
