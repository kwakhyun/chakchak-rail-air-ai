import handler from "vinext/server/app-router-entry";
import { createGuideAnswer, createJourneyGuidance, openAIStatus } from "../lib/openai.mjs";
import { buildDataFusion, publicDataStatus } from "../lib/public-data.mjs";
import { chakchakModelStatus, predictChakchakJourney } from "../src/chakchak-ai.js";

interface AssetsFetcher { fetch(input: Request): Promise<Response>; }
interface Env {
  ASSETS: AssetsFetcher;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  DATA_GO_KR_API_KEY?: string;
  TOUR_API_KEY?: string;
  KORAIL_OPEN_API_ENABLED?: string;
  [key: string]: unknown;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});

async function readBody(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 32_768) throw Object.assign(new Error("PAYLOAD_TOO_LARGE"), { status: 413 });
  try {
    return await request.json() as Record<string, any>;
  } catch {
    throw Object.assign(new Error("INVALID_JSON"), { status: 400 });
  }
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
    return json({
      ok: true,
      service: "CHAK² public service",
      dataMode: publicDataStatus(env as any).publicDataConfigured ? "live-ready" : "hybrid-demo",
      publicData: publicDataStatus(env as any),
      ai: openAIStatus(env as any),
      chakchakAI: chakchakModelStatus(),
      realWorldValidation: validationStatus(),
      fieldPilot: { phase: "READY", phaseLabel: "참여 준비 중" },
      now: new Date().toISOString()
    });
  }

  if (url.pathname === "/api/data/fusion" && request.method === "GET") {
    const flightId = (url.searchParams.get("flight") || "KE704").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    const targetDateTime = url.searchParams.get("at") || "2026-08-12T17:05:00+09:00";
    return json(await buildDataFusion({ flightId, targetDateTime }, { env: env as any }));
  }

  if (url.pathname === "/api/chakchak/predict" && request.method === "POST") {
    try {
      return json(predictChakchakJourney(compactModelInput(await readBody(request))));
    } catch (error: any) {
      return json({ error: "착착 자체 모델 입력을 확인해 주세요.", code: error?.message || "CHAKCHAK_MODEL_ERROR" }, 400);
    }
  }

  if ((url.pathname === "/api/ai/guide" || url.pathname === "/api/ai/concierge") && request.method === "POST") {
    try {
      const body = await readBody(request);
      const result = url.pathname.endsWith("guide")
        ? await createGuideAnswer(body, { env: env as any, clientToken: String(body.clientToken || "anonymous-guide").slice(0, 120) })
        : await createJourneyGuidance(body, { env: env as any, clientToken: String(body.clientToken || "anonymous-demo").slice(0, 120) });
      return json({
        ...result,
        source: result.mode === "live" ? "OpenAI Responses API + 착착 자체 모델" : "착착 자체 모델 기반 기본 안내",
        privacy: "이름·연락처·예약번호를 전송하거나 저장하지 않습니다."
      });
    } catch (error: any) {
      return json({ error: "AI 안내를 준비하지 못했습니다.", code: error?.message || "AI_REQUEST_ERROR" }, error?.status || 500);
    }
  }

  if (url.pathname === "/api/validation/status" && request.method === "GET") return json(validationStatus());
  if (url.pathname === "/api/pilot/status" && request.method === "GET") return json(pilotStatus());
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
    if (apiResponse) return apiResponse;

    const assetUrl = new URL(request.url);
    if (assetUrl.pathname === "/") assetUrl.pathname = "/index.html";
    if (assetUrl.pathname === "/presentation" || assetUrl.pathname === "/presentation/") assetUrl.pathname = "/presentation/index.html";
    if (runtimeEnv.ASSETS) {
      const assetResponse = await runtimeEnv.ASSETS.fetch(new Request(assetUrl.toString(), { method: request.method, headers: request.headers }));
      if (assetResponse.status !== 404) return assetResponse;
    }
    return handler.fetch(request, runtimeEnv as any, ctx as any);
  }
};

export default worker;
