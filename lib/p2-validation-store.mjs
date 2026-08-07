import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  P2B_PILOT_PROTOCOL,
  P2_VALIDATION_PROTOCOL,
  buildP2ValidationReport,
  createP2PredictionSnapshot
} from "../src/real-world-validation.js";

const MINUTE_MS = 60_000;
const MAX_EARLY_EVENT_MS = 120 * MINUTE_MS;
const MAX_LATE_EVENT_MS = 72 * 60 * MINUTE_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;
const PILOT_AUDIT_LIMIT = 5_000;
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class P2ValidationStore {
  constructor({ filePath, secret, secretMode, pilotInviteRequired = false, now = () => new Date() }) {
    if (!filePath) throw new TypeError("P2 저장 경로가 필요합니다.");
    this.filePath = filePath;
    this.secret = secret || randomBytes(32).toString("hex");
    this.secretMode = secretMode || (secret ? "environment" : "ephemeral");
    this.pilotInviteRequired = Boolean(pilotInviteRequired);
    this.now = now;
    this.queue = Promise.resolve();
  }

  async enroll({ consent, institutionMatchConsent = false, pilotCode, input, prediction, plannedTrainId }) {
    if (consent !== true) throw validationError("CONSENT_REQUIRED", 400, "익명 실측 검증 참여 동의가 필요합니다.");
    const createdAt = this.now().toISOString();
    const journeyId = randomUUID();
    const predictionSnapshot = createP2PredictionSnapshot(input, prediction, plannedTrainId, createdAt);
    return this.#mutate((database) => {
      const invitation = this.pilotInviteRequired
        ? authorizeInvitation(database.pilot, pilotCode, createdAt, this.secret)
        : null;
      const subjectRef = sign(`subject:${journeyId}`, this.secret);
      let participantMatchCode = institutionMatchConsent ? humanCode("CC") : null;
      while (participantMatchCode && database.records.some((record) => record.pilot?.participantMatchCode === participantMatchCode)) {
        participantMatchCode = humanCode("CC");
      }
      const consentScopes = [P2B_PILOT_PROTOCOL.consent.essentialScope];
      if (institutionMatchConsent) consentScopes.push(P2B_PILOT_PROTOCOL.consent.institutionMatchScope);
      const record = {
        schemaVersion: P2_VALIDATION_PROTOCOL.schemaVersion,
        source: P2_VALIDATION_PROTOCOL.cohortSource,
        journeyId,
        createdAt,
        updatedAt: createdAt,
        consent: {
          granted: true,
          version: P2_VALIDATION_PROTOCOL.consentVersion,
          grantedAt: createdAt,
          retentionDays: P2_VALIDATION_PROTOCOL.retentionDays,
          noticeDigest: pilotConsentDigest(),
          scopes: consentScopes
        },
        pilot: {
          protocolId: P2B_PILOT_PROTOCOL.id,
          cohortId: P2B_PILOT_PROTOCOL.cohortId,
          invitationId: invitation?.id || null,
          subjectRef,
          participantMatchCode,
          institutionMatchEnabled: Boolean(institutionMatchConsent)
        },
        prediction: predictionSnapshot,
        observations: {
          platformArrivedAt: null,
          boardingOutcome: null,
          outcomeRecordedAt: null,
          planChangedAt: null
        }
      };
      database.records.push(record);
      if (invitation) {
        invitation.status = "REDEEMED";
        invitation.redeemedAt = createdAt;
        invitation.subjectRef = subjectRef;
      }
      appendAudit(database.pilot, "JOURNEY_ENROLLED", createdAt, { subjectRef });
      return {
        token: this.#token(journeyId),
        journeyId: journeyId.slice(0, 8),
        consentVersion: P2_VALIDATION_PROTOCOL.consentVersion,
        consentNoticeDigest: record.consent.noticeDigest,
        expiresAt: new Date(Date.parse(createdAt) + P2_VALIDATION_PROTOCOL.retentionDays * DAY_MS).toISOString(),
        participantMatchCode,
        session: publicSession(record)
      };
    });
  }

  async observe({ token, eventType, trainId }) {
    const journeyId = this.#verifyToken(token);
    if (!P2_VALIDATION_PROTOCOL.allowedEvents.includes(eventType)) {
      throw validationError("INVALID_EVENT", 400, "허용되지 않은 실측 기록입니다.");
    }
    return this.#mutate((database) => {
      const record = database.records.find((candidate) => candidate.journeyId === journeyId);
      if (!record) throw validationError("SESSION_NOT_FOUND", 404, "실측 검증 여정을 찾지 못했습니다.");
      const now = this.now();
      const alreadyRecorded = isExistingEvent(record, eventType);
      if (eventType === "PLAN_SELECTED") {
        const selectedId = String(trainId || "");
        if (!record.prediction.candidates.some((candidate) => candidate.id === selectedId)) {
          throw validationError("INVALID_TRAIN", 400, "예측 후보에 없는 열차입니다.");
        }
        if (record.observations.boardingOutcome) throw validationError("OUTCOME_LOCKED", 409, "탑승 결과 기록 후에는 계획을 바꿀 수 없습니다.");
        record.prediction.plannedTrainId = selectedId;
        record.observations.planChangedAt = now.toISOString();
      } else {
        assertEventWindow(record, now, eventType);
        if (eventType === "PLATFORM_ARRIVED") {
          if (record.observations.boardingOutcome) throw validationError("EVENT_ORDER_VIOLATION", 409, "탑승 결과 기록 후에는 승강장 도착시각을 추가할 수 없습니다.");
          if (!record.observations.platformArrivedAt) record.observations.platformArrivedAt = now.toISOString();
        } else {
          const outcome = eventType === "TRAIN_BOARDED" ? "BOARDED" : "MISSED";
          if (record.observations.boardingOutcome && record.observations.boardingOutcome !== outcome) {
            throw validationError("OUTCOME_CONFLICT", 409, "이미 반대 결과가 기록되어 있습니다.");
          }
          if (!record.observations.boardingOutcome) {
            record.observations.boardingOutcome = outcome;
            record.observations.outcomeRecordedAt = now.toISOString();
          }
        }
      }
      record.updatedAt = now.toISOString();
      appendAudit(database.pilot, eventType, record.updatedAt, { subjectRef: record.pilot?.subjectRef });
      return { session: publicSession(record), idempotent: alreadyRecorded };
    });
  }

  async session(token) {
    const journeyId = this.#verifyToken(token);
    return this.#mutate((database) => {
      const record = database.records.find((candidate) => candidate.journeyId === journeyId);
      if (!record) throw validationError("SESSION_NOT_FOUND", 404, "실측 검증 여정을 찾지 못했습니다.");
      return publicSession(record);
    });
  }

  async withdraw(token) {
    const journeyId = this.#verifyToken(token);
    return this.#mutate((database) => {
      const record = database.records.find((candidate) => candidate.journeyId === journeyId);
      const subjectRef = record?.pilot?.subjectRef;
      const before = database.records.length;
      database.records = database.records.filter((candidate) => candidate.journeyId !== journeyId);
      const removed = before - database.records.length;
      if (!removed) throw validationError("SESSION_NOT_FOUND", 404, "삭제할 실측 검증 여정을 찾지 못했습니다.");
      if (subjectRef) {
        database.pilot.audit = database.pilot.audit.filter((event) => event.subjectRef !== subjectRef);
        const invitation = database.pilot.invitations.find((candidate) => candidate.subjectRef === subjectRef);
        if (invitation) {
          invitation.status = "WITHDRAWN";
          invitation.subjectRef = null;
        }
      }
      database.pilot.counters.withdrawn += 1;
      appendAudit(database.pilot, "JOURNEY_WITHDRAWN", this.now().toISOString());
      return { removed, message: "해당 여정의 예측과 현장 기록을 저장소에서 삭제했습니다." };
    });
  }

  async report(options = {}) {
    return this.#mutate((database) => buildP2ValidationReport(database.records, { now: this.now(), ...options }));
  }

  async pilotStatus(options = {}) {
    return this.#mutate((database) => {
      const now = this.now();
      const report = buildP2ValidationReport(database.records, { now });
      return buildPilotOperationsStatus(database, report, now, Boolean(options.includePrivate));
    });
  }

  async issuePilotInvites({ count = 1, validityDays = P2B_PILOT_PROTOCOL.inviteValidityDays } = {}) {
    const inviteCount = Number(count);
    const days = Number(validityDays);
    if (!Number.isInteger(inviteCount) || inviteCount < 1 || inviteCount > 100) {
      throw validationError("INVALID_INVITE_COUNT", 400, "참여코드는 한 번에 1~100개까지 만들 수 있습니다.");
    }
    if (!Number.isFinite(days) || days < 1 || days > 30) {
      throw validationError("INVALID_INVITE_VALIDITY", 400, "참여코드 유효기간은 1~30일이어야 합니다.");
    }
    return this.#mutate((database) => {
      if (database.pilot.phase === "CLOSED") throw validationError("PILOT_CLOSED", 409, "종료된 파일럿에서는 참여코드를 만들 수 없습니다.");
      const issuedAt = this.now().toISOString();
      const expiresAt = new Date(Date.parse(issuedAt) + days * DAY_MS).toISOString();
      const codes = [];
      for (let index = 0; index < inviteCount; index += 1) {
        let code = humanCode("CHAK");
        let codeDigest = inviteDigest(code, this.secret);
        while (database.pilot.invitations.some((invitation) => invitation.codeDigest === codeDigest)) {
          code = humanCode("CHAK");
          codeDigest = inviteDigest(code, this.secret);
        }
        const invitation = {
          id: randomUUID(),
          codeDigest,
          status: "ISSUED",
          issuedAt,
          expiresAt,
          redeemedAt: null,
          subjectRef: null
        };
        database.pilot.invitations.push(invitation);
        codes.push({ code, expiresAt });
      }
      appendAudit(database.pilot, "INVITES_ISSUED", issuedAt, { count: inviteCount });
      return { issued: inviteCount, codes, warning: "참여코드 원문은 다시 조회할 수 없습니다. 개인정보와 함께 보관하지 마세요." };
    });
  }

  async transitionPilotPhase(phase, reason = "") {
    const next = String(phase || "").toUpperCase();
    if (!P2B_PILOT_PROTOCOL.allowedPhases.includes(next)) {
      throw validationError("INVALID_PILOT_PHASE", 400, "허용되지 않은 파일럿 운영 단계입니다.");
    }
    return this.#mutate((database) => {
      const previous = database.pilot.phase;
      if (!allowedPhaseTransition(previous, next)) {
        throw validationError("INVALID_PHASE_TRANSITION", 409, `${previous} 단계에서 ${next} 단계로 바꿀 수 없습니다.`);
      }
      const changedAt = this.now().toISOString();
      database.pilot.phase = next;
      database.pilot.updatedAt = changedAt;
      appendAudit(database.pilot, "PILOT_PHASE_CHANGED", changedAt, {
        previous,
        next,
        reason: sanitizeOperatorNote(reason)
      });
      return { previous, phase: next, label: P2B_PILOT_PROTOCOL.phaseLabels[next], changedAt };
    });
  }

  async exportInstitutionMatch() {
    return this.#mutate((database) => {
      const generatedAt = this.now().toISOString();
      const rows = database.records
        .filter((record) => record.consent?.scopes?.includes(P2B_PILOT_PROTOCOL.consent.institutionMatchScope) && record.pilot?.participantMatchCode)
        .map(institutionExportRow);
      const payload = {
        manifest: {
          exportId: randomUUID(),
          protocolId: P2B_PILOT_PROTOCOL.id,
          cohortId: P2B_PILOT_PROTOCOL.cohortId,
          schemaVersion: P2B_PILOT_PROTOCOL.institutionExport.schemaVersion,
          generatedAt,
          timeZone: "UTC",
          grain: P2B_PILOT_PROTOCOL.institutionExport.grain,
          recordCount: rows.length,
          containsDirectIdentifiers: false,
          actualInstitutionDataIncluded: false,
          caveat: "기관 원장과 대조하기 위한 착착 측 익명 자료이며, 실제 기관 자료나 대조 결과는 포함하지 않습니다."
        },
        rows
      };
      const digest = exportDigest(payload);
      const signature = sign(`export:${digest}`, this.secret);
      appendAudit(database.pilot, "INSTITUTION_EXPORT_CREATED", generatedAt, { count: rows.length, digest });
      return { ...payload, integrity: { algorithm: "HMAC-SHA256", digest, signature } };
    });
  }

  status() {
    return {
      protocolId: P2_VALIDATION_PROTOCOL.id,
      consentVersion: P2_VALIDATION_PROTOCOL.consentVersion,
      retentionDays: P2_VALIDATION_PROTOCOL.retentionDays,
      secretMode: this.secretMode,
      persistentTokenReady: this.secretMode !== "ephemeral",
      pilotInviteRequired: this.pilotInviteRequired,
      storageBackend: "single-instance-atomic-file",
      multiInstanceReady: false
    };
  }

  #token(journeyId) {
    return `${journeyId}.${sign(journeyId, this.secret)}`;
  }

  #verifyToken(token) {
    const [journeyId, signature, extra] = String(token || "").split(".");
    if (!journeyId || !signature || extra) throw validationError("INVALID_TOKEN", 401, "유효하지 않은 여정 토큰입니다.");
    const expected = sign(journeyId, this.secret);
    const givenBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (givenBuffer.length !== expectedBuffer.length || !timingSafeEqual(givenBuffer, expectedBuffer)) {
      throw validationError("INVALID_TOKEN", 401, "유효하지 않은 여정 토큰입니다.");
    }
    return journeyId;
  }

  async #mutate(callback) {
    const operation = this.queue.then(async () => {
      const database = await this.#read();
      purgeExpired(database, this.now());
      const result = callback(database);
      await this.#write(database);
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async #read() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      return parsed?.schemaVersion === P2_VALIDATION_PROTOCOL.schemaVersion && Array.isArray(parsed.records)
        ? normalizeDatabase(parsed)
        : emptyDatabase();
    } catch (error) {
      if (error?.code === "ENOENT") return emptyDatabase();
      throw error;
    }
  }

  async #write(database) {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(database, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}

export async function loadOrCreateP2ValidationSecret(filePath) {
  try {
    const current = (await readFile(filePath, "utf8")).trim();
    if (current.length >= 32) return current;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const generated = randomBytes(48).toString("base64url");
  try {
    await writeFile(filePath, `${generated}\n`, { mode: 0o600, flag: "wx" });
    return generated;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const current = (await readFile(filePath, "utf8")).trim();
    if (current.length < 32) throw new Error("P2_VALIDATION_SECRET_TOO_SHORT");
    return current;
  }
}

export function validationError(code, statusCode, message) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}

export function verifyPilotExport(artifact, secret) {
  if (!artifact?.manifest || !Array.isArray(artifact?.rows) || !artifact?.integrity || !secret) return false;
  const payload = { manifest: artifact.manifest, rows: artifact.rows };
  const digest = exportDigest(payload);
  const signature = sign(`export:${digest}`, secret);
  return constantTimeEqual(digest, artifact.integrity.digest) && constantTimeEqual(signature, artifact.integrity.signature);
}

function emptyDatabase() {
  return {
    schemaVersion: P2_VALIDATION_PROTOCOL.schemaVersion,
    records: [],
    pilot: emptyPilotOperations()
  };
}

function emptyPilotOperations() {
  return {
    protocolId: P2B_PILOT_PROTOCOL.id,
    cohortId: P2B_PILOT_PROTOCOL.cohortId,
    phase: "READY",
    updatedAt: null,
    invitations: [],
    audit: [],
    counters: { withdrawn: 0, expiredRecords: 0 }
  };
}

function normalizeDatabase(database) {
  const pilot = database.pilot && typeof database.pilot === "object" ? database.pilot : emptyPilotOperations();
  return {
    ...database,
    pilot: {
      ...emptyPilotOperations(),
      ...pilot,
      invitations: Array.isArray(pilot.invitations) ? pilot.invitations : [],
      audit: Array.isArray(pilot.audit) ? pilot.audit : [],
      counters: { ...emptyPilotOperations().counters, ...(pilot.counters || {}) }
    }
  };
}

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function purgeExpired(database, now) {
  const cutoff = now.getTime() - P2_VALIDATION_PROTOCOL.retentionDays * DAY_MS;
  const expired = database.records.filter((record) => Date.parse(record.createdAt) < cutoff);
  if (!expired.length) return;
  const expiredRefs = new Set(expired.map((record) => record.pilot?.subjectRef).filter(Boolean));
  const expiredInvitationIds = new Set(expired.map((record) => record.pilot?.invitationId).filter(Boolean));
  database.records = database.records.filter((record) => Date.parse(record.createdAt) >= cutoff);
  database.pilot.audit = database.pilot.audit.filter((event) => !expiredRefs.has(event.subjectRef));
  for (const invitation of database.pilot.invitations) {
    if (!expiredInvitationIds.has(invitation.id)) continue;
    invitation.status = "RECORD_EXPIRED";
    invitation.subjectRef = null;
  }
  database.pilot.counters.expiredRecords += expired.length;
  appendAudit(database.pilot, "RETENTION_PURGE", now.toISOString(), { count: expired.length });
}

function assertEventWindow(record, now, eventType) {
  const scheduledArrival = Date.parse(record.prediction.scheduledArrival);
  const candidate = record.prediction.candidates.find((item) => item.id === record.prediction.plannedTrainId);
  const trainDeparture = Date.parse(candidate?.departureTime);
  const earliest = eventType === "PLATFORM_ARRIVED"
    ? scheduledArrival - MAX_EARLY_EVENT_MS
    : trainDeparture - MAX_EARLY_EVENT_MS;
  const latest = trainDeparture + MAX_LATE_EVENT_MS;
  if (now.getTime() < earliest) throw validationError("EVENT_TOO_EARLY", 409, "실제 이동 시각이 되면 기록할 수 있습니다.");
  if (now.getTime() > latest) throw validationError("EVENT_TOO_LATE", 409, "이 여정의 현장 기록 가능 기간이 지났습니다.");
}

function isExistingEvent(record, eventType) {
  if (eventType === "PLATFORM_ARRIVED") return Boolean(record.observations.platformArrivedAt);
  if (eventType === "TRAIN_BOARDED") return record.observations.boardingOutcome === "BOARDED";
  if (eventType === "TRAIN_MISSED") return record.observations.boardingOutcome === "MISSED";
  return false;
}

function publicSession(record) {
  const candidate = record.prediction.candidates.find((item) => item.id === record.prediction.plannedTrainId);
  return {
    journeyId: record.journeyId.slice(0, 8),
    createdAt: record.createdAt,
    expiresAt: new Date(Date.parse(record.createdAt) + P2_VALIDATION_PROTOCOL.retentionDays * DAY_MS).toISOString(),
    modelVersion: record.prediction.modelVersion,
    policyId: record.prediction.policyId,
    plannedTrainId: record.prediction.plannedTrainId,
    policySelectedTrainId: record.prediction.policySelectedTrainId,
    trainDepartureTime: candidate?.departureTime || null,
    pilotCohortId: record.pilot?.cohortId || null,
    participantMatchCode: record.pilot?.participantMatchCode || null,
    institutionMatchEnabled: Boolean(record.pilot?.institutionMatchEnabled),
    platformArrived: Boolean(record.observations.platformArrivedAt),
    boardingOutcome: record.observations.boardingOutcome,
    status: record.observations.boardingOutcome ? "COMPLETE" : record.observations.platformArrivedAt ? "PLATFORM_RECORDED" : "TRACKING"
  };
}

function authorizeInvitation(pilot, code, nowIso, secret) {
  if (pilot.phase !== "ENROLLING") {
    throw validationError("PILOT_NOT_ENROLLING", 409, pilot.phase === "PAUSED" ? "현재 파일럿 참여 접수가 잠시 중지되었습니다." : pilot.phase === "CLOSED" ? "파일럿 참여 접수가 종료되었습니다." : "파일럿 참여코드 발급 후 접수를 시작합니다.");
  }
  const normalized = normalizeInviteCode(code);
  if (!normalized) throw validationError("PILOT_CODE_REQUIRED", 400, "현장에서 받은 참여코드를 입력해 주세요.");
  const digest = inviteDigest(normalized, secret);
  const invitation = pilot.invitations.find((candidate) => constantTimeEqual(candidate.codeDigest, digest));
  if (!invitation) throw validationError("INVALID_PILOT_CODE", 401, "참여코드를 확인해 주세요.");
  if (Date.parse(invitation.expiresAt) < Date.parse(nowIso)) {
    invitation.status = "EXPIRED";
    throw validationError("EXPIRED_PILOT_CODE", 410, "참여코드 사용기간이 지났습니다.");
  }
  if (invitation.status !== "ISSUED") throw validationError("PILOT_CODE_USED", 409, "이미 사용했거나 취소된 참여코드입니다.");
  return invitation;
}

function buildPilotOperationsStatus(database, report, now, includePrivate) {
  const invitations = database.pilot.invitations;
  const availableInvites = invitations.filter((invite) => invite.status === "ISSUED" && Date.parse(invite.expiresAt) >= now.getTime()).length;
  const expiredInvites = invitations.filter((invite) => invite.status === "EXPIRED" || (invite.status === "ISSUED" && Date.parse(invite.expiresAt) < now.getTime())).length;
  const completed = report.counts.boardingOutcomes;
  const overdue = database.records.filter((record) => {
    if (record.observations?.boardingOutcome) return false;
    const candidate = record.prediction?.candidates?.find((item) => item.id === record.prediction.plannedTrainId);
    return Number.isFinite(Date.parse(candidate?.departureTime)) && now.getTime() > Date.parse(candidate.departureTime) + P2B_PILOT_PROTOCOL.outcomeDueHours * 60 * MINUTE_MS;
  }).length;
  const expiringSoon = database.records.filter((record) => {
    const expiresAt = Date.parse(record.createdAt) + P2_VALIDATION_PROTOCOL.retentionDays * DAY_MS;
    return expiresAt >= now.getTime() && expiresAt <= now.getTime() + 72 * 60 * MINUTE_MS;
  }).length;
  const consentIntegrityFailures = database.records.filter((record) => record.consent?.noticeDigest !== pilotConsentDigest() || !record.consent?.scopes?.includes(P2B_PILOT_PROTOCOL.consent.essentialScope)).length;
  const institutionMatchEligible = database.records.filter((record) => record.consent?.scopes?.includes(P2B_PILOT_PROTOCOL.consent.institutionMatchScope) && record.pilot?.participantMatchCode).length;
  const phase = database.pilot.phase;
  const alerts = [];
  if (phase === "ENROLLING" && availableInvites === 0) alerts.push({ severity: "HIGH", code: "NO_AVAILABLE_INVITES", message: "접수 중이지만 사용할 수 있는 참여코드가 없습니다." });
  if (overdue > 0) alerts.push({ severity: "HIGH", code: "OVERDUE_OUTCOMES", message: `탑승 결과 입력 기한이 지난 여정이 ${overdue}건 있습니다.` });
  if (consentIntegrityFailures > 0) alerts.push({ severity: "CRITICAL", code: "CONSENT_INTEGRITY", message: `동의문 무결성 확인에 실패한 여정이 ${consentIntegrityFailures}건 있습니다.` });
  if (report.quality.status === "BLOCKED") alerts.push({ severity: "CRITICAL", code: "DATA_QUALITY_BLOCKED", message: "실측 데이터 품질 오류로 성능 공유가 차단되었습니다." });
  const status = {
    protocol: P2B_PILOT_PROTOCOL,
    phase,
    phaseLabel: P2B_PILOT_PROTOCOL.phaseLabels[phase],
    generatedAt: now.toISOString(),
    admission: {
      inviteRequired: true,
      issued: invitations.length,
      available: availableInvites,
      redeemed: invitations.filter((invite) => invite.status === "REDEEMED").length,
      expired: expiredInvites,
      withdrawn: database.pilot.counters.withdrawn
    },
    operations: {
      enrolled: report.counts.enrolled,
      completed,
      inProgress: Math.max(0, report.counts.enrolled - completed),
      overdueOutcomes: overdue,
      expiringWithin72Hours: expiringSoon,
      completionRate: report.counts.enrolled ? roundPilot(completed / report.counts.enrolled) : 0,
      platformCaptureRate: report.counts.enrolled ? roundPilot(report.counts.platformArrivals / report.counts.enrolled) : 0,
      institutionMatchEligible
    },
    readiness: {
      admissionControl: phase === "ENROLLING" && availableInvites > 0 ? "PASS" : "WAITING",
      consentIntegrity: consentIntegrityFailures === 0 ? "PASS" : "BLOCKED",
      dataQuality: report.quality.status === "BLOCKED" ? "BLOCKED" : "PASS",
      outcomeFollowUp: overdue === 0 ? "PASS" : "ACTION_REQUIRED",
      institutionMatching: institutionMatchEligible > 0 ? "READY_WITH_CONSENT" : "WAITING_FOR_OPT_IN",
      targetProgress: `${completed}/${P2B_PILOT_PROTOCOL.targetCompletedJourneys}`
    },
    alerts,
    privacy: "운영 현황에는 개인식별정보·여정 ID·참여코드 원문을 포함하지 않습니다.",
    limitations: [
      "현재 파일 저장 방식은 단일 서버 파일럿용이며 다중 인스턴스 공개 배포 전 관리형 데이터베이스 전환이 필요합니다.",
      "기관 대조자료와의 실제 결합은 아직 수행하지 않았습니다."
    ]
  };
  if (includePrivate) {
    status.private = {
      audit: database.pilot.audit.slice(-200),
      invitationStates: invitations.reduce((states, invite) => ({ ...states, [invite.status]: (states[invite.status] || 0) + 1 }), {})
    };
  }
  return status;
}

function institutionExportRow(record) {
  const candidate = record.prediction.candidates.find((item) => item.id === record.prediction.plannedTrainId);
  return {
    participantMatchCode: record.pilot.participantMatchCode,
    cohortId: record.pilot.cohortId,
    consentVersion: record.consent.version,
    consentNoticeDigest: record.consent.noticeDigest,
    predictionRecordedAt: record.prediction.recordedAt,
    scheduledArrival: record.prediction.scheduledArrival,
    modelVersion: record.prediction.modelVersion,
    policyId: record.prediction.policyId,
    plannedTrainId: record.prediction.plannedTrainId,
    trainDepartureTime: candidate?.departureTime || null,
    modelProbability: candidate?.modelProbability ?? null,
    fusedProbability: candidate?.fusedProbability ?? null,
    platformP50Minutes: candidate?.platformP50Minutes ?? null,
    platformP90Minutes: candidate?.platformP90Minutes ?? null,
    accessibilityNeeds: Boolean(record.prediction.context?.accessibilityNeeds),
    disrupted: (record.prediction.context?.flightDelayMinutes || 0) >= 30 || (record.prediction.context?.weatherSeverity || 0) >= 1 || (record.prediction.context?.immigrationSeverity || 0) >= 1,
    platformArrivedAt: record.observations?.platformArrivedAt || null,
    boardingOutcome: record.observations?.boardingOutcome || null,
    outcomeRecordedAt: record.observations?.outcomeRecordedAt || null
  };
}

function appendAudit(pilot, type, occurredAt, details = {}) {
  pilot.audit.push({
    eventId: randomUUID(),
    type,
    occurredAt,
    ...details
  });
  if (pilot.audit.length > PILOT_AUDIT_LIMIT) pilot.audit.splice(0, pilot.audit.length - PILOT_AUDIT_LIMIT);
}

function allowedPhaseTransition(previous, next) {
  if (previous === next) return true;
  const allowed = {
    READY: ["ENROLLING", "CLOSED"],
    ENROLLING: ["PAUSED", "CLOSED"],
    PAUSED: ["ENROLLING", "CLOSED"],
    CLOSED: []
  };
  return allowed[previous]?.includes(next) || false;
}

function pilotConsentDigest() {
  return createHash("sha256")
    .update(`${P2_VALIDATION_PROTOCOL.consentVersion}\n${P2B_PILOT_PROTOCOL.consent.essentialNotice}\n${P2B_PILOT_PROTOCOL.consent.institutionMatchNotice}`)
    .digest("hex");
}

function inviteDigest(code, secret) {
  return sign(`invite:${normalizeInviteCode(code)}`, secret);
}

function normalizeInviteCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
}

function humanCode(prefix) {
  const bytes = randomBytes(8);
  const body = Array.from(bytes, (value) => INVITE_ALPHABET[value % INVITE_ALPHABET.length]).join("");
  return `${prefix}-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

function exportDigest(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sanitizeOperatorNote(value) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 160);
}

function roundPilot(value) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}
