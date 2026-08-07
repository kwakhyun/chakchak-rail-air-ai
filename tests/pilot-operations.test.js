import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { P2ValidationStore, verifyPilotExport } from "../lib/p2-validation-store.mjs";
import { predictChakchakJourney } from "../src/chakchak-ai.js";

const TEST_SECRET = "pilot-test-secret-with-at-least-32-characters";

test("P2-B는 모집 단계와 일회용 참여코드 없이는 실제 파일럿 등록을 거부한다", async () => {
  const { store, prediction, input } = await pilotFixture();
  await assert.rejects(
    store.enroll({ consent: true, input, prediction, plannedTrainId: prediction.recommendation.selectedTrainId }),
    (error) => error.code === "PILOT_NOT_ENROLLING"
  );
  const issued = await store.issuePilotInvites({ count: 1, validityDays: 7 });
  await store.transitionPilotPhase("ENROLLING", "자동 테스트 모집 시작");
  await assert.rejects(
    store.enroll({ consent: true, input, prediction, plannedTrainId: prediction.recommendation.selectedTrainId }),
    (error) => error.code === "PILOT_CODE_REQUIRED"
  );
  const enrollment = await store.enroll({
    consent: true,
    pilotCode: issued.codes[0].code,
    input,
    prediction,
    plannedTrainId: prediction.recommendation.selectedTrainId
  });
  assert.equal(enrollment.session.status, "TRACKING");
  await assert.rejects(
    store.enroll({ consent: true, pilotCode: issued.codes[0].code, input, prediction, plannedTrainId: prediction.recommendation.selectedTrainId }),
    (error) => error.code === "PILOT_CODE_USED"
  );
});

test("P2-B는 참여코드 원문을 저장하지 않고 동의문 해시와 선택 동의만 고정한다", async () => {
  const { store, filePath, prediction, input } = await pilotFixture();
  const issued = await store.issuePilotInvites({ count: 1 });
  await store.transitionPilotPhase("ENROLLING");
  const enrollment = await store.enroll({
    consent: true,
    institutionMatchConsent: true,
    pilotCode: issued.codes[0].code,
    input,
    prediction,
    plannedTrainId: prediction.recommendation.selectedTrainId
  });
  assert.match(enrollment.participantMatchCode, /^CC-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(enrollment.session.institutionMatchEnabled, true);
  const persisted = await readFile(filePath, "utf8");
  assert.equal(persisted.includes(issued.codes[0].code), false);
  assert.equal(persisted.includes("FIELD_VALIDATION"), true);
  assert.equal(persisted.includes("INSTITUTION_MATCH"), true);
  assert.match(JSON.parse(persisted).records[0].consent.noticeDigest, /^[a-f0-9]{64}$/);
});

test("P2-B 운영판은 코드·진행·기한초과·기관대조 준비도를 실제 분모로 계산한다", async () => {
  const fixture = await pilotFixture();
  const issued = await fixture.store.issuePilotInvites({ count: 2 });
  await fixture.store.transitionPilotPhase("ENROLLING");
  await fixture.store.enroll({
    consent: true,
    institutionMatchConsent: true,
    pilotCode: issued.codes[0].code,
    input: fixture.input,
    prediction: fixture.prediction,
    plannedTrainId: fixture.prediction.recommendation.selectedTrainId
  });
  let status = await fixture.store.pilotStatus();
  assert.equal(status.admission.available, 1);
  assert.equal(status.admission.redeemed, 1);
  assert.equal(status.operations.enrolled, 1);
  assert.equal(status.operations.inProgress, 1);
  assert.equal(status.operations.institutionMatchEligible, 1);
  assert.equal(status.readiness.admissionControl, "PASS");

  fixture.setNow("2026-08-16T12:00:00.000Z");
  status = await fixture.store.pilotStatus();
  assert.equal(status.operations.overdueOutcomes, 1);
  assert.equal(status.readiness.outcomeFollowUp, "ACTION_REQUIRED");
  assert.equal(status.alerts.some((alert) => alert.code === "OVERDUE_OUTCOMES"), true);
});

test("P2-B 기관 대조 내보내기는 선택 동의 여정만 포함하고 위변조를 검출한다", async () => {
  const { store, prediction, input } = await pilotFixture();
  const issued = await store.issuePilotInvites({ count: 2 });
  await store.transitionPilotPhase("ENROLLING");
  await store.enroll({ consent: true, institutionMatchConsent: true, pilotCode: issued.codes[0].code, input, prediction, plannedTrainId: prediction.recommendation.selectedTrainId });
  await store.enroll({ consent: true, institutionMatchConsent: false, pilotCode: issued.codes[1].code, input, prediction, plannedTrainId: prediction.recommendation.selectedTrainId });
  const artifact = await store.exportInstitutionMatch();
  assert.equal(artifact.manifest.recordCount, 1);
  assert.equal(artifact.manifest.containsDirectIdentifiers, false);
  assert.equal(artifact.manifest.actualInstitutionDataIncluded, false);
  assert.equal("journeyId" in artifact.rows[0], false);
  assert.equal(verifyPilotExport(artifact, TEST_SECRET), true);
  artifact.rows[0].boardingOutcome = "BOARDED";
  assert.equal(verifyPilotExport(artifact, TEST_SECRET), false);
});

test("P2-B 철회는 여정·익명 대조키·참여자 감사 흔적을 함께 물리 삭제한다", async () => {
  const { store, filePath, prediction, input } = await pilotFixture();
  const issued = await store.issuePilotInvites({ count: 1 });
  await store.transitionPilotPhase("ENROLLING");
  const enrollment = await store.enroll({ consent: true, institutionMatchConsent: true, pilotCode: issued.codes[0].code, input, prediction, plannedTrainId: prediction.recommendation.selectedTrainId });
  const matchCode = enrollment.participantMatchCode;
  await store.withdraw(enrollment.token);
  const database = JSON.parse(await readFile(filePath, "utf8"));
  assert.deepEqual(database.records, []);
  assert.equal(JSON.stringify(database).includes(matchCode), false);
  assert.equal(database.pilot.audit.some((event) => event.subjectRef), false);
  assert.equal(database.pilot.counters.withdrawn, 1);
  assert.equal((await store.exportInstitutionMatch()).manifest.recordCount, 0);
});

test("P2-B 운영 단계는 준비→접수→중지→재개→종료 순서만 허용한다", async () => {
  const { store } = await pilotFixture();
  await assert.rejects(store.transitionPilotPhase("PAUSED"), (error) => error.code === "INVALID_PHASE_TRANSITION");
  assert.equal((await store.transitionPilotPhase("ENROLLING")).phase, "ENROLLING");
  assert.equal((await store.transitionPilotPhase("PAUSED")).phase, "PAUSED");
  assert.equal((await store.transitionPilotPhase("ENROLLING")).phase, "ENROLLING");
  assert.equal((await store.transitionPilotPhase("CLOSED")).phase, "CLOSED");
  await assert.rejects(store.transitionPilotPhase("ENROLLING"), (error) => error.code === "INVALID_PHASE_TRANSITION");
});

async function pilotFixture() {
  const directory = await mkdtemp(join(tmpdir(), "chakchak-p2b-"));
  const filePath = join(directory, "journeys.json");
  let current = new Date("2026-08-12T07:00:00.000Z");
  const store = new P2ValidationStore({
    filePath,
    secret: TEST_SECRET,
    pilotInviteRequired: true,
    now: () => current
  });
  const input = modelInput();
  const prediction = predictChakchakJourney(input);
  return {
    store,
    filePath,
    input,
    prediction,
    setNow(value) { current = new Date(value); }
  };
}

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
