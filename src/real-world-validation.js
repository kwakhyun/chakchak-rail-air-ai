const MINUTE_MS = 60_000;
const FUTURE_TOLERANCE_MS = 5 * MINUTE_MS;

export const P2_VALIDATION_PROTOCOL = Object.freeze({
  id: "chakchak-p2-consented-shadow-validation-v1",
  schemaVersion: "1.0",
  consentVersion: "2026-08-04",
  cohortSource: "CONSENTED_SHADOW_PILOT",
  grain: "익명 동의 여정 1건",
  storageTimeZone: "UTC",
  displayTimeZone: "Asia/Seoul",
  retentionDays: 30,
  metricsSuppressionThreshold: 30,
  directionalEvidenceThreshold: 100,
  operationalCandidateThreshold: 300,
  operationalMinimumPerCriticalSegment: 30,
  allowedEvents: Object.freeze(["PLATFORM_ARRIVED", "TRAIN_BOARDED", "TRAIN_MISSED", "PLAN_SELECTED"]),
  criticalSegments: Object.freeze(["standard", "accessibility", "disrupted"]),
  privacy: Object.freeze({
    stored: ["난수 여정 ID", "동의 버전", "모델·정책 버전", "비식별 이동조건", "예측", "사용자 현장 기록"],
    prohibited: ["성명", "휴대전화", "이메일", "주소", "예약번호", "항공편 번호", "IP 주소"]
  })
});

export const P2B_PILOT_PROTOCOL = Object.freeze({
  id: "chakchak-p2b-field-pilot-v1",
  cohortId: "chakchak-2026-rail-air-pilot",
  targetCompletedJourneys: 30,
  inviteValidityDays: 14,
  outcomeDueHours: 72,
  allowedPhases: Object.freeze(["READY", "ENROLLING", "PAUSED", "CLOSED"]),
  phaseLabels: Object.freeze({
    READY: "모집 준비",
    ENROLLING: "참여 접수 중",
    PAUSED: "접수 일시 중지",
    CLOSED: "접수 종료"
  }),
  consent: Object.freeze({
    essentialScope: "FIELD_VALIDATION",
    institutionMatchScope: "INSTITUTION_MATCH",
    essentialNotice: "착착의 예측 정확도를 검증하기 위해 비식별 이동조건, 모델 예측, 승강장 도착시각과 탑승 결과를 최대 30일 보관합니다. 성명, 연락처, 주소, 예약번호, 항공편 번호와 IP 주소는 저장하지 않으며 언제든 해당 여정 전체를 삭제할 수 있습니다.",
    institutionMatchNotice: "선택한 경우 현장에서 받은 익명 대조코드로 코레일·인천공항공사가 제공하는 승하차 확인자료와 연결할 수 있습니다. 기관 원장 자체는 착착 저장소에 복사하지 않으며 대조 전 별도 협약과 검토가 필요합니다."
  }),
  institutionExport: Object.freeze({
    schemaVersion: "1.0",
    grain: "기관 대조에 별도 동의한 익명 여정 1건",
    matchKey: "participantMatchCode"
  })
});

export function createP2PredictionSnapshot(input, prediction, plannedTrainId, recordedAt = new Date().toISOString()) {
  if (!input || !prediction?.recommendation || !Array.isArray(prediction.candidates)) {
    throw new TypeError("P2 예측 스냅샷 입력이 올바르지 않습니다.");
  }
  const plannedId = String(plannedTrainId || prediction.recommendation.selectedTrainId || "");
  const candidates = prediction.candidates.map((candidate) => ({
    id: String(candidate.id),
    departureTime: candidate.departureTime,
    destinationArrivalTime: candidate.destinationArrivalTime,
    modelProbability: finite(candidate.boardingProbability),
    fusedProbability: finite(candidate.decisionProfile?.conservativeProbability),
    platformP50Minutes: finite(candidate.platformArrivalMinutes?.p50),
    platformP90Minutes: finite(candidate.platformArrivalMinutes?.p90),
    p90BufferMinutes: finite(candidate.decisionProfile?.p90BufferMinutes),
    utilityScore: finite(candidate.decisionProfile?.utilityScore),
    eligible: Boolean(candidate.decisionProfile?.eligible),
    accessibilityStatus: String(candidate.decisionProfile?.accessibility?.status || "UNKNOWN")
  }));
  if (!candidates.some((candidate) => candidate.id === plannedId)) {
    throw new RangeError("선택한 열차가 예측 후보에 없습니다.");
  }
  const context = input.context || {};
  return {
    recordedAt: toIso(recordedAt),
    scheduledArrival: toIso(input.scheduledArrival),
    modelVersion: String(prediction.model?.version || "unknown"),
    policyId: String(prediction.decision?.policy?.id || "unknown"),
    decisionSource: String(prediction.decision?.source || "unknown"),
    policySelectedTrainId: String(prediction.recommendation.selectedTrainId),
    plannedTrainId: plannedId,
    context: {
      flightDelayMinutes: finite(context.flightDelayMinutes),
      weatherSeverity: finite(context.weatherSeverity),
      immigrationSeverity: finite(context.immigrationSeverity),
      baggageDelayMinutes: finite(context.baggageDelayMinutes),
      checkedBaggage: Boolean(context.checkedBaggage),
      accessibilityNeeds: Boolean(context.accessibilityNeeds),
      largeLuggage: Boolean(context.largeLuggage),
      boardingBufferMinutes: finite(context.boardingBufferMinutes),
      inputModes: {
        flight: safeMode(context.flightMode),
        immigration: safeMode(context.immigrationMode),
        weather: safeMode(context.weatherMode)
      }
    },
    candidates
  };
}

export function buildP2ValidationReport(records, options = {}) {
  const now = new Date(options.now || Date.now());
  const includeSuppressed = Boolean(options.includeSuppressed);
  const rows = Array.isArray(records) ? records : [];
  const issues = [];
  const seen = new Set();
  const valid = [];

  rows.forEach((record, index) => {
    const rowIssues = validateRecord(record, now, seen);
    if (rowIssues.length) {
      issues.push(...rowIssues.map((issue) => ({ ...issue, row: index + 1, journeyId: shortId(record?.journeyId) })));
      return;
    }
    seen.add(record.journeyId);
    valid.push(record);
  });

  const outcomeRows = valid.filter((record) => ["BOARDED", "MISSED"].includes(record.observations?.boardingOutcome));
  const platformRows = valid.filter((record) => isIso(record.observations?.platformArrivedAt));
  const segmentCounts = buildSegmentCounts(valid, outcomeRows);
  const criticalIssueCount = issues.filter((issue) => issue.severity === "CRITICAL" || issue.severity === "HIGH").length;
  const publishPerformance = outcomeRows.length >= P2_VALIDATION_PROTOCOL.metricsSuppressionThreshold && criticalIssueCount === 0;
  const metrics = publishPerformance || includeSuppressed
    ? calculateMetrics(outcomeRows, platformRows)
    : suppressedMetrics(outcomeRows.length, platformRows.length);
  const evidence = evidenceStage({
    enrolled: valid.length,
    completed: outcomeRows.length,
    segmentCounts,
    criticalIssueCount
  });

  return {
    protocol: P2_VALIDATION_PROTOCOL,
    generatedAt: now.toISOString(),
    realWorldPerformanceAvailable: publishPerformance,
    evidence,
    counts: {
      enrolled: valid.length,
      boardingOutcomes: outcomeRows.length,
      platformArrivals: platformRows.length,
      outcomeCompletionRate: rate(outcomeRows.length, valid.length),
      platformCompletionRate: rate(platformRows.length, valid.length)
    },
    segments: segmentCounts,
    metrics,
    quality: {
      status: criticalIssueCount > 0 ? "BLOCKED" : valid.length ? "PASS" : "WAITING_FOR_DATA",
      inputRows: rows.length,
      acceptedRows: valid.length,
      rejectedRows: rows.length - valid.length,
      criticalIssueCount,
      duplicateJourneyIds: issues.filter((issue) => issue.code === "DUPLICATE_JOURNEY_ID").length,
      futureTimestampRows: issues.filter((issue) => issue.code === "FUTURE_TIMESTAMP").length,
      invalidConsentRows: issues.filter((issue) => issue.code === "INVALID_CONSENT").length,
      invalidPredictionRows: issues.filter((issue) => issue.code === "INVALID_PREDICTION").length,
      issues: issues.slice(0, 20)
    },
    caveats: [
      "관찰자료이므로 착착 추천이 탑승 성공을 원인적으로 높였다고 해석할 수 없습니다.",
      "사용자가 직접 완료한 기록만 포함되어 선택편향과 미응답 편향이 남을 수 있습니다.",
      publishPerformance
        ? "최소 공개 표본 기준은 통과했지만 기관 데이터와의 대조 검증 전에는 운영 성능으로 확정하지 않습니다."
        : `완료 ${P2_VALIDATION_PROTOCOL.metricsSuppressionThreshold}건 전에는 실제 성능 수치를 공개하지 않습니다.`
    ]
  };
}

function validateRecord(record, now, seen) {
  const issues = [];
  if (!record || typeof record !== "object" || !record.journeyId) {
    return [{ code: "INVALID_RECORD", severity: "CRITICAL", message: "여정 식별자가 없습니다." }];
  }
  if (seen.has(record.journeyId)) {
    issues.push({ code: "DUPLICATE_JOURNEY_ID", severity: "CRITICAL", message: "동일 여정 ID가 중복되었습니다." });
  }
  if (record.schemaVersion !== P2_VALIDATION_PROTOCOL.schemaVersion) {
    issues.push({ code: "INVALID_SCHEMA_VERSION", severity: "CRITICAL", message: "지원하지 않는 실측 자료 스키마입니다." });
  }
  if (record.source !== P2_VALIDATION_PROTOCOL.cohortSource) {
    issues.push({ code: "INVALID_COHORT_SOURCE", severity: "CRITICAL", message: "사전 등록된 실측 코호트가 아닙니다." });
  }
  if (record.consent?.granted !== true || record.consent?.version !== P2_VALIDATION_PROTOCOL.consentVersion) {
    issues.push({ code: "INVALID_CONSENT", severity: "CRITICAL", message: "유효한 명시적 동의가 없습니다." });
  }
  const prediction = record.prediction;
  if (!prediction || !isIso(prediction.scheduledArrival) || !Array.isArray(prediction.candidates) || !prediction.candidates.length) {
    issues.push({ code: "INVALID_PREDICTION", severity: "CRITICAL", message: "잠금된 예측 스냅샷이 불완전합니다." });
  } else if (!prediction.candidates.some((candidate) => candidate.id === prediction.plannedTrainId)) {
    issues.push({ code: "INVALID_PREDICTION", severity: "CRITICAL", message: "실제 계획 열차가 예측 후보에 없습니다." });
  } else if (prediction.candidates.some((candidate) =>
    !isIso(candidate.departureTime) ||
    !Number.isFinite(candidate.modelProbability) ||
    candidate.modelProbability < 0 || candidate.modelProbability > 1 ||
    !Number.isFinite(candidate.fusedProbability) ||
    candidate.fusedProbability < 0 || candidate.fusedProbability > 1 ||
    !Number.isFinite(candidate.platformP50Minutes) ||
    !Number.isFinite(candidate.platformP90Minutes) ||
    candidate.platformP90Minutes < candidate.platformP50Minutes
  )) {
    issues.push({ code: "INVALID_PREDICTION", severity: "CRITICAL", message: "확률·열차시각·P50/P90 예측 범위가 올바르지 않습니다." });
  }
  if (!isIso(record.createdAt) || !isIso(record.updatedAt)) {
    issues.push({ code: "INVALID_TIMESTAMP", severity: "HIGH", message: "생성·갱신 시각이 없거나 ISO 시각 형식이 아닙니다." });
  }
  const timestamps = [record.createdAt, record.updatedAt, record.consent?.grantedAt, prediction?.recordedAt, record.observations?.platformArrivedAt, record.observations?.outcomeRecordedAt]
    .filter(Boolean);
  for (const value of timestamps) {
    if (!isIso(value)) {
      issues.push({ code: "INVALID_TIMESTAMP", severity: "HIGH", message: "ISO 시각 형식이 아닌 값이 있습니다." });
    } else if (Date.parse(value) > now.getTime() + FUTURE_TOLERANCE_MS) {
      issues.push({ code: "FUTURE_TIMESTAMP", severity: "HIGH", message: "서버 현재시각보다 미래인 관측값이 있습니다." });
    }
  }
  if (isIso(record.createdAt) && isIso(record.observations?.platformArrivedAt) && Date.parse(record.observations.platformArrivedAt) < Date.parse(record.createdAt)) {
    issues.push({ code: "EVENT_BEFORE_ENROLLMENT", severity: "HIGH", message: "승강장 관측이 동의·예측 잠금보다 빠릅니다." });
  }
  if (isIso(record.createdAt) && isIso(record.observations?.outcomeRecordedAt) && Date.parse(record.observations.outcomeRecordedAt) < Date.parse(record.createdAt)) {
    issues.push({ code: "EVENT_BEFORE_ENROLLMENT", severity: "HIGH", message: "탑승 결과가 동의·예측 잠금보다 빠릅니다." });
  }
  if (isIso(record.observations?.platformArrivedAt) && isIso(record.observations?.outcomeRecordedAt) && Date.parse(record.observations.platformArrivedAt) > Date.parse(record.observations.outcomeRecordedAt)) {
    issues.push({ code: "EVENT_ORDER_VIOLATION", severity: "HIGH", message: "승강장 도착 기록이 탑승 결과보다 늦습니다." });
  }
  if (record.observations?.boardingOutcome && !["BOARDED", "MISSED"].includes(record.observations.boardingOutcome)) {
    issues.push({ code: "INVALID_OUTCOME", severity: "HIGH", message: "허용되지 않은 탑승 결과입니다." });
  }
  return issues;
}

function calculateMetrics(outcomeRows, platformRows) {
  const outcomePairs = outcomeRows.map((record) => {
    const candidate = plannedCandidate(record);
    return {
      actual: record.observations.boardingOutcome === "BOARDED" ? 1 : 0,
      modelProbability: clampProbability(candidate.modelProbability),
      fusedProbability: clampProbability(candidate.fusedProbability),
      policyFollowed: record.prediction.plannedTrainId === record.prediction.policySelectedTrainId
    };
  });
  const platformPairs = platformRows.map((record) => {
    const candidate = plannedCandidate(record);
    const actualMinutes = (Date.parse(record.observations.platformArrivedAt) - Date.parse(record.prediction.scheduledArrival)) / MINUTE_MS;
    return { actualMinutes, p50: candidate.platformP50Minutes, p90: candidate.platformP90Minutes };
  });
  return {
    suppressed: false,
    boarding: {
      n: outcomePairs.length,
      successRate: mean(outcomePairs.map((row) => row.actual)),
      modelBrier: mean(outcomePairs.map((row) => (row.modelProbability - row.actual) ** 2)),
      fusedBrier: mean(outcomePairs.map((row) => (row.fusedProbability - row.actual) ** 2)),
      modelLogLoss: logLoss(outcomePairs, "modelProbability"),
      fusedLogLoss: logLoss(outcomePairs, "fusedProbability"),
      modelEce: expectedCalibrationError(outcomePairs, "modelProbability"),
      fusedEce: expectedCalibrationError(outcomePairs, "fusedProbability"),
      policyAdherenceRate: mean(outcomePairs.map((row) => row.policyFollowed ? 1 : 0))
    },
    platformArrival: {
      n: platformPairs.length,
      p50MaeMinutes: mean(platformPairs.map((row) => Math.abs(row.p50 - row.actualMinutes))),
      p90MaeMinutes: mean(platformPairs.map((row) => Math.abs(row.p90 - row.actualMinutes))),
      p90CoverageRate: mean(platformPairs.map((row) => row.actualMinutes <= row.p90 ? 1 : 0)),
      p90UnderpredictionRate: mean(platformPairs.map((row) => row.actualMinutes > row.p90 ? 1 : 0))
    },
    interpretation: "실측 관찰 오차이며 인과적 추천 효과가 아닙니다."
  };
}

function suppressedMetrics(outcomeN, platformN) {
  return {
    suppressed: true,
    reason: `완료 표본 ${P2_VALIDATION_PROTOCOL.metricsSuppressionThreshold}건 미만`,
    boarding: { n: outcomeN },
    platformArrival: { n: platformN },
    interpretation: "소표본 오해를 막기 위해 성능 수치를 공개하지 않습니다."
  };
}

function buildSegmentCounts(valid, outcomeRows) {
  const segments = {
    standard: { label: "보통 이동", enrolled: 0, completed: 0 },
    accessibility: { label: "이동지원", enrolled: 0, completed: 0 },
    disrupted: { label: "복합위험", enrolled: 0, completed: 0 }
  };
  for (const record of valid) {
    const ids = segmentIds(record);
    ids.forEach((id) => { segments[id].enrolled += 1; });
  }
  for (const record of outcomeRows) {
    const ids = segmentIds(record);
    ids.forEach((id) => { segments[id].completed += 1; });
  }
  return segments;
}

function segmentIds(record) {
  const context = record.prediction.context || {};
  const ids = [context.accessibilityNeeds ? "accessibility" : "standard"];
  if ((context.flightDelayMinutes || 0) >= 30 || (context.weatherSeverity || 0) >= 1 || (context.immigrationSeverity || 0) >= 1) ids.push("disrupted");
  return ids;
}

function evidenceStage({ completed, segmentCounts, criticalIssueCount }) {
  if (criticalIssueCount > 0) return { id: "NEEDS_REVISION", label: "품질 점검 필요", shareability: "공유 중단", reason: "중대한 데이터 품질 오류가 있습니다." };
  if (completed < P2_VALIDATION_PROTOCOL.metricsSuppressionThreshold) {
    return { id: "COLLECTING", label: "실측 수집 중", shareability: "성능 비공개", reason: `탑승 결과 ${completed}/${P2_VALIDATION_PROTOCOL.metricsSuppressionThreshold}건` };
  }
  if (completed < P2_VALIDATION_PROTOCOL.directionalEvidenceThreshold) {
    return { id: "PILOT_ONLY", label: "파일럿 근거", shareability: "주의문과 내부 공유", reason: `방향성 판단 기준 ${P2_VALIDATION_PROTOCOL.directionalEvidenceThreshold}건 전` };
  }
  const segmentReady = P2_VALIDATION_PROTOCOL.criticalSegments.every((id) => segmentCounts[id].completed >= P2_VALIDATION_PROTOCOL.operationalMinimumPerCriticalSegment);
  if (completed < P2_VALIDATION_PROTOCOL.operationalCandidateThreshold || !segmentReady) {
    return { id: "DIRECTIONAL", label: "방향성 근거", shareability: "한계와 함께 공유", reason: segmentReady ? "운영 후보 표본을 더 수집합니다." : "이동지원·복합위험 구간 표본을 더 수집합니다." };
  }
  return { id: "OPERATIONAL_CANDIDATE", label: "운영 검증 후보", shareability: "기관 대조 후 확정", reason: "표본·구간·품질 게이트를 통과했습니다." };
}

function plannedCandidate(record) {
  return record.prediction.candidates.find((candidate) => candidate.id === record.prediction.plannedTrainId);
}

function expectedCalibrationError(rows, key) {
  if (!rows.length) return null;
  let weighted = 0;
  for (let bin = 0; bin < 5; bin += 1) {
    const lower = bin / 5;
    const upper = (bin + 1) / 5;
    const members = rows.filter((row) => row[key] >= lower && (bin === 4 ? row[key] <= upper : row[key] < upper));
    if (!members.length) continue;
    weighted += Math.abs(mean(members.map((row) => row[key])) - mean(members.map((row) => row.actual))) * members.length / rows.length;
  }
  return round(weighted, 4);
}

function logLoss(rows, key) {
  if (!rows.length) return null;
  return round(mean(rows.map((row) => {
    const probability = Math.min(1 - 1e-6, Math.max(1e-6, row[key]));
    return -(row.actual * Math.log(probability) + (1 - row.actual) * Math.log(1 - probability));
  })), 4);
}

function mean(values) {
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 4);
}

function rate(numerator, denominator) {
  return denominator ? round(numerator / denominator, 4) : 0;
}

function clampProbability(value) {
  return Math.min(1, Math.max(0, finite(value)));
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeMode(value) {
  return ["live", "fallback", "demo"].includes(value) ? value : "unknown";
}

function isIso(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function toIso(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError("유효한 시각이 필요합니다.");
  return parsed.toISOString();
}

function shortId(value) {
  return typeof value === "string" ? value.slice(0, 8) : "unknown";
}

function round(value, digits = 4) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
