import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { P2ValidationStore } from "../lib/p2-validation-store.mjs";
import { predictChakchakJourney } from "../src/chakchak-ai.js";
import { P2_VALIDATION_PROTOCOL, buildP2ValidationReport } from "../src/real-world-validation.js";

test("P2는 실제 완료 30건 전까지 성능 수치를 공개하지 않는다", () => {
  const report = buildP2ValidationReport([], { now: "2026-08-04T12:00:00.000Z" });
  assert.equal(report.evidence.id, "COLLECTING");
  assert.equal(report.realWorldPerformanceAvailable, false);
  assert.equal(report.metrics.suppressed, true);
  assert.equal(report.metrics.boarding.n, 0);
  assert.match(report.metrics.reason, /30건 미만/);
});

test("P2 실측 백테스트는 실제 탑승 Brier와 P90 커버리지를 원시 분모에서 계산한다", () => {
  const records = Array.from({ length: 40 }, (_, index) => fixtureRecord(index));
  const report = buildP2ValidationReport(records, { now: "2026-08-04T12:00:00.000Z" });
  assert.equal(report.realWorldPerformanceAvailable, true);
  assert.equal(report.evidence.id, "PILOT_ONLY");
  assert.equal(report.counts.boardingOutcomes, 40);
  assert.equal(report.metrics.boarding.successRate, 0.8);
  assert.equal(report.metrics.boarding.modelBrier, 0.16);
  assert.equal(report.metrics.boarding.fusedBrier, 0.1625);
  assert.equal(report.metrics.platformArrival.p50MaeMinutes, 5);
  assert.equal(report.metrics.platformArrival.p90CoverageRate, 1);
  assert.equal(report.metrics.platformArrival.p90UnderpredictionRate, 0);
});

test("P2 품질 게이트는 중복 여정과 미래 관측을 성능 집계에서 제외한다", () => {
  const duplicate = fixtureRecord(0);
  const future = fixtureRecord(2);
  future.journeyId = "future-row";
  future.updatedAt = "2026-08-06T00:00:00.000Z";
  const report = buildP2ValidationReport([fixtureRecord(0), duplicate, future], { now: "2026-08-04T12:00:00.000Z" });
  assert.equal(report.quality.status, "BLOCKED");
  assert.equal(report.quality.duplicateJourneyIds, 1);
  assert.equal(report.quality.futureTimestampRows, 1);
  assert.equal(report.quality.acceptedRows, 1);
  assert.equal(report.realWorldPerformanceAvailable, false);
});

test("P2 저장소는 동의·서명 토큰·현장 기록·멱등성·물리 삭제를 보장한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chakchak-p2-"));
  const filePath = join(directory, "journeys.json");
  let current = new Date("2026-08-12T07:00:00.000Z");
  const store = new P2ValidationStore({ filePath, secret: "test-only-secret", now: () => current });
  const input = modelInput();
  const prediction = predictChakchakJourney(input);
  const plannedTrainId = prediction.recommendation.selectedTrainId;

  await assert.rejects(
    store.enroll({ consent: false, input, prediction, plannedTrainId }),
    (error) => error.code === "CONSENT_REQUIRED"
  );
  const enrollment = await store.enroll({ consent: true, input, prediction, plannedTrainId });
  assert.equal(enrollment.session.status, "TRACKING");
  assert.equal(enrollment.consentVersion, P2_VALIDATION_PROTOCOL.consentVersion);

  const persisted = await readFile(filePath, "utf8");
  for (const forbidden of ["name", "email", "phone", "address", "reservation", "flightId", "127.0.0.1"]) {
    assert.equal(persisted.includes(forbidden), false, `금지 필드가 저장됨: ${forbidden}`);
  }

  current = new Date("2026-08-12T09:05:00.000Z");
  const platform = await store.observe({ token: enrollment.token, eventType: "PLATFORM_ARRIVED" });
  assert.equal(platform.idempotent, false);
  assert.equal(platform.session.platformArrived, true);
  const repeated = await store.observe({ token: enrollment.token, eventType: "PLATFORM_ARRIVED" });
  assert.equal(repeated.idempotent, true);

  current = new Date("2026-08-12T11:05:00.000Z");
  const outcome = await store.observe({ token: enrollment.token, eventType: "TRAIN_BOARDED" });
  assert.equal(outcome.session.status, "COMPLETE");
  assert.equal(outcome.session.boardingOutcome, "BOARDED");
  await assert.rejects(
    store.observe({ token: enrollment.token, eventType: "TRAIN_MISSED" }),
    (error) => error.code === "OUTCOME_CONFLICT"
  );

  assert.equal((await store.report({ includeSuppressed: true })).counts.enrolled, 1);
  const withdrawn = await store.withdraw(enrollment.token);
  assert.equal(withdrawn.removed, 1);
  assert.equal((await store.report()).counts.enrolled, 0);
  await assert.rejects(store.session(enrollment.token), (error) => error.code === "SESSION_NOT_FOUND");
});

test("P2는 실제 이동시각보다 이른 현장 결과 입력을 거부한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chakchak-p2-window-"));
  let current = new Date("2026-08-12T07:00:00.000Z");
  const store = new P2ValidationStore({ filePath: join(directory, "journeys.json"), secret: "test-only-secret", now: () => current });
  const input = modelInput();
  const prediction = predictChakchakJourney(input);
  const enrollment = await store.enroll({ consent: true, input, prediction, plannedTrainId: prediction.recommendation.selectedTrainId });
  await assert.rejects(
    store.observe({ token: enrollment.token, eventType: "TRAIN_BOARDED" }),
    (error) => error.code === "EVENT_TOO_EARLY"
  );
});

test("P2 품질 게이트는 불가능한 예측값과 관측 순서 모순을 차단한다", () => {
  const invalid = fixtureRecord(0);
  invalid.journeyId = "invalid-domain-order";
  invalid.prediction.candidates[0].modelProbability = Number.NaN;
  invalid.prediction.candidates[0].platformP90Minutes = 40;
  invalid.observations.platformArrivedAt = "2026-08-01T10:10:00.000Z";
  invalid.observations.outcomeRecordedAt = "2026-08-01T10:05:00.000Z";
  const report = buildP2ValidationReport([invalid], { now: "2026-08-04T12:00:00.000Z" });
  assert.equal(report.quality.status, "BLOCKED");
  assert.equal(report.quality.acceptedRows, 0);
  assert.equal(report.quality.invalidPredictionRows, 1);
  assert.equal(report.quality.issues.some((issue) => issue.code === "EVENT_ORDER_VIOLATION"), true);
  assert.equal(report.realWorldPerformanceAvailable, false);
});

test("P2 저장소는 30일이 지난 여정을 조회 시점에 물리 삭제한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chakchak-p2-expiry-"));
  const filePath = join(directory, "journeys.json");
  let current = new Date("2026-08-01T07:00:00.000Z");
  const store = new P2ValidationStore({ filePath, secret: "test-only-secret", now: () => current });
  const input = modelInput();
  const prediction = predictChakchakJourney(input);
  const enrollment = await store.enroll({ consent: true, input, prediction, plannedTrainId: prediction.recommendation.selectedTrainId });

  current = new Date("2026-08-31T07:00:00.001Z");
  assert.equal((await store.report()).counts.enrolled, 0);
  const persisted = JSON.parse(await readFile(filePath, "utf8"));
  assert.deepEqual(persisted.records, []);
  await assert.rejects(store.session(enrollment.token), (error) => error.code === "SESSION_NOT_FOUND");
});

function modelInput() {
  return {
    scheduledArrival: "2026-08-12T08:00:00.000Z",
    context: {
      flightDelayMinutes: 10,
      weatherSeverity: 0.2,
      immigrationSeverity: 0.3,
      baggageDelayMinutes: 0,
      checkedBaggage: true,
      accessibilityNeeds: false,
      largeLuggage: false,
      boardingBufferMinutes: 5,
      flightMode: "live",
      immigrationMode: "live",
      weatherMode: "live"
    },
    candidates: [
      { id: "AREX-A", departureTime: "2026-08-12T10:00:00.000Z", destinationArrivalTime: "2026-08-12T12:00:00.000Z" },
      { id: "AREX-B", departureTime: "2026-08-12T11:00:00.000Z", destinationArrivalTime: "2026-08-12T13:00:00.000Z" }
    ]
  };
}

function fixtureRecord(index) {
  const boarded = index < 32;
  const accessibilityNeeds = index % 4 === 0;
  const disrupted = index % 3 === 0;
  return {
    schemaVersion: "1.0",
    source: P2_VALIDATION_PROTOCOL.cohortSource,
    journeyId: `journey-${index}`,
    createdAt: "2026-08-01T07:00:00.000Z",
    updatedAt: "2026-08-01T10:05:00.000Z",
    consent: { granted: true, version: P2_VALIDATION_PROTOCOL.consentVersion, grantedAt: "2026-08-01T07:00:00.000Z" },
    prediction: {
      scheduledArrival: "2026-08-01T08:00:00.000Z",
      modelVersion: "1.1.0-sim",
      policyId: "chakchak-p1b-balanced-safety-v1",
      policySelectedTrainId: "AREX-A",
      plannedTrainId: "AREX-A",
      context: {
        flightDelayMinutes: disrupted ? 45 : 5,
        weatherSeverity: disrupted ? 1.2 : 0.2,
        immigrationSeverity: 0.3,
        accessibilityNeeds
      },
      candidates: [{
        id: "AREX-A",
        departureTime: "2026-08-01T10:00:00.000Z",
        modelProbability: 0.8,
        fusedProbability: 0.75,
        platformP50Minutes: 55,
        platformP90Minutes: 75
      }]
    },
    observations: {
      platformArrivedAt: "2026-08-01T09:00:00.000Z",
      boardingOutcome: boarded ? "BOARDED" : "MISSED",
      outcomeRecordedAt: "2026-08-01T10:05:00.000Z"
    }
  };
}
