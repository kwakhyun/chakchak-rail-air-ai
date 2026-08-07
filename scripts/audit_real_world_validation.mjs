import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "../lib/env.mjs";
import { P2ValidationStore, loadOrCreateP2ValidationSecret } from "../lib/p2-validation-store.mjs";
import { P2B_PILOT_PROTOCOL, P2_VALIDATION_PROTOCOL, buildP2ValidationReport } from "../src/real-world-validation.js";

const root = fileURLToPath(new URL("..", import.meta.url));
await loadLocalEnv(root);
const storePath = resolve(root, process.env.CHAKCHAK_VALIDATION_STORE || "runtime/validation/journeys.json");
const outputPath = resolve(root, "output/audit/p2-real-world-validation-readiness.json");
const database = await readDatabase(storePath);
const report = buildP2ValidationReport(database.records);
const configuredSecret = process.env.CHAKCHAK_VALIDATION_SECRET;
const validationSecret = configuredSecret || await loadOrCreateP2ValidationSecret(resolve(root, "runtime/validation/token-secret"));
const store = new P2ValidationStore({ filePath: storePath, secret: validationSecret, secretMode: configuredSecret ? "environment" : "local-generated", pilotInviteRequired: true });
const pilot = await store.pilotStatus();
const serialized = JSON.stringify(database);
const forbiddenFields = ["name", "email", "phone", "address", "reservationNumber", "flightId", "ipAddress"];
const detectedForbiddenFields = forbiddenFields.filter((field) => new RegExp(`"${field}"\\s*:`, "i").test(serialized));
const rawInviteCodesDetected = serialized.match(/CHAK-[A-Z2-9]{4}-[A-Z2-9]{4}/g) || [];

const artifact = {
  auditId: "chakchak-p2b-field-pilot-readiness-2026-08-04",
  generatedAt: new Date().toISOString(),
  assessment: report.counts.boardingOutcomes === 0
    ? "FIELD_PILOT_READY_NO_REAL_WORLD_CLAIM"
    : report.quality.status === "BLOCKED" ? "NEEDS_REVISION" : report.evidence.id,
  question: "착착의 시뮬레이션 성능과 분리된 실제 여정 결과를 신뢰 가능한 방식으로 수집·검증할 수 있는가?",
  dataset: {
    path: storePath.replace(`${root}/`, ""),
    grain: P2_VALIDATION_PROTOCOL.grain,
    source: P2_VALIDATION_PROTOCOL.cohortSource,
    asOf: report.generatedAt,
    timeZone: `${P2_VALIDATION_PROTOCOL.storageTimeZone} 저장 / ${P2_VALIDATION_PROTOCOL.displayTimeZone} 표시`,
    rows: database.records.length
  },
  protocol: P2_VALIDATION_PROTOCOL,
  fieldPilotProtocol: P2B_PILOT_PROTOCOL,
  fieldPilotOperations: pilot,
  privacyAudit: {
    prohibitedFieldCount: detectedForbiddenFields.length + rawInviteCodesDetected.length,
    prohibitedFieldsDetected: detectedForbiddenFields,
    rawInviteCodeCount: rawInviteCodesDetected.length,
    pass: detectedForbiddenFields.length === 0 && rawInviteCodesDetected.length === 0,
    note: "항공편 번호와 참여코드 원문은 실시간 요청·현장 전달에만 사용하고 P2-B 저장소에는 기록하지 않는다."
  },
  report,
  calculationSelfCheck: selfCheck(),
  validationAssessment: {
    rating: report.counts.boardingOutcomes >= P2_VALIDATION_PROTOCOL.metricsSuppressionThreshold && report.quality.status !== "BLOCKED"
      ? "Share with caveats"
      : "Ready to collect; performance claims blocked",
    verified: [
      "명시적 동의 없이는 등록 거부",
      "서버 재계산 예측 스냅샷과 모델·정책 버전 잠금",
      "서명 토큰 기반 현장 기록과 철회 시 물리 삭제",
      "일회용 참여코드 해시·모집 단계·중복 사용 차단",
      "동의문 SHA-256 고정과 기관 대조 선택 동의 분리",
      "기관 대조용 익명 자료 HMAC 서명·위변조 검증",
      "중복·미래시각·동의·스키마 품질 게이트",
      "실제 이진 결과 Brier·log loss·ECE와 P50/P90 오차 계산",
      "완료 30건 전 공개 억제와 100/300건 증거 단계"
    ],
    blockers: [
      ...(report.counts.boardingOutcomes < P2_VALIDATION_PROTOCOL.metricsSuppressionThreshold ? ["실제 완료 표본 30건 미만: 성능 수치 공개 금지"] : []),
      ...(pilot.phase !== "ENROLLING" ? ["파일럿 접수 단계가 아직 열리지 않음"] : []),
      ...(pilot.admission.available === 0 ? ["사용 가능한 일회용 참여코드가 없음"] : []),
      "현재 저장소는 단일 서버용 원자적 파일 방식: 공개·다중 인스턴스 배포 전 관리형 데이터베이스 필요",
      "자기기록 선택편향과 미응답 편향이 남으므로 기관 승하차·게이트 대조가 필요",
      "관찰자료만으로 추천의 인과효과를 주장할 수 없음"
    ]
  }
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, assessment: artifact.assessment, counts: report.counts, privacyAudit: artifact.privacyAudit }, null, 2));

async function readDatabase(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(parsed?.records) ? parsed : { records: [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { records: [] };
    throw error;
  }
}

function selfCheck() {
  const records = Array.from({ length: 40 }, (_, index) => ({
    schemaVersion: "1.0",
    source: P2_VALIDATION_PROTOCOL.cohortSource,
    journeyId: `self-check-${index}`,
    createdAt: "2026-08-01T07:00:00.000Z",
    updatedAt: "2026-08-01T10:05:00.000Z",
    consent: { granted: true, version: P2_VALIDATION_PROTOCOL.consentVersion },
    prediction: {
      scheduledArrival: "2026-08-01T08:00:00.000Z",
      modelVersion: "1.1.0-sim",
      policyId: "chakchak-p1b-balanced-safety-v1",
      policySelectedTrainId: "AREX-A",
      plannedTrainId: "AREX-A",
      context: { flightDelayMinutes: index % 3 === 0 ? 45 : 5, weatherSeverity: 0.2, immigrationSeverity: 0.3, accessibilityNeeds: index % 4 === 0 },
      candidates: [{ id: "AREX-A", departureTime: "2026-08-01T10:00:00.000Z", modelProbability: 0.8, fusedProbability: 0.75, platformP50Minutes: 55, platformP90Minutes: 75 }]
    },
    observations: { platformArrivedAt: "2026-08-01T09:00:00.000Z", boardingOutcome: index < 32 ? "BOARDED" : "MISSED", outcomeRecordedAt: "2026-08-01T10:05:00.000Z" }
  }));
  const result = buildP2ValidationReport(records, { now: "2026-08-04T12:00:00.000Z" });
  const expected = { successRate: 0.8, modelBrier: 0.16, fusedBrier: 0.1625, p50MaeMinutes: 5, p90CoverageRate: 1 };
  const actual = {
    successRate: result.metrics.boarding.successRate,
    modelBrier: result.metrics.boarding.modelBrier,
    fusedBrier: result.metrics.boarding.fusedBrier,
    p50MaeMinutes: result.metrics.platformArrival.p50MaeMinutes,
    p90CoverageRate: result.metrics.platformArrival.p90CoverageRate
  };
  return { fixtureSource: "SYNTHETIC_CALCULATOR_SELF_CHECK_NOT_REAL_WORLD_PERFORMANCE", rows: records.length, expected, actual, pass: JSON.stringify(expected) === JSON.stringify(actual) };
}
