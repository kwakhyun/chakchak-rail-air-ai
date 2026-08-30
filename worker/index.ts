import handler from "vinext/server/app-router-entry";
import { createFixedWindowRateLimiter, readJsonBodyLimited, withSecurityHeaders } from "../lib/http-security.mjs";
import { createGuideAnswer, createJourneyGuidance, openAIStatus } from "../lib/openai.mjs";
import { buildDataFusion, publicDataStatus } from "../lib/public-data.mjs";
import { chakchakModelStatus, predictChakchakJourney } from "../src/chakchak-ai.js";

interface AssetsFetcher { fetch(input: Request): Promise<Response>; }
interface RateLimitBinding { limit(input: { key: string }): Promise<{ success: boolean }>; }
interface Env {
  ASSETS: AssetsFetcher;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  ENABLE_PUBLIC_AI?: string;
  PUBLIC_API_RATE_LIMITER?: RateLimitBinding;
  DATA_GO_KR_API_KEY?: string;
  TOUR_API_KEY?: string;
  KORAIL_OPEN_API_ENABLED?: string;
  [key: string]: unknown;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const aiRateLimiter = createFixedWindowRateLimiter({ limit: 10, windowMs: 60_000 });
const dataRateLimiter = createFixedWindowRateLimiter({ limit: 30, windowMs: 60_000 });
const predictionRateLimiter = createFixedWindowRateLimiter({ limit: 30, windowMs: 60_000 });

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});

function clientAddress(request: Request) {
  const forwarded = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0];
  return String(forwarded || "anonymous").trim().slice(0, 80);
}

async function takeRateLimit(request: Request, env: Env, scope: "ai" | "data" | "prediction") {
  const key = `${scope}:${clientAddress(request)}`;
  if (env.PUBLIC_API_RATE_LIMITER) {
    try {
      const result = await env.PUBLIC_API_RATE_LIMITER.limit({ key });
      return { allowed: result.success, retryAfterSeconds: result.success ? 0 : 60, mode: "durable" };
    } catch {
      return { allowed: false, retryAfterSeconds: 60, mode: "durable-unavailable" };
    }
  }
  const limiter = scope === "ai" ? aiRateLimiter : scope === "data" ? dataRateLimiter : predictionRateLimiter;
  return { ...limiter.take(key), mode: "edge-instance" };
}

function publicAiRuntime(env: Env) {
  const liveEnabled = env.ENABLE_PUBLIC_AI === "true" && Boolean(env.OPENAI_API_KEY) && Boolean(env.PUBLIC_API_RATE_LIMITER);
  return {
    liveEnabled,
    env: {
      ...env,
      OPENAI_API_KEY: liveEnabled ? env.OPENAI_API_KEY : undefined
    }
  };
}

function rateLimited(retryAfterSeconds = 60) {
  const response = json({ error: "요청이 많습니다. 잠시 후 다시 시도해 주세요.", code: "RATE_LIMIT" }, 429);
  response.headers.set("retry-after", String(retryAfterSeconds));
  return response;
}

function methodNotAllowed(allowed: string) {
  const response = json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }, 405);
  response.headers.set("allow", allowed);
  return response;
}

function requestError(error: any, fallbackMessage: string, fallbackCode: string) {
  const status = Number(error?.status || error?.statusCode || 400);
  const messages: Record<number, string> = {
    400: "요청 형식을 확인해 주세요.",
    413: "요청 내용이 너무 깁니다.",
    415: "JSON 형식의 요청만 받을 수 있습니다."
  };
  return json({ error: messages[status] || fallbackMessage, code: error?.message || fallbackCode }, status);
}

function compactModelInput(body: Record<string, any>) {
  const context = body?.context || {};
  return {
    scheduledArrival: String(body?.scheduledArrival || "").slice(0, 40),
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
    candidates: Array.isArray(body?.candidates) ? body.candidates.slice(0, 12).map((candidate: any) => ({
      id: String(candidate?.id || "").slice(0, 40),
      departureTime: String(candidate?.departureTime || "").slice(0, 40),
      destinationArrivalTime: candidate?.destinationArrivalTime ? String(candidate.destinationArrivalTime).slice(0, 40) : undefined,
      accessibilityReady: typeof candidate?.accessibilityReady === "boolean" ? candidate.accessibilityReady : undefined
    })) : []
  };
}

function validationStatus() {
  return {
    evidence: { id: "COLLECTING", label: "실측 수집 준비", reason: "공개 서비스에서는 실제 참여 접수를 아직 열지 않았습니다." },
    counts: { enrolled: 0, boardingOutcomes: 0, platformArrivals: 0 },
    realWorldPerformanceAvailable: false,
    metrics: { suppressed: true },
    quality: { status: "READY" },
    segments: { accessibility: { completed: 0 }, disrupted: { completed: 0 } }
  };
}

function pilotStatus() {
  return {
    phase: "READY",
    phaseLabel: "참여 준비 중",
    admission: { inviteRequired: true, available: 0, issued: 0 },
    operations: { inProgress: 0, enrolled: 0, overdueOutcomes: 0, institutionMatchEligible: 0 },
    readiness: { admissionControl: "WAIT", consentIntegrity: "PASS", outcomeFollowUp: "PASS" },
    alerts: []
  };
}

async function api(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/health") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    const aiRuntime = publicAiRuntime(env);
    return json({
      ok: true,
      service: "CHAK² public service",
      dataMode: publicDataStatus(env as any).publicDataConfigured ? "live-ready" : "hybrid-demo",
      publicData: publicDataStatus(env as any),
      ai: {
        ...openAIStatus(aiRuntime.env as any),
        availability: aiRuntime.liveEnabled ? "live" : "grounded-fallback",
        protection: env.PUBLIC_API_RATE_LIMITER ? "durable-rate-limit" : "paid-ai-disabled-with-edge-limit"
      },
      chakchakAI: chakchakModelStatus(),
      realWorldValidation: validationStatus(),
      fieldPilot: { phase: "READY", phaseLabel: "참여 준비 중" },
      now: new Date().toISOString()
    });
  }

  if (url.pathname === "/api/data/fusion") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    const rate = await takeRateLimit(request, env, "data");
    if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);
    const flightId = (url.searchParams.get("flight") || "KE704").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    const targetDateTime = url.searchParams.get("at")?.slice(0, 40) || undefined;
    return json(await buildDataFusion({ flightId, targetDateTime }, { env: env as any }));
  }

  if (url.pathname === "/api/chakchak/predict") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    try {
      const rate = await takeRateLimit(request, env, "prediction");
      if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);
      return json(predictChakchakJourney(compactModelInput(await readJsonBodyLimited(request))));
    } catch (error: any) {
      return requestError(error, "착착 자체 모델 입력을 확인해 주세요.", "CHAKCHAK_MODEL_ERROR");
    }
  }

  if (url.pathname === "/api/ai/guide" || url.pathname === "/api/ai/concierge") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    try {
      const rate = await takeRateLimit(request, env, "ai");
      if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);
      const body = await readJsonBodyLimited(request) as Record<string, any>;
      const aiRuntime = publicAiRuntime(env);
      const result = url.pathname.endsWith("guide")
        ? await createGuideAnswer(body, { env: aiRuntime.env as any, clientToken: String(body.clientToken || "anonymous-guide").slice(0, 120) })
        : await createJourneyGuidance(body, { env: aiRuntime.env as any, clientToken: String(body.clientToken || "anonymous-demo").slice(0, 120) });
      return json({
        ...result,
        source: result.mode === "live" ? "OpenAI Responses API + 착착 자체 모델" : "착착 자체 모델 기반 기본 안내",
        privacy: "이름·연락처·예약번호를 전송하거나 저장하지 않습니다."
      });
    } catch (error: any) {
      if ([400, 413, 415].includes(Number(error?.status || error?.statusCode))) {
        return requestError(error, "AI 요청을 확인해 주세요.", "AI_REQUEST_ERROR");
      }
      return json({ error: "AI 안내를 준비하지 못했습니다.", code: error?.message || "AI_REQUEST_ERROR" }, 500);
    }
  }

  if (url.pathname === "/api/validation/status") {
    return request.method === "GET" ? json(validationStatus()) : methodNotAllowed("GET");
  }
  if (url.pathname === "/api/pilot/status") {
    return request.method === "GET" ? json(pilotStatus()) : methodNotAllowed("GET");
  }
  if (url.pathname.startsWith("/api/validation/") || url.pathname.startsWith("/api/pilot/")) {
    return json({ error: "공개 서비스에서는 실제 이동 기록 접수를 아직 열지 않았습니다.", code: "PILOT_NOT_ENROLLING" }, 409);
  }
  if (url.pathname.startsWith("/api/")) return json({ error: "API route not found" }, 404);
  return null;
}

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    const runtimeEnv = env || ({} as Env);
    const url = new URL(request.url);
    const apiResponse = await api(request, runtimeEnv, url);
    if (apiResponse) return withSecurityHeaders(apiResponse);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return withSecurityHeaders(methodNotAllowed("GET, HEAD"));
    }

    const assetUrl = new URL(request.url);
    if (assetUrl.pathname === "/") assetUrl.pathname = "/index.html";
    if (assetUrl.pathname === "/presentation" || assetUrl.pathname === "/presentation/") assetUrl.pathname = "/presentation/index.html";
    if (runtimeEnv.ASSETS) {
      const assetResponse = await runtimeEnv.ASSETS.fetch(new Request(assetUrl.toString(), { method: request.method, headers: request.headers }));
      if (assetResponse.status !== 404) return withSecurityHeaders(assetResponse);
    }
    return withSecurityHeaders(await handler.fetch(request, runtimeEnv as any, ctx as any));
  }
};

export default worker;
