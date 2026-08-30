import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "./lib/env.mjs";
import { createFixedWindowRateLimiter, PUBLIC_SECURITY_HEADERS } from "./lib/http-security.mjs";
import { createGuideAnswer, createJourneyGuidance, openAIStatus } from "./lib/openai.mjs";
import { P2ValidationStore, loadOrCreateP2ValidationSecret } from "./lib/p2-validation-store.mjs";
import { buildDataFusion, publicDataStatus } from "./lib/public-data.mjs";
import { chakchakModelStatus, predictChakchakJourney } from "./src/chakchak-ai.js";

const root = fileURLToPath(new URL(".", import.meta.url));
await loadLocalEnv(root);
const port = Number.parseInt(process.env.PORT || "4173", 10);
const aiRateLimiter = createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 });
const dataRateLimiter = createFixedWindowRateLimiter({ limit: 30, windowMs: 60_000 });
const predictionRateLimiter = createFixedWindowRateLimiter({ limit: 30, windowMs: 60_000 });
const validationRateLimiter = createFixedWindowRateLimiter({ limit: 30, windowMs: 60_000 });
const configuredValidationSecret = process.env.CHAKCHAK_VALIDATION_SECRET;
const validationSecret = configuredValidationSecret || await loadOrCreateP2ValidationSecret(resolve(root, "runtime/validation/token-secret"));
const configuredPilotAdminSecret = process.env.CHAKCHAK_PILOT_ADMIN_KEY;
const pilotAdminSecret = configuredPilotAdminSecret || await loadOrCreateP2ValidationSecret(resolve(root, "runtime/validation/admin-secret"));
const pilotInviteRequired = process.env.CHAKCHAK_PILOT_REQUIRE_INVITE !== "false";
const validationStore = new P2ValidationStore({
  filePath: resolve(root, process.env.CHAKCHAK_VALIDATION_STORE || "runtime/validation/journeys.json"),
  secret: validationSecret,
  secretMode: configuredValidationSecret ? "environment" : "local-generated",
  pilotInviteRequired
});
const host = process.env.HOST || "127.0.0.1";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp"
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    ...PUBLIC_SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function safePath(pathname) {
  const pagePath = pathname === "/"
    ? "/index.html"
    : pathname === "/presentation"
      ? "/presentation/index.html"
      : pathname.endsWith("/")
        ? `${pathname}index.html`
        : pathname;
  const relativePath = pagePath.replace(/^\//, "");
  const normalized = relativePath.startsWith("src/")
    ? relativePath
    : relativePath.startsWith("public/")
      ? relativePath
      : `public/${relativePath}`;
  const fullPath = resolve(root, normalized);
  return fullPath.startsWith(`${resolve(root)}${sep}`) ? fullPath : null;
}

async function readJsonBody(request, limitBytes = 32_768) {
  const mediaType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType.endsWith("+json")) {
    const error = new Error("UNSUPPORTED_MEDIA_TYPE");
    error.statusCode = 415;
    throw error;
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) {
      const error = new Error("PAYLOAD_TOO_LARGE");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("INVALID_JSON");
    error.statusCode = 400;
    throw error;
  }
}

function clientAddress(request) {
  const forwarded = process.env.TRUST_PROXY === "true" ? request.headers["x-forwarded-for"] : null;
  const candidate = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return (candidate || request.socket.remoteAddress || "local").trim().slice(0, 80);
}

function takeAiRateLimit(request) {
  return aiRateLimiter.take(clientAddress(request));
}

function takeDataRateLimit(request) {
  return dataRateLimiter.take(clientAddress(request));
}

function takePredictionRateLimit(request) {
  return predictionRateLimiter.take(clientAddress(request));
}

function takeValidationRateLimit(request) {
  return validationRateLimiter.take(clientAddress(request)).allowed;
}

function pilotAdminAuthorized(request) {
  const authorization = String(request.headers.authorization || "");
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(pilotAdminSecret);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function requirePilotAdmin(request, response) {
  if (pilotAdminAuthorized(request)) return true;
  response.setHeader("WWW-Authenticate", 'Bearer realm="chakchak-pilot-ops"');
  sendJson(response, 401, { error: "운영자 인증이 필요합니다.", code: "PILOT_ADMIN_REQUIRED" });
  return false;
}

function whitelistedGuidanceInput(body) {
  const selectedTrain = body?.selectedTrain || {};
  const originalTrain = body?.originalTrain || {};
  return {
    locale: body?.locale,
    scenario: body?.scenario,
    disruptionNote: body?.disruptionNote,
    probability: body?.probability,
    originalProbability: body?.originalProbability,
    recovered: body?.recovered,
    destination: body?.destination,
    interests: body?.interests,
    selectedTrain: {
      id: selectedTrain.id,
      service: selectedTrain.service,
      airportDeparture: selectedTrain.airportDeparture,
      railDeparture: selectedTrain.railDeparture,
      destinationArrival: selectedTrain.destinationArrival
    },
    originalTrain: {
      id: originalTrain.id,
      service: originalTrain.service
    }
  };
}

function whitelistedGuideInput(body) {
  const journey = body?.journey || {};
  const model = body?.model || {};
  const ticketProtection = body?.ticketProtection || {};
  return {
    question: typeof body?.question === "string" ? body.question.slice(0, 180) : "",
    activeView: body?.activeView,
    dataMode: body?.dataMode,
    journey: {
      origin: journey.origin,
      destination: journey.destination,
      checkedBags: journey.checkedBags,
      mobilitySupport: journey.mobilitySupport
    },
    ticketProtection: {
      hasBookedTicket: ticketProtection.hasBookedTicket,
      operators: Array.isArray(ticketProtection.operators)
        ? ticketProtection.operators.slice(0, 2).map((operator) => ({
          label: operator?.label,
          deadline: operator?.deadline,
          feeBand: operator?.feeBand,
          officialLabel: operator?.officialLabel
        }))
        : [],
      steps: Array.isArray(ticketProtection.steps) ? ticketProtection.steps.slice(0, 4) : [],
      disclaimer: ticketProtection.disclaimer
    },
    model: {
      boardingProbability: model.boardingProbability,
      riskLabel: model.riskLabel,
      platformP50: model.platformP50,
      platformP90: model.platformP90,
      selectedTrain: model.selectedTrain,
      airportRailDeparture: model.airportRailDeparture,
      trainDeparture: model.trainDeparture,
      destinationArrival: model.destinationArrival,
      recovered: model.recovered,
      fallbackRequired: model.fallbackRequired
    }
  };
}

function whitelistedChakchakInput(body) {
  const context = body?.context || {};
  const candidates = Array.isArray(body?.candidates) ? body.candidates.slice(0, 12) : [];
  return {
    scheduledArrival: typeof body?.scheduledArrival === "string" ? body.scheduledArrival.slice(0, 40) : "",
    context: {
      flightDelayMinutes: context.flightDelayMinutes,
      weatherSeverity: context.weatherSeverity,
      immigrationSeverity: context.immigrationSeverity,
      baggageDelayMinutes: context.baggageDelayMinutes,
      checkedBaggage: context.checkedBaggage,
      accessibilityNeeds: context.accessibilityNeeds,
      largeLuggage: context.largeLuggage,
      boardingBufferMinutes: context.boardingBufferMinutes,
      flightMode: context.flightMode,
      immigrationMode: context.immigrationMode,
      weatherMode: context.weatherMode
    },
    candidates: candidates.map((candidate) => ({
      id: String(candidate?.id || "").slice(0, 40),
      departureTime: typeof candidate?.departureTime === "string" ? candidate.departureTime.slice(0, 40) : "",
      destinationArrivalTime: typeof candidate?.destinationArrivalTime === "string" ? candidate.destinationArrivalTime.slice(0, 40) : undefined,
      accessibilityReady: typeof candidate?.accessibilityReady === "boolean" ? candidate.accessibilityReady : undefined
    }))
  };
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/health") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    const dataStatus = publicDataStatus();
    const aiStatus = openAIStatus();
    const validationReport = await validationStore.report();
    const pilot = await validationStore.pilotStatus();
    sendJson(response, 200, {
      ok: true,
      service: "CHAK² journey confidence demo",
      dataMode: dataStatus.publicDataConfigured && dataStatus.tagoRecovery.mode !== "automatic-fallback"
        ? "live-ready"
        : "hybrid-demo",
      publicData: dataStatus,
      ai: aiStatus,
      chakchakAI: chakchakModelStatus(),
      realWorldValidation: {
        ...validationStore.status(),
        evidence: validationReport.evidence,
        counts: validationReport.counts,
        realWorldPerformanceAvailable: validationReport.realWorldPerformanceAvailable
      },
      fieldPilot: {
        phase: pilot.phase,
        phaseLabel: pilot.phaseLabel,
        targetProgress: pilot.readiness.targetProgress,
        inviteControl: pilot.readiness.admissionControl,
        adminKeyMode: configuredPilotAdminSecret ? "environment" : "local-generated"
      },
      now: new Date().toISOString()
    });
    return true;
  }

  if (url.pathname === "/api/data/fusion") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    const rate = takeDataRateLimit(request);
    if (!rate.allowed) {
      response.setHeader("Retry-After", String(rate.retryAfterSeconds || 60));
      sendJson(response, 429, { error: "요청이 많습니다. 잠시 후 다시 시도해 주세요.", code: "RATE_LIMIT" });
      return true;
    }
    const flightId = (url.searchParams.get("flight") || "KE704").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    const targetDateTime = url.searchParams.get("at")?.slice(0, 40) || undefined;
    const fusion = await buildDataFusion({ flightId, targetDateTime });
    sendJson(response, 200, fusion);
    return true;
  }

  if (url.pathname === "/api/live/arrival") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    const rate = takeDataRateLimit(request);
    if (!rate.allowed) {
      response.setHeader("Retry-After", String(rate.retryAfterSeconds || 60));
      sendJson(response, 429, { error: "요청이 많습니다. 잠시 후 다시 시도해 주세요.", code: "RATE_LIMIT" });
      return true;
    }
    const flightId = (url.searchParams.get("flight") || "KE704").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    const fusion = await buildDataFusion({ flightId });
    const source = fusion.sources.find((item) => item.id === "incheon-flight");
    sendJson(response, 200, { mode: source?.mode || "demo", flightId, source });
    return true;
  }

  if (url.pathname === "/api/ai/concierge") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    const rate = takeAiRateLimit(request);
    if (!rate.allowed) {
      response.setHeader("Retry-After", "60");
      sendJson(response, 429, { error: "잠시 후 다시 시도해 주세요.", code: "RATE_LIMIT" });
      return true;
    }

    try {
      const body = await readJsonBody(request);
      const result = await createJourneyGuidance(whitelistedGuidanceInput(body), {
        clientToken: typeof body.clientToken === "string" ? body.clientToken : "anonymous-demo"
      });
      sendJson(response, 200, {
        ...result,
        responseId: undefined,
        source: result.mode === "live" ? "OpenAI Responses API" : "검증된 기본 안내",
        privacy: "이름·연락처·예약번호를 전송하거나 저장하지 않습니다."
      });
    } catch (error) {
      sendJson(response, error?.statusCode || 500, {
        error: error?.statusCode === 413 ? "요청 내용이 너무 깁니다." : error?.statusCode === 415 ? "JSON 형식의 요청만 받을 수 있습니다." : error?.statusCode === 400 ? "요청 형식을 확인해 주세요." : "AI 안내를 준비하지 못했습니다.",
        code: error?.message || "AI_REQUEST_ERROR"
      });
    }
    return true;
  }

  if (url.pathname === "/api/ai/guide") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    const rate = takeAiRateLimit(request);
    if (!rate.allowed) {
      response.setHeader("Retry-After", "60");
      sendJson(response, 429, { error: "잠시 후 다시 물어봐 주세요.", code: "RATE_LIMIT" });
      return true;
    }
    try {
      const body = await readJsonBody(request);
      const result = await createGuideAnswer(whitelistedGuideInput(body), {
        clientToken: typeof body.clientToken === "string" ? body.clientToken : "anonymous-guide"
      });
      sendJson(response, 200, {
        ...result,
        source: result.mode === "live" ? "OpenAI Responses API + 착착 자체 모델" : "착착 자체 모델 기반 기본 안내",
        privacy: "질문 속 연락처·이메일·긴 번호를 가리고, 이름·예약번호를 저장하지 않습니다."
      });
    } catch (error) {
      sendJson(response, error?.statusCode || 500, {
        error: error?.statusCode === 413 ? "질문이 너무 깁니다." : error?.statusCode === 415 ? "JSON 형식의 요청만 받을 수 있습니다." : error?.statusCode === 400 ? "질문 내용을 확인해 주세요." : "AI 가이드 답변을 준비하지 못했습니다.",
        code: error?.message || "AI_GUIDE_ERROR"
      });
    }
    return true;
  }

  if (url.pathname === "/api/chakchak/predict") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    const rate = takePredictionRateLimit(request);
    if (!rate.allowed) {
      response.setHeader("Retry-After", String(rate.retryAfterSeconds || 60));
      sendJson(response, 429, { error: "요청이 많습니다. 잠시 후 다시 시도해 주세요.", code: "RATE_LIMIT" });
      return true;
    }
    try {
      const body = await readJsonBody(request);
      const prediction = predictChakchakJourney(whitelistedChakchakInput(body));
      sendJson(response, 200, prediction);
    } catch (error) {
      const status = error?.statusCode || (error instanceof RangeError || error instanceof TypeError ? 400 : 500);
      sendJson(response, status, {
        error: status === 413 ? "요청 내용이 너무 깁니다." : status === 415 ? "JSON 형식의 요청만 받을 수 있습니다." : "착착 자체 모델 입력을 확인해 주세요.",
        code: error?.message || "CHAKCHAK_MODEL_ERROR"
      });
    }
    return true;
  }

  if (url.pathname === "/api/validation/status") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    const report = await validationStore.report();
    sendJson(response, 200, { ...report, storage: validationStore.status() });
    return true;
  }

  if (url.pathname === "/api/pilot/status") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    sendJson(response, 200, await validationStore.pilotStatus());
    return true;
  }

  if (url.pathname === "/api/pilot/admin/status") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    if (!requirePilotAdmin(request, response)) return true;
    sendJson(response, 200, await validationStore.pilotStatus({ includePrivate: true }));
    return true;
  }

  if (url.pathname === "/api/pilot/admin/invites") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    if (!requirePilotAdmin(request, response)) return true;
    try {
      const body = await readJsonBody(request);
      sendJson(response, 201, await validationStore.issuePilotInvites({ count: body?.count, validityDays: body?.validityDays }));
    } catch (error) {
      sendJson(response, error?.statusCode || 500, { error: error?.publicMessage || "참여코드를 만들지 못했습니다.", code: error?.code || "PILOT_INVITE_ERROR" });
    }
    return true;
  }

  if (url.pathname === "/api/pilot/admin/phase") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    if (!requirePilotAdmin(request, response)) return true;
    try {
      const body = await readJsonBody(request);
      sendJson(response, 200, await validationStore.transitionPilotPhase(body?.phase, body?.reason));
    } catch (error) {
      sendJson(response, error?.statusCode || 500, { error: error?.publicMessage || "파일럿 운영 단계를 바꾸지 못했습니다.", code: error?.code || "PILOT_PHASE_ERROR" });
    }
    return true;
  }

  if (url.pathname === "/api/pilot/admin/export") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    if (!requirePilotAdmin(request, response)) return true;
    response.setHeader("Content-Disposition", `attachment; filename="chakchak-pilot-institution-match-${new Date().toISOString().slice(0, 10)}.json"`);
    sendJson(response, 200, await validationStore.exportInstitutionMatch());
    return true;
  }

  if (url.pathname === "/api/validation/enroll") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    if (!takeValidationRateLimit(request)) {
      sendJson(response, 429, { error: "잠시 후 다시 시도해 주세요.", code: "RATE_LIMIT" });
      return true;
    }
    try {
      const body = await readJsonBody(request);
      if (pilotInviteRequired) {
        const pilot = await validationStore.pilotStatus();
        if (pilot.phase !== "ENROLLING") {
          const message = pilot.phase === "PAUSED" ? "현재 파일럿 참여 접수가 잠시 중지되었습니다." : pilot.phase === "CLOSED" ? "파일럿 참여 접수가 종료되었습니다." : "파일럿 참여코드 발급 후 접수를 시작합니다.";
          sendJson(response, 409, { error: message, code: "PILOT_NOT_ENROLLING" });
          return true;
        }
        if (typeof body?.pilotCode !== "string" || !body.pilotCode.trim()) {
          sendJson(response, 400, { error: "현장에서 받은 참여코드를 입력해 주세요.", code: "PILOT_CODE_REQUIRED" });
          return true;
        }
      }
      const input = whitelistedChakchakInput(body);
      const prediction = predictChakchakJourney(input);
      const enrollment = await validationStore.enroll({
        consent: body?.consent === true,
        institutionMatchConsent: body?.institutionMatchConsent === true,
        pilotCode: typeof body?.pilotCode === "string" ? body.pilotCode.slice(0, 32) : "",
        input,
        prediction,
        plannedTrainId: String(body?.plannedTrainId || prediction.recommendation.selectedTrainId).slice(0, 40)
      });
      sendJson(response, 201, {
        ...enrollment,
        privacy: "성명·연락처·예약번호·항공편 번호·IP를 저장하지 않습니다. 언제든 이 여정 전체를 삭제할 수 있습니다."
      });
    } catch (error) {
      sendJson(response, error?.statusCode || (error instanceof RangeError || error instanceof TypeError ? 400 : 500), {
        error: error?.publicMessage || "익명 실측 검증을 시작하지 못했습니다.",
        code: error?.code || error?.message || "VALIDATION_ENROLL_ERROR"
      });
    }
    return true;
  }

  if (url.pathname === "/api/validation/observe" || url.pathname === "/api/validation/session" || url.pathname === "/api/validation/withdraw") {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    if (!takeValidationRateLimit(request)) {
      sendJson(response, 429, { error: "잠시 후 다시 시도해 주세요.", code: "RATE_LIMIT" });
      return true;
    }
    try {
      const body = await readJsonBody(request);
      if (url.pathname === "/api/validation/observe") {
        const result = await validationStore.observe({
          token: body?.token,
          eventType: String(body?.eventType || ""),
          trainId: body?.trainId
        });
        sendJson(response, 200, result);
      } else if (url.pathname === "/api/validation/session") {
        sendJson(response, 200, { session: await validationStore.session(body?.token) });
      } else {
        sendJson(response, 200, await validationStore.withdraw(body?.token));
      }
    } catch (error) {
      sendJson(response, error?.statusCode || 500, {
        error: error?.publicMessage || "실측 검증 기록을 처리하지 못했습니다.",
        code: error?.code || error?.message || "VALIDATION_EVENT_ERROR"
      });
    }
    return true;
  }

  return false;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApi(request, response, url);
    if (!handled) sendJson(response, 404, { error: "API route not found" });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendJson(response, 405, { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const filePath = safePath(url.pathname);
    if (!filePath) {
      sendJson(response, 400, { error: "Invalid path" });
      return;
    }

    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) throw new Error("Not a file");
    const body = await readFile(filePath);
    response.writeHead(200, {
      ...PUBLIC_SECURITY_HEADERS,
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": /\.(?:js|css|html)$/.test(url.pathname) || url.pathname === "/" ? "no-cache" : "public, max-age=300"
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
});

server.listen(port, host, () => {
  console.log(`CHAK² demo ready at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
