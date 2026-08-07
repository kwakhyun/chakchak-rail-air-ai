import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGuideFallback,
  buildFallbackGuidance,
  createGuideAnswer,
  createJourneyGuidance,
  openAIStatus,
  validateGuideAnswer,
  validateGuidance
} from "../lib/openai.mjs";

const INPUT = {
  locale: "ko",
  scenario: "폭우 지연",
  disruptionNote: "비행기 도착이 35분 늦어졌어요.",
  probability: 99,
  originalProbability: 6,
  recovered: true,
  destination: "전주",
  interests: ["로컬 음식", "전통문화"],
  selectedTrain: {
    id: "KTX-423",
    service: "KTX 423",
    airportDeparture: "20:48",
    railDeparture: "22:12",
    destinationArrival: "23:54"
  },
  originalTrain: { id: "KTX-419", service: "KTX 419" }
};

const GUIDE_INPUT = {
  question: "왜 이 열차를 추천했어?",
  activeView: "routes",
  dataMode: "hybrid-demo",
  journey: { origin: "도쿄", destination: "전주", checkedBags: 1, mobilitySupport: false },
  model: {
    boardingProbability: 95,
    riskLabel: "여유 있어요",
    platformP50: "18:04",
    platformP90: "18:43",
    selectedTrain: "KTX 419",
    airportRailDeparture: "18:48",
    trainDeparture: "20:12",
    destinationArrival: "21:54",
    recovered: false,
    fallbackRequired: false
  },
  ticketProtection: {
    hasBookedTicket: true,
    operators: [
      { label: "KTX·코레일 승차권", deadline: "출발 전 바로 확인", feeBand: "운임의 약 5~30% 가능", officialLabel: "코레일 반환 기준 확인" },
      { label: "공항철도 직통열차", deadline: "출발 전 반환 가능 여부 확인", feeBand: "약 1천원 가능", officialLabel: "공항철도 반환 기준 확인" }
    ],
    steps: ["대체편 좌석·이동조건 확인", "기존 표의 반환 마감·예상 부담 확인", "새 표 확보가 확실할 때 기존 표 처리"],
    disclaimer: "착착은 승차권을 자동으로 취소하거나 다시 예매하지 않습니다."
  }
};

test("fallback guidance stays useful and multilingual without an API key", () => {
  const korean = buildFallbackGuidance(INPUT);
  const english = buildFallbackGuidance({ ...INPUT, locale: "en" });

  assert.match(korean.summary, /99%/);
  assert.equal(korean.steps.length, 3);
  assert.match(english.summary, /99%/);
  assert.equal(validateGuidance(korean), true);
  assert.deepEqual(openAIStatus({}), { configured: false, model: "gpt-5.6-luna" });
});

test("Responses API request pins Luna, privacy, and strict structured output", async () => {
  let requestBody;
  const guidance = buildFallbackGuidance(INPUT);
  const result = await createJourneyGuidance(INPUT, {
    env: { OPENAI_API_KEY: "test-only-key", OPENAI_MODEL: "gpt-5.6-luna" },
    clientToken: "browser-session-123",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.match(options.headers.Authorization, /^Bearer /);
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          id: "resp_test",
          model: "gpt-5.6-luna",
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(guidance) }] }]
        })
      };
    }
  });

  assert.equal(result.mode, "live");
  assert.equal(result.model, "gpt-5.6-luna");
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.reasoning.effort, "low");
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal(requestBody.text.format.strict, true);
  assert.match(requestBody.safety_identifier, /^chakchak_[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(requestBody).includes("test-only-key"), false);
});

test("invalid model output falls back without leaking upstream details", async () => {
  const result = await createJourneyGuidance(INPUT, {
    env: { OPENAI_API_KEY: "test-only-key" },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text: "not-json" }] }] })
    })
  });

  assert.equal(result.mode, "fallback");
  assert.equal(result.reasonCode, "INVALID_RESPONSE");
  assert.equal(validateGuidance(result.guidance), true);
});

test("AI guide fallback explains only supplied CHAK² model facts", () => {
  const answer = buildGuideFallback(GUIDE_INPUT);
  assert.match(answer.answer, /KTX 419/);
  assert.match(answer.answer, /95%/);
  assert.equal(answer.relatedView, "routes");
  assert.equal(validateGuideAnswer(answer), true);
});

test("AI guide는 예매한 승차권의 운영사별 반환 구간과 안전 순서만 안내한다", () => {
  const answer = buildGuideFallback({ ...GUIDE_INPUT, question: "예매한 표를 놓칠 것 같은데 환불은 어떻게 해?" });
  assert.match(answer.answer, /KTX·코레일 승차권/);
  assert.match(answer.answer, /공항철도 직통열차/);
  assert.match(answer.answer, /5~30%/);
  assert.deepEqual(answer.actions, GUIDE_INPUT.ticketProtection.steps);
  assert.match(answer.disclaimer, /자동으로 취소하거나 다시 예매하지 않습니다/);
});

test("AI guide blocks unrelated questions before calling OpenAI", async () => {
  let called = false;
  const result = await createGuideAnswer({ ...GUIDE_INPUT, question: "오늘 주식 종목을 추천해줘" }, {
    env: { OPENAI_API_KEY: "test-only-key" },
    fetchImpl: async () => {
      called = true;
      throw new Error("must not call");
    }
  });
  assert.equal(called, false);
  assert.equal(result.mode, "guarded");
  assert.equal(result.answer.relatedView, "none");
});

test("AI guide uses strict structured output without changing model facts", async () => {
  let requestBody;
  const answer = buildGuideFallback(GUIDE_INPUT);
  const result = await createGuideAnswer(GUIDE_INPUT, {
    env: { OPENAI_API_KEY: "test-only-key", OPENAI_MODEL: "gpt-5.6-luna" },
    clientToken: "guide-session-123",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          model: "gpt-5.6-luna",
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }]
        })
      };
    }
  });
  assert.equal(result.mode, "live");
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.text.format.name, "chakchak_ai_guide_answer");
  assert.equal(requestBody.text.format.strict, true);
  assert.match(requestBody.safety_identifier, /^chakchak_guide_[a-f0-9]{32}$/);
  assert.match(requestBody.input, /KTX 419/);
  assert.equal(JSON.stringify(requestBody).includes("test-only-key"), false);
});
