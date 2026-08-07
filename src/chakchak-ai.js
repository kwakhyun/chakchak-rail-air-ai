import { assessChakchakInputCoverage, buildChakchakFeatureVector } from "./chakchak-features.js";
import { chakchakConnectionModel } from "./chakchak-model-data.js";
import { simulateConnection } from "./engine.js";
import { predictMonotonicQuantileGbdt } from "./monotonic-gbdt.js";
import { CHAKCHAK_CONSTRAINT_POLICY, optimizeConstrainedJourney } from "./journey-optimizer.js";

const MINUTE_MS = 60_000;
const SAFE_PROBABILITY = 0.85;

export const CHAKCHAK_DECISION_POLICY = Object.freeze({
  id: "chakchak-p1b-balanced-safety-v1",
  version: "1.0",
  safeProbability: SAFE_PROBABILITY,
  weights: Object.freeze({ safety: 0.55, destinationArrival: 0.2, avoidableWait: 0.15, accessibility: 0.1 }),
  normalization: Object.freeze({ destinationDelayMinutes: 180, avoidableWaitMinutes: 180, p90MarginRange: [-10, 30] }),
  hardGuardrails: Object.freeze(["MODEL_AND_ENGINE_SAFE", "NO_KNOWN_ACCESSIBILITY_VIOLATION"])
});

const factorDefinitions = Object.freeze([
  { id: "flight", label: "항공 도착 지연", fields: ["flightDelayMinutes"], neutral: { flightDelayMinutes: 0 } },
  { id: "immigration", label: "입국장 혼잡", fields: ["immigrationSeverity"], neutral: { immigrationSeverity: 0 } },
  { id: "weather", label: "공항 날씨", fields: ["weatherSeverity"], neutral: { weatherSeverity: 0 } },
  { id: "baggage", label: "수하물 조건", fields: ["checkedBaggage", "baggageDelayMinutes"], neutral: { checkedBaggage: false, baggageDelayMinutes: 0 } },
  { id: "mobility", label: "이동 지원·큰 짐", fields: ["accessibilityNeeds", "largeLuggage"], neutral: { accessibilityNeeds: false, largeLuggage: false } },
  { id: "airport", label: "터미널·도착 시간대", fields: ["terminal", "arrivalHourLocal"], neutral: { terminal: "T1", arrivalHourLocal: 12 } },
  { id: "schedule", label: "열차까지 남은 시간", fields: ["connectionWindowMinutes"], neutral: { connectionWindowMinutes: 150 } }
]);

export function chakchakModelStatus() {
  return {
    id: chakchakConnectionModel.id,
    name: chakchakConnectionModel.name,
    version: chakchakConnectionModel.version,
    modelType: chakchakConnectionModel.modelType,
    training: chakchakConnectionModel.training,
    metrics: chakchakConnectionModel.metrics,
    treeCount: Object.values(chakchakConnectionModel.heads).reduce((sum, head) => sum + (head.trees?.length || 0), 0),
    headCount: Object.keys(chakchakConnectionModel.heads).length,
    timeHead: chakchakConnectionModel.heads.p90Minutes.type,
    safetyHead: chakchakConnectionModel.heads.boardingProbability.type,
    decisionPolicy: CHAKCHAK_DECISION_POLICY,
    constraintPolicy: CHAKCHAK_CONSTRAINT_POLICY,
    disclaimer: chakchakConnectionModel.disclaimer
  };
}

export function predictChakchakConnection(input) {
  const distribution = assessChakchakInputCoverage(input);
  const features = buildChakchakFeatureVector(input);
  const rawP50 = predictHead(chakchakConnectionModel.heads.p50Minutes, features);
  const rawP90 = predictHead(chakchakConnectionModel.heads.p90Minutes, features);
  const rawP95 = predictHead(chakchakConnectionModel.heads.p95Minutes, features);
  const p50Minutes = round(clamp(rawP50, ...chakchakConnectionModel.bounds.p50Minutes), 1);
  const p90Minutes = round(Math.max(p50Minutes, clamp(rawP90, ...chakchakConnectionModel.bounds.p90Minutes)), 1);
  const p95Minutes = round(Math.max(p90Minutes, clamp(rawP95, ...chakchakConnectionModel.bounds.p95Minutes)), 1);
  const p90BufferMinutes = round(features.connectionWindowMinutes - features.boardingBufferMinutes - p90Minutes, 1);
  const boardingProbability = round(clamp(
    predictHead(chakchakConnectionModel.heads.boardingProbability, { ...features, gbdtP90MarginMinutes: p90BufferMinutes }),
    ...chakchakConnectionModel.bounds.boardingProbability
  ), 4);
  const riskLevel = classifyRisk(boardingProbability, p90BufferMinutes);
  const probabilityWaterfall = explainProbabilityWaterfall(input, boardingProbability);

  return {
    modelId: chakchakConnectionModel.id,
    modelVersion: chakchakConnectionModel.version,
    trainingMode: "simulation-trained",
    boardingProbability,
    boardingProbabilityPercent: round(boardingProbability * 100, 1),
    platformArrivalMinutes: {
      p50: p50Minutes,
      p90: p90Minutes,
      p95: p95Minutes,
      p90SafetyOffsetMinutes: chakchakConnectionModel.heads.p90Minutes.safetyOffsetMinutes,
      p90CalibrationQuantile: chakchakConnectionModel.heads.p90Minutes.safetyCalibrationQuantile
    },
    p90BufferMinutes,
    riskLevel,
    isSafe: boardingProbability >= SAFE_PROBABILITY && p90BufferMinutes >= 0,
    factorEffects: probabilityWaterfall.contributions,
    probabilityWaterfall,
    inputCoverage: coverageState(input, distribution)
  };
}

export function predictChakchakJourney(input) {
  if (!input || !Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new TypeError("착착 AI 후보 열차가 필요합니다.");
  }
  if (input.candidates.length > 12) throw new RangeError("후보 열차는 최대 12개입니다.");
  const scheduledArrivalMs = parseDate(input.scheduledArrival, "scheduledArrival");
  const candidates = input.candidates
    .map((candidate) => {
      const departureMs = parseDate(candidate.departureTime ?? candidate.departure, "candidate.departureTime");
      const prediction = predictChakchakConnection({
        ...input.context,
        connectionWindowMinutes: (departureMs - scheduledArrivalMs) / MINUTE_MS
      });
      const destinationArrivalMs = candidate.destinationArrivalTime || candidate.destinationArrival
        ? parseDate(candidate.destinationArrivalTime ?? candidate.destinationArrival, "candidate.destinationArrivalTime")
        : departureMs;
      return {
        id: String(candidate.id),
        departureTime: new Date(departureMs).toISOString(),
        destinationArrivalTime: new Date(destinationArrivalMs).toISOString(),
        accessibilityReady: typeof candidate.accessibilityReady === "boolean" ? candidate.accessibilityReady : null,
        price: Number.isFinite(Number(candidate.price)) ? Number(candidate.price) : 0,
        transferCount: Number.isFinite(Number(candidate.transferCount)) ? Number(candidate.transferCount) : 1,
        reservationAvailable: typeof candidate.reservationAvailable === "boolean" ? candidate.reservationAvailable : null,
        ...prediction
      };
    })
    .sort((left, right) => Date.parse(left.departureTime) - Date.parse(right.departureTime));
  const fallbackRequired = candidates.some((candidate) => candidate.inputCoverage.fallbackRequired);
  const safetyEvaluation = runSafetyEvaluation(input);
  const engineByTrainId = new Map(safetyEvaluation.candidates.map((candidate) => [candidate.id, candidate]));
  const scoringContext = decisionScoringContext(candidates, Boolean(input.context?.accessibilityNeeds));
  const modelProfiles = candidates.map((candidate) => scoreDecisionCandidate(
    candidate,
    { probability: candidate.boardingProbability, p90BufferMinutes: candidate.p90BufferMinutes },
    scoringContext,
    "MODEL"
  ));
  const engineProfiles = candidates.map((candidate) => {
    const engine = engineByTrainId.get(candidate.id);
    return scoreDecisionCandidate(
      candidate,
      { probability: engine?.boardingProbability ?? 0, p90BufferMinutes: engine?.bufferMinutes?.p90 ?? -720 },
      scoringContext,
      "SAFETY_ENGINE"
    );
  });
  const fusedProfiles = candidates.map((candidate) => {
    const engine = engineByTrainId.get(candidate.id);
    const probability = fallbackRequired
      ? engine?.boardingProbability ?? 0
      : Math.min(candidate.boardingProbability, engine?.boardingProbability ?? 0);
    const p90BufferMinutes = fallbackRequired
      ? engine?.bufferMinutes?.p90 ?? -720
      : Math.min(candidate.p90BufferMinutes, engine?.bufferMinutes?.p90 ?? -720);
    return scoreDecisionCandidate(
      candidate,
      { probability, p90BufferMinutes },
      scoringContext,
      fallbackRequired ? "SAFETY_ENGINE_FALLBACK" : "CONSERVATIVE_FUSION"
    );
  });
  const modelSelected = selectDecisionCandidate(modelProfiles);
  const engineSelected = selectDecisionCandidate(engineProfiles);
  const fusedSafetySelected = selectDecisionCandidate(fusedProfiles);
  safetyEvaluation.engineRecommendation = safetyEvaluation.recommendation;
  safetyEvaluation.recommendation = {
    ...safetyEvaluation.recommendation,
    action: engineSelected.id === candidates[0].id ? "KEEP_PRIMARY" : engineSelected.eligible ? "SWITCH_TO_BALANCED_TRAIN" : "REPLAN_ROUTE",
    primaryTrainId: candidates[0].id,
    selectedTrainId: engineSelected.id,
    switched: engineSelected.id !== candidates[0].id,
    noSafeCandidate: !engineSelected.eligible,
    utilityScore: engineSelected.utilityScore,
    policyId: CHAKCHAK_DECISION_POLICY.id
  };
  const candidatesWithDecision = candidates.map((candidate) => ({
    ...candidate,
    decisionProfile: fusedProfiles.find((profile) => profile.id === candidate.id)
  }));
  const optimization = optimizeConstrainedJourney({
    candidates: candidatesWithDecision,
    preferences: input.preferences || {},
    activities: input.activities || input.tourismPlan?.activities || []
  });
  const fusedSelected = fusedProfiles.find((profile) => profile.id === optimization.selectedCandidateId) || fusedSafetySelected;
  const selected = candidatesWithDecision.find((candidate) => candidate.id === fusedSelected.id);
  if (fallbackRequired) {
    safetyEvaluation.recommendation = {
      ...safetyEvaluation.recommendation,
      action: selected.id === candidatesWithDecision[0].id ? "KEEP_PRIMARY" : fusedSelected.eligible ? "SWITCH_TO_BALANCED_TRAIN" : "REPLAN_ROUTE",
      selectedTrainId: selected.id,
      switched: selected.id !== candidatesWithDecision[0].id,
      noSafeCandidate: !optimization.feasible,
      policyId: CHAKCHAK_CONSTRAINT_POLICY.id
    };
  }
  const reconciliation = explainDecisionReconciliation({
    candidates: candidatesWithDecision,
    modelProfiles,
    engineProfiles,
    modelSelected,
    engineSelected,
    fusedSelected,
    fallbackRequired
  });
  const oodReasons = uniqueReasons(candidates.flatMap((candidate) => candidate.inputCoverage.reasons));
  return {
    schemaVersion: "1.2",
    model: chakchakModelStatus(),
    candidates: candidatesWithDecision,
    decision: {
      source: fallbackRequired ? "MONTE_CARLO_SAFETY_FALLBACK" : "CHAKCHAK_CONSTRAINT_OPTIMIZER",
      fallbackRequired,
      reason: fallbackRequired
        ? "학습 확인 범위를 벗어난 입력이 있어 1,200회 안전 시뮬레이션으로 전환했습니다."
        : reconciliation.summary,
      policy: CHAKCHAK_DECISION_POLICY,
      optimizationPolicy: optimization.policy,
      reconciliation,
      oodScore: Math.max(...candidates.map((candidate) => candidate.inputCoverage.oodScore)),
      oodReasons,
      simulationCount: fallbackRequired ? safetyEvaluation.simulationCount : null,
      safetySimulationCount: safetyEvaluation.simulationCount
    },
    safetyEvaluation,
    safetyFallback: fallbackRequired ? safetyEvaluation : null,
    optimization,
    recommendation: {
      primaryTrainId: candidatesWithDecision[0].id,
      selectedTrainId: selected.id,
      switched: selected.id !== candidatesWithDecision[0].id,
      noSafeCandidate: !optimization.feasible,
      safetyThreshold: SAFE_PROBABILITY,
      decisionSource: fallbackRequired ? "MONTE_CARLO_SAFETY_FALLBACK" : "CHAKCHAK_CONSTRAINT_OPTIMIZER",
      modelSelectedTrainId: modelSelected.id,
      engineSelectedTrainId: engineSelected.id,
      selectedUtilityScore: fusedSelected.utilityScore,
      selectedDecisionCost: fusedSelected.decisionCost,
      optimizationExplanation: optimization.explanation,
      accessibilityStatus: fusedSelected.accessibility.status,
      tradeoffSummary: reconciliation.summary,
      reasonCodes: reconciliation.reasonCodes
    }
  };
}

function runSafetyEvaluation(input) {
  const context = input.context || {};
  const result = simulateConnection({
    scheduledArrival: input.scheduledArrival,
    trains: input.candidates.map((candidate) => ({
      id: String(candidate.id),
      departureTime: candidate.departureTime ?? candidate.departure
    })),
    seed: `chakchak-ood-${input.scheduledArrival}-${context.flightDelayMinutes}-${context.weatherSeverity}-${context.immigrationSeverity}`,
    simulations: 1200,
    boardingBufferMinutes: context.boardingBufferMinutes ?? 5,
    safeProbability: SAFE_PROBABILITY,
    scenarios: {
      flightDelayMinutes: context.flightDelayMinutes,
      heavyRain: context.weatherSeverity,
      immigrationCongestion: context.immigrationSeverity,
      baggageDelayMinutes: context.baggageDelayMinutes
    },
    traveler: {
      checkedBaggage: Boolean(context.checkedBaggage),
      accessibilityNeeds: Boolean(context.accessibilityNeeds),
      largeLuggage: Boolean(context.largeLuggage)
    },
    terminal: context.terminal,
    arrivalHourLocal: context.arrivalHourLocal
  });
  return {
    source: "착착 1,200회 Monte Carlo 안전 엔진",
    simulationCount: result.simulationCount,
    platformArrival: result.platformArrival,
    candidates: result.candidates,
    recommendation: result.recommendation
  };
}

function decisionScoringContext(candidates, accessibilityNeeds) {
  return {
    accessibilityNeeds,
    earliestDepartureMs: Math.min(...candidates.map((candidate) => Date.parse(candidate.departureTime))),
    earliestDestinationArrivalMs: Math.min(...candidates.map((candidate) => Date.parse(candidate.destinationArrivalTime)))
  };
}

function scoreDecisionCandidate(candidate, safety, context, source) {
  const probability = clamp(Number(safety.probability) || 0, 0, 1);
  const p90BufferMinutes = Number.isFinite(Number(safety.p90BufferMinutes)) ? Number(safety.p90BufferMinutes) : -720;
  const destinationDelayMinutes = Math.max(0, (Date.parse(candidate.destinationArrivalTime) - context.earliestDestinationArrivalMs) / MINUTE_MS);
  const avoidableWaitMinutes = Math.max(0, (Date.parse(candidate.departureTime) - context.earliestDepartureMs) / MINUTE_MS);
  const accessibility = accessibilityDecisionState(context.accessibilityNeeds, candidate.accessibilityReady);
  const [p90Min, p90Max] = CHAKCHAK_DECISION_POLICY.normalization.p90MarginRange;
  const probabilityScore = probability * 100;
  const p90MarginScore = clamp((p90BufferMinutes - p90Min) / (p90Max - p90Min) * 100, 0, 100);
  const safetyScore = 0.8 * probabilityScore + 0.2 * p90MarginScore;
  const destinationArrivalScore = 100 - clamp(
    destinationDelayMinutes / CHAKCHAK_DECISION_POLICY.normalization.destinationDelayMinutes * 100,
    0,
    100
  );
  const avoidableWaitScore = 100 - clamp(
    avoidableWaitMinutes / CHAKCHAK_DECISION_POLICY.normalization.avoidableWaitMinutes * 100,
    0,
    100
  );
  const componentValues = {
    safety: safetyScore,
    destinationArrival: destinationArrivalScore,
    avoidableWait: avoidableWaitScore,
    accessibility: accessibility.score
  };
  const labels = {
    safety: "놓치지 않을 가능성",
    destinationArrival: "목적지 도착시간",
    avoidableWait: "불필요한 대기",
    accessibility: "이동지원 조건"
  };
  const components = Object.fromEntries(Object.entries(CHAKCHAK_DECISION_POLICY.weights).map(([id, weight]) => [id, {
    id,
    label: labels[id],
    score: round(componentValues[id], 1),
    weight,
    weightedScore: round(componentValues[id] * weight, 1)
  }]));
  const utilityScore = round(Object.values(components).reduce((sum, component) => sum + component.weightedScore, 0), 1);
  const isSafetyEligible = probability >= SAFE_PROBABILITY && p90BufferMinutes >= 0;
  const eligible = isSafetyEligible && !accessibility.violation;
  return {
    id: candidate.id,
    source,
    departureTime: candidate.departureTime,
    destinationArrivalTime: candidate.destinationArrivalTime,
    conservativeProbability: round(probability, 4),
    conservativeProbabilityPercent: round(probability * 100, 1),
    p90BufferMinutes: round(p90BufferMinutes, 1),
    destinationDelayMinutes: round(destinationDelayMinutes, 1),
    avoidableWaitMinutes: round(avoidableWaitMinutes, 1),
    accessibility,
    components,
    utilityScore,
    decisionCost: round(100 - utilityScore, 1),
    isSafetyEligible,
    eligible,
    guardrailFailures: [
      ...(probability < SAFE_PROBABILITY ? ["PROBABILITY_BELOW_85"] : []),
      ...(p90BufferMinutes < 0 ? ["NEGATIVE_P90_BUFFER"] : []),
      ...(accessibility.violation ? ["ACCESSIBILITY_VIOLATION"] : [])
    ]
  };
}

function accessibilityDecisionState(accessibilityNeeds, accessibilityReady) {
  if (!accessibilityNeeds) return { status: "NOT_REQUIRED", label: "별도 이동지원 불필요", score: 100, violation: false };
  if (accessibilityReady === true) return { status: "CONFIRMED", label: "이동지원 확인", score: 100, violation: false };
  if (accessibilityReady === false) return { status: "VIOLATION", label: "이동지원 조건 미충족", score: 0, violation: true };
  return { status: "NEEDS_CONFIRMATION", label: "이동지원 확인 필요", score: 60, violation: false };
}

function selectDecisionCandidate(profiles) {
  const eligible = profiles.filter((profile) => profile.eligible);
  const nonViolating = profiles.filter((profile) => !profile.accessibility.violation);
  const pool = eligible.length ? eligible : nonViolating.length ? nonViolating : profiles;
  return [...pool].sort((left, right) =>
    right.utilityScore - left.utilityScore ||
    Date.parse(left.destinationArrivalTime) - Date.parse(right.destinationArrivalTime) ||
    Date.parse(left.departureTime) - Date.parse(right.departureTime)
  )[0];
}

function explainDecisionReconciliation({ candidates, modelProfiles, engineProfiles, modelSelected, engineSelected, fusedSelected, fallbackRequired }) {
  const agreement = modelSelected.id === engineSelected.id;
  const reasonCodes = [];
  let status = "AGREE";
  let summary;
  if (fallbackRequired) {
    status = "OOD_ENGINE_ONLY";
    reasonCodes.push("OUT_OF_DISTRIBUTION", "SAFETY_ENGINE_AUTHORITY");
    summary = `확인 범위 밖 입력이라 안전 엔진 점수 ${fusedSelected.utilityScore}점인 ${fusedSelected.id}을 선택했습니다.`;
  } else if (agreement && fusedSelected.id === modelSelected.id) {
    reasonCodes.push("MODEL_ENGINE_AGREE", "MULTI_OBJECTIVE_BEST");
    summary = `착착 AI와 안전 엔진이 모두 ${fusedSelected.id}을 골랐고, 안전·도착·대기·이동지원 종합점수는 ${fusedSelected.utilityScore}점입니다.`;
  } else {
    const modelChoiceInEngine = engineProfiles.find((profile) => profile.id === modelSelected.id);
    const modelDeparture = Date.parse(modelSelected.departureTime);
    const engineDeparture = Date.parse(engineSelected.departureTime);
    status = modelDeparture < engineDeparture ? "MODEL_EARLIER" : modelDeparture > engineDeparture ? "ENGINE_EARLIER" : "DIFFERENT_TRADEOFF";
    if (!modelChoiceInEngine?.isSafetyEligible) reasonCodes.push("ENGINE_GUARDRAIL_REJECTED_MODEL_CHOICE");
    if (modelChoiceInEngine?.accessibility.violation) reasonCodes.push("ACCESSIBILITY_GUARDRAIL");
    reasonCodes.push("CONSERVATIVE_FUSION", "MULTI_OBJECTIVE_BEST");
    const guardrailCopy = !modelChoiceInEngine?.isSafetyEligible
      ? "모델 후보가 안전 엔진의 85%·P90 기준을 모두 통과하지 못해"
      : modelChoiceInEngine?.accessibility.violation
        ? "모델 후보가 이동지원 조건을 충족하지 못해"
        : "두 계산의 안전 범위와 대기비용을 함께 비교해";
    summary = `모델은 ${modelSelected.id}, 안전 엔진은 ${engineSelected.id}을 골랐습니다. ${guardrailCopy} 종합점수 ${fusedSelected.utilityScore}점인 ${fusedSelected.id}을 최종 선택했습니다.`;
  }
  const selectedCandidate = candidates.find((candidate) => candidate.id === fusedSelected.id);
  return {
    status,
    agreement,
    modelSelectedTrainId: modelSelected.id,
    engineSelectedTrainId: engineSelected.id,
    selectedTrainId: fusedSelected.id,
    reasonCodes,
    summary,
    selected: selectedCandidate ? {
      utilityScore: fusedSelected.utilityScore,
      decisionCost: fusedSelected.decisionCost,
      probabilityPercent: fusedSelected.conservativeProbabilityPercent,
      p90BufferMinutes: fusedSelected.p90BufferMinutes,
      destinationDelayMinutes: fusedSelected.destinationDelayMinutes,
      avoidableWaitMinutes: fusedSelected.avoidableWaitMinutes,
      accessibilityStatus: fusedSelected.accessibility.status
    } : null
  };
}

function explainProbabilityWaterfall(input, currentProbability) {
  const factorCount = factorDefinitions.length;
  const fullMask = (1 << factorCount) - 1;
  const neutralInput = factorDefinitions.reduce((result, factor) => ({ ...result, ...factor.neutral }), { ...input });
  const probabilityByMask = new Map();
  for (let mask = 0; mask <= fullMask; mask += 1) {
    const coalitionInput = { ...neutralInput };
    factorDefinitions.forEach((factor, index) => {
      if ((mask & (1 << index)) === 0) return;
      for (const field of factor.fields) coalitionInput[field] = input[field];
    });
    probabilityByMask.set(mask, predictBoardingProbability(coalitionInput));
  }

  const rawContributions = factorDefinitions.map((factor, factorIndex) => {
    let contribution = 0;
    for (let mask = 0; mask <= fullMask; mask += 1) {
      if ((mask & (1 << factorIndex)) !== 0) continue;
      const coalitionSize = countBits(mask);
      const weight = factorial(coalitionSize) * factorial(factorCount - coalitionSize - 1) / factorial(factorCount);
      contribution += weight * (probabilityByMask.get(mask | (1 << factorIndex)) - probabilityByMask.get(mask));
    }
    return { ...factor, rawEffectPercentPoints: contribution * 100 };
  }).sort((left, right) => Math.abs(right.rawEffectPercentPoints) - Math.abs(left.rawEffectPercentPoints));

  const baselinePercent = round(probabilityByMask.get(0) * 100, 1);
  const predictedPercent = round(currentProbability * 100, 1);
  const totalEffect = round(predictedPercent - baselinePercent, 1);
  const roundedEffects = rawContributions.map((effect) => round(effect.rawEffectPercentPoints, 1));
  const roundedBeforeLast = roundedEffects.slice(0, -1).reduce((sum, value) => sum + value, 0);
  roundedEffects[roundedEffects.length - 1] = round(totalEffect - roundedBeforeLast, 1);
  const validationHalfWidth = round(chakchakConnectionModel.metrics.probabilityMae * 100 * 1.645, 1);
  let runningPercent = baselinePercent;
  const contributions = rawContributions.map((factor, index) => {
    const effectPercentPoints = roundedEffects[index];
    const startPercent = round(runningPercent, 1);
    runningPercent = round(runningPercent + effectPercentPoints, 1);
    return {
      id: factor.id,
      label: factor.label,
      effectPercentPoints,
      startPercent,
      endPercent: runningPercent,
      lowerPercentPoints: round(effectPercentPoints - validationHalfWidth, 1),
      upperPercentPoints: round(effectPercentPoints + validationHalfWidth, 1),
      direction: effectPercentPoints < -0.05 ? "risk" : effectPercentPoints > 0.05 ? "help" : "neutral"
    };
  });
  const reconstructedPercent = round(baselinePercent + contributions.reduce((sum, item) => sum + item.effectPercentPoints, 0), 1);
  return {
    method: "exact-shapley-additive-waterfall",
    baselinePercent,
    predictedPercent,
    totalEffectPercentPoints: totalEffect,
    reconstructedPercent,
    residualPercentPoints: round(predictedPercent - reconstructedPercent, 1),
    contributions,
    uncertaintyBand: {
      method: "validation-mae-90pct-stability-band",
      confidenceLevel: 0.9,
      halfWidthPercentPoints: validationHalfWidth,
      disclaimer: "실측 신뢰구간이 아니라 분리검증 확률 MAE를 사용한 설명 안정성 범위입니다."
    }
  };
}

function predictBoardingProbability(input) {
  const features = buildChakchakFeatureVector(input);
  const p90Minutes = predictHead(chakchakConnectionModel.heads.p90Minutes, features);
  const p90MarginMinutes = features.connectionWindowMinutes - features.boardingBufferMinutes - p90Minutes;
  return clamp(
    predictHead(chakchakConnectionModel.heads.boardingProbability, { ...features, gbdtP90MarginMinutes: p90MarginMinutes }),
    ...chakchakConnectionModel.bounds.boardingProbability
  );
}

function factorial(value) {
  let result = 1;
  for (let index = 2; index <= value; index += 1) result *= index;
  return result;
}

function countBits(value) {
  let count = 0;
  for (let bits = value; bits; bits >>>= 1) count += bits & 1;
  return count;
}

function predictHead(head, features) {
  if (head.type === "monotonic-quantile-gbdt") {
    return predictMonotonicQuantileGbdt(head, features);
  }
  if (head.type === "robust-quantile-isotonic") {
    return features[head.baselineFeature] + interpolateKnots(head.knots, features[head.residualFeature]) + (head.safetyOffsetMinutes || 0);
  }
  if (head.type === "monotonic-isotonic-v2" || head.type === "monotonic-isotonic-v3") {
    return interpolateKnots(head.knots, features[head.feature]);
  }
  if (head.type === "monotonic-isotonic") {
    const value = features[head.feature];
    if (value <= head.blocks[0].max) return head.blocks[0].value;
    for (const block of head.blocks) if (value <= block.max) return block.value;
    return head.blocks.at(-1).value;
  }
  return head.trees.reduce((value, tree) => value + predictTree(tree, features), head.baseValue);
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
  if (right.x === left.x) return right.value;
  const ratio = (value - left.x) / (right.x - left.x);
  return left.value + ratio * (right.value - left.value);
}

function predictTree(tree, features) {
  if (tree.type === "leaf") return tree.value;
  return predictTree(features[tree.feature] <= tree.threshold ? tree.left : tree.right, features);
}

function coverageState(input, distribution) {
  const live = [input.flightMode, input.immigrationMode, input.weatherMode].filter((mode) => mode === "live").length;
  return {
    liveRiskSignals: live,
    totalRiskSignals: 3,
    travelerProfileApplied: true,
    isOutOfDistribution: distribution.isOutOfDistribution,
    fallbackRequired: distribution.fallbackRequired,
    oodScore: distribution.score,
    oodSeverity: distribution.severity,
    envelopeVersion: distribution.envelopeVersion,
    reasons: distribution.reasons
  };
}

function uniqueReasons(reasons) {
  const seen = new Set();
  return reasons.filter((reason) => {
    const key = `${reason.feature}:${reason.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classifyRisk(probability, p90BufferMinutes) {
  if (probability >= 0.9 && p90BufferMinutes >= 0) return "LOW";
  if (probability >= 0.75 && p90BufferMinutes >= -5) return "MEDIUM";
  if (probability >= 0.4) return "HIGH";
  return "CRITICAL";
}

function parseDate(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} 시각을 확인해 주세요.`);
  return parsed;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
