import { createHash } from "node:crypto";

const DEFAULT_MODEL = "gpt-5.6-luna";
const SUPPORTED_LOCALES = new Set(["ko", "en", "ja", "zh"]);

const guidanceSchema = Object.freeze({
  type: "object",
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          detail: { type: "string" }
        },
        required: ["label", "detail"],
        additionalProperties: false
      }
    },
    tourismAdjustment: { type: "string" },
    disclaimer: { type: "string" }
  },
  required: ["headline", "summary", "steps", "tourismAdjustment", "disclaimer"],
  additionalProperties: false
});

const guideAnswerSchema = Object.freeze({
  type: "object",
  properties: {
    answer: { type: "string" },
    actions: { type: "array", items: { type: "string" } },
    relatedView: { type: "string", enum: ["journey", "routes", "travel", "validation", "about", "none"] },
    disclaimer: { type: "string" }
  },
  required: ["answer", "actions", "relatedView", "disclaimer"],
  additionalProperties: false
});

const GUIDE_TOPIC_PATTERN = /(착착|여정|공항|항공|입국|수하물|짐|날씨|철도|열차|기차|ktx|공항철도|환승|승강장|타는 곳|도착|출발|지연|늦|추천|가능성|일정|여행|관광|현장|기록|정보|데이터|출처|사용|도움|예매|승차권|열차표|티켓|표|반환|환불|위약금|취소|재예매|뭘|무엇|어떻게|왜|처음|초보|guide|train|rail|airport|flight|travel|trip|delay|help|ticket|refund)/i;
const GUIDE_DENIED_PATTERN = /(주식|코인|투자|대출|법률|소송|진단|처방|약물|정치|선거|연애|운세|도박|sports|stock|crypto|medical|legal)/i;

function asFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedText(value, fallback = "", maxLength = 80) {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength) || fallback;
}

function normalizeLocale(value) {
  return SUPPORTED_LOCALES.has(value) ? value : "ko";
}

function normalizeInput(input = {}) {
  const selectedTrain = input.selectedTrain || {};
  const originalTrain = input.originalTrain || {};
  return {
    locale: normalizeLocale(input.locale),
    scenario: boundedText(input.scenario, "현재 상황", 40),
    disruptionNote: boundedText(input.disruptionNote, "특별한 지연 정보가 없습니다.", 120),
    probability: Math.max(0, Math.min(100, asFiniteNumber(input.probability))),
    originalProbability: Math.max(0, Math.min(100, asFiniteNumber(input.originalProbability))),
    recovered: Boolean(input.recovered),
    selectedTrain: {
      id: boundedText(selectedTrain.id, "UNKNOWN", 40),
      service: boundedText(selectedTrain.service, "선택 열차", 50),
      airportDeparture: boundedText(selectedTrain.airportDeparture, "확인 필요", 40),
      railDeparture: boundedText(selectedTrain.railDeparture, "확인 필요", 40),
      destinationArrival: boundedText(selectedTrain.destinationArrival, "확인 필요", 40)
    },
    originalTrain: {
      id: boundedText(originalTrain.id, "UNKNOWN", 40),
      service: boundedText(originalTrain.service, "처음 열차", 50)
    },
    destination: boundedText(input.destination, "전주", 30),
    interests: Array.isArray(input.interests)
      ? input.interests.slice(0, 4).map((item) => boundedText(item, "", 30)).filter(Boolean)
      : []
  };
}

function redactQuestion(value) {
  return boundedText(value, "", 180)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[개인정보]")
    .replace(/(?:\+?82[- ]?)?0?1[016789][- ]?\d{3,4}[- ]?\d{4}/g, "[개인정보]")
    .replace(/\b\d{6,}\b/g, "[번호]");
}

function normalizeGuideInput(input = {}) {
  const journey = input.journey || {};
  const model = input.model || {};
  const ticketProtection = input.ticketProtection || {};
  const activeView = ["journey", "routes", "travel", "validation", "about"].includes(input.activeView) ? input.activeView : "journey";
  return {
    question: redactQuestion(input.question),
    activeView,
    dataMode: boundedText(input.dataMode, "정보 상태 확인 중", 30),
    journey: {
      origin: boundedText(journey.origin, "출발지", 30),
      destination: boundedText(journey.destination, "목적지", 30),
      checkedBags: Math.max(0, Math.min(3, Math.round(asFiniteNumber(journey.checkedBags)))),
      mobilitySupport: Boolean(journey.mobilitySupport)
    },
    ticketProtection: {
      hasBookedTicket: Boolean(ticketProtection.hasBookedTicket),
      operators: Array.isArray(ticketProtection.operators)
        ? ticketProtection.operators.slice(0, 2).map((operator) => ({
          label: boundedText(operator?.label, "승차권", 40),
          deadline: boundedText(operator?.deadline, "공식 확인 필요", 80),
          feeBand: boundedText(operator?.feeBand, "공식 확인 필요", 80),
          officialLabel: boundedText(operator?.officialLabel, "운영사 공식 확인", 50)
        }))
        : [],
      steps: Array.isArray(ticketProtection.steps)
        ? ticketProtection.steps.slice(0, 4).map((step) => boundedText(step, "", 80)).filter(Boolean)
        : [],
      disclaimer: boundedText(ticketProtection.disclaimer, "승차권은 운영사 공식 채널에서 직접 처리해야 합니다.", 180)
    },
    model: {
      boardingProbability: Math.max(0, Math.min(100, Math.round(asFiniteNumber(model.boardingProbability)))),
      riskLabel: boundedText(model.riskLabel, "확인 필요", 30),
      platformP50: boundedText(model.platformP50, "확인 필요", 20),
      platformP90: boundedText(model.platformP90, "확인 필요", 20),
      selectedTrain: boundedText(model.selectedTrain, "선택 열차", 50),
      airportRailDeparture: boundedText(model.airportRailDeparture, "확인 필요", 20),
      trainDeparture: boundedText(model.trainDeparture, "확인 필요", 20),
      destinationArrival: boundedText(model.destinationArrival, "확인 필요", 20),
      recovered: Boolean(model.recovered),
      fallbackRequired: Boolean(model.fallbackRequired)
    }
  };
}

function guideTopic(question) {
  if (/(여행|관광|일정|장소)/i.test(question)) return "travel";
  if (/(현장|기록|검증|참여|삭제)/i.test(question)) return "validation";
  if (/(정보|데이터|출처|개인정보|무엇을 사용)/i.test(question)) return "about";
  if (/(열차|기차|ktx|공항철도|추천|환승|늦|지연|왜|예매|승차권|열차표|티켓|표|반환|환불|위약금|취소|재예매|ticket|refund)/i.test(question)) return "routes";
  return "journey";
}

export function validateGuideAnswer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value.answer !== "string" || !value.answer.trim()) return false;
  if (!Array.isArray(value.actions) || value.actions.length > 3 || value.actions.some((item) => typeof item !== "string" || !item.trim())) return false;
  if (!["journey", "routes", "travel", "validation", "about", "none"].includes(value.relatedView)) return false;
  return typeof value.disclaimer === "string" && Boolean(value.disclaimer.trim());
}

export function buildGuideFallback(input) {
  const data = normalizeGuideInput(input);
  if (!data.question || GUIDE_DENIED_PATTERN.test(data.question) || !GUIDE_TOPIC_PATTERN.test(data.question)) {
    return {
      answer: "착착에서는 공항 도착, 열차 환승, 지역 여행 일정과 현장 확인에 관한 내용만 안내해 드려요.",
      actions: ["‘지금 무엇을 해야 해?’처럼 착착 이용이나 현재 여정을 물어보세요."],
      relatedView: "none",
      disclaimer: "표 예매·결제와 착착 범위 밖 상담은 제공하지 않습니다."
    };
  }

  const topic = guideTopic(data.question);
  const asksAboutTicket = /(예매|승차권|열차표|티켓|표|반환|환불|위약금|취소|재예매|ticket|refund)/i.test(data.question);
  if (topic === "routes" && asksAboutTicket) {
    const operatorSummary = data.ticketProtection.operators
      .map((operator) => `${operator.label}은 ${operator.deadline}, 예상 부담은 ${operator.feeBand}`)
      .join(". ");
    return {
      answer: data.ticketProtection.hasBookedTicket
        ? `${operatorSummary || "예매한 표의 반환 기준은 운영사에서 확인해야 해요."}. 착착은 확정 금액이 아니라 확인해야 할 구간만 보여드려요.`
        : "예매한 표가 있다면 ‘항공편·여행조건 바꾸기’에서 표 종류와 운영사를 먼저 알려주세요.",
      actions: data.ticketProtection.steps.slice(0, 3).length
        ? data.ticketProtection.steps.slice(0, 3)
        : ["대체편 좌석을 먼저 확인하세요.", "기존 표의 반환 마감과 최종 금액을 운영사에서 확인하세요."],
      relatedView: "routes",
      disclaimer: data.ticketProtection.disclaimer
    };
  }
  const answers = {
    journey: {
      answer: `지금은 ${data.model.airportRailDeparture} 공항철도를 기준으로 이동하면 돼요. 착착은 타는 곳 도착을 보통 ${data.model.platformP50}, 늦는 경우 ${data.model.platformP90}쯤으로 보고 있어요.`,
      actions: ["내 여정에서 항공편과 이동조건을 확인하세요.", "상황이 바뀌면 다음 열차 화면에서 다시 살펴보세요."]
    },
    routes: {
      answer: `${data.model.selectedTrain}을 탈 가능성은 ${data.model.boardingProbability}%로 계산됐어요. 항공 도착, 입국장, 짐과 이동 도움 조건을 함께 보고 더 놓치기 어려운 열차를 골랐어요.`,
      actions: [`${data.model.airportRailDeparture} 공항철도를 확인하세요.`, `${data.model.trainDeparture} ${data.model.selectedTrain} 출발 전에 좌석을 공식 채널에서 확인하세요.`]
    },
    travel: {
      answer: `${data.journey.destination}에는 ${data.model.destinationArrival} 도착 예정이에요. 착착은 열차가 늦어지면 무리한 늦은 밤 일정은 다음 날로 옮기고 여행 취향은 그대로 유지해요.`,
      actions: ["여행 일정에서 도착한 날과 다음 날을 나눠 확인하세요."]
    },
    validation: {
      answer: "현장 확인은 착착의 안내와 실제 이동 결과가 맞았는지 확인하는 기능이에요. 이름이나 예약번호 없이 승강장 도착과 열차 탑승 순간만 기록하고 언제든 삭제할 수 있어요.",
      actions: ["현장에서 받은 참여코드가 있을 때만 시작하세요.", "실제로 해당 순간이 되었을 때 버튼을 눌러 주세요."]
    },
    about: {
      answer: "착착은 항공 도착, 입국장 혼잡, 날씨, 공항철도·열차와 관광 정보를 연결해 안내해요. 실제 정보, 계산한 값과 자동 대체 정보를 서비스 안내에서 구분해 보여드려요.",
      actions: ["서비스 안내에서 각 정보의 연결 상태와 공식 출처를 확인하세요."]
    }
  };
  return {
    ...answers[topic],
    relatedView: topic,
    disclaimer: "착착의 계산은 탑승과 좌석을 보장하지 않으며, 승차권은 운영사 공식 채널에서 마지막으로 확인해 주세요."
  };
}

function localizedFallback(data) {
  const isSafe = data.probability >= 85;
  const copy = {
    ko: {
      headline: isSafe ? "지금 추천한 열차로 이동하세요" : "조금 더 여유 있는 열차가 안전해요",
      summary: `${data.selectedTrain.service}를 탈 가능성은 ${Math.round(data.probability)}%입니다. ${data.disruptionNote}`,
      steps: [
        { label: "1. 도착 정보 확인", detail: "비행기 도착 시각과 입국장 안내를 확인하세요." },
        { label: "2. 공항철도 이동", detail: `${data.selectedTrain.airportDeparture} 출발편을 기준으로 이동하세요.` },
        { label: "3. 열차 환승", detail: `${data.selectedTrain.railDeparture} ${data.selectedTrain.service}로 갈아타세요.` }
      ],
      tourismAdjustment: data.recovered
        ? `${data.destination}의 늦은 밤 일정은 다음 날 아침 같은 취향의 코스로 옮겼어요.`
        : `${data.destination} 일정은 현재 도착 예정 시각에 맞춰 그대로 이어집니다.`,
      disclaimer: "실시간 좌석과 승차권 변경은 운영사 앱에서 마지막으로 확인해 주세요."
    },
    en: {
      headline: isSafe ? "Continue with the recommended train" : "A later train gives you a safer connection",
      summary: `Your estimated chance of catching ${data.selectedTrain.service} is ${Math.round(data.probability)}%.`,
      steps: [
        { label: "1. Check arrival", detail: "Confirm the latest flight and immigration information." },
        { label: "2. Take airport rail", detail: `Head for the ${data.selectedTrain.airportDeparture} airport train.` },
        { label: "3. Transfer", detail: `Transfer to ${data.selectedTrain.service} at ${data.selectedTrain.railDeparture}.` }
      ],
      tourismAdjustment: `Your ${data.destination} plan has been aligned with the new arrival time.`,
      disclaimer: "Check seat availability and ticket changes in the operator's official app."
    },
    ja: {
      headline: isSafe ? "おすすめの列車で移動してください" : "次の列車なら余裕を持って乗り継げます",
      summary: `${data.selectedTrain.service}に乗れる見込みは${Math.round(data.probability)}%です。`,
      steps: [
        { label: "1. 到着情報を確認", detail: "フライトと入国審査の最新情報を確認してください。" },
        { label: "2. 空港鉄道へ移動", detail: `${data.selectedTrain.airportDeparture}発を目安に移動してください。` },
        { label: "3. 列車に乗り換え", detail: `${data.selectedTrain.railDeparture}発の${data.selectedTrain.service}に乗り換えてください。` }
      ],
      tourismAdjustment: `${data.destination}の予定を新しい到着時刻に合わせました。`,
      disclaimer: "座席と乗車券の変更は運行会社の公式アプリで確認してください。"
    },
    zh: {
      headline: isSafe ? "请乘坐推荐列车" : "选择稍晚的列车更稳妥",
      summary: `预计赶上${data.selectedTrain.service}的概率为${Math.round(data.probability)}%。`,
      steps: [
        { label: "1. 确认到达信息", detail: "请确认航班和入境大厅的最新信息。" },
        { label: "2. 前往机场铁路", detail: `请以前往${data.selectedTrain.airportDeparture}发车的列车为准。` },
        { label: "3. 换乘列车", detail: `请换乘${data.selectedTrain.railDeparture}发车的${data.selectedTrain.service}。` }
      ],
      tourismAdjustment: `已按新的到达时间调整${data.destination}行程。`,
      disclaimer: "座位和车票变更请在运营方官方应用中最终确认。"
    }
  };
  return copy[data.locale] || copy.ko;
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  for (const item of response?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

export function validateGuidance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (![value.headline, value.summary, value.tourismAdjustment, value.disclaimer].every((item) => typeof item === "string" && item.trim())) return false;
  if (!Array.isArray(value.steps) || value.steps.length < 2 || value.steps.length > 4) return false;
  return value.steps.every((step) => step && typeof step.label === "string" && step.label.trim() && typeof step.detail === "string" && step.detail.trim());
}

export function buildFallbackGuidance(input) {
  return localizedFallback(normalizeInput(input));
}

export function openAIStatus(env = process.env) {
  return {
    configured: Boolean(env.OPENAI_API_KEY),
    model: env.OPENAI_MODEL || DEFAULT_MODEL
  };
}

export async function createJourneyGuidance(input, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const data = normalizeInput(input);
  const fallback = localizedFallback(data);
  const apiKey = env.OPENAI_API_KEY;
  const model = env.OPENAI_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    return { mode: "fallback", model, guidance: fallback, reasonCode: "NOT_CONFIGURED" };
  }

  const safetySource = boundedText(options.clientToken, "anonymous-demo", 120);
  const safetyIdentifier = `chakchak_${createHash("sha256").update(safetySource).digest("hex").slice(0, 32)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        store: false,
        safety_identifier: safetyIdentifier,
        reasoning: { effort: "low" },
        max_output_tokens: 700,
        instructions: [
          "You are CHAK², a public Rail-Air journey guide.",
          "Use only the supplied authoritative train identifiers and times; never invent or change them.",
          "Explain the result in plain language suitable for all ages, in the requested language.",
          "The probability comes from a deterministic simulation. Do not claim guaranteed boarding, live seat availability, ticketing, or protected connections.",
          "Give two to four short, actionable steps and preserve the local tourism preference when replanning."
        ].join(" "),
        input: JSON.stringify(data),
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "chakchak_journey_guidance",
            description: "Plain-language Rail-Air connection guidance using only supplied facts.",
            strict: true,
            schema: guidanceSchema
          }
        }
      })
    });

    if (!response.ok) {
      return { mode: "fallback", model, guidance: fallback, reasonCode: `UPSTREAM_${response.status}` };
    }

    const payload = await response.json();
    const outputText = extractOutputText(payload);
    const guidance = JSON.parse(outputText);
    if (!validateGuidance(guidance)) throw new Error("invalid structured guidance");

    return {
      mode: "live",
      model: payload.model || model,
      guidance,
      responseId: typeof payload.id === "string" ? payload.id : null
    };
  } catch (error) {
    return {
      mode: "fallback",
      model,
      guidance: fallback,
      reasonCode: error?.name === "AbortError" ? "TIMEOUT" : "INVALID_RESPONSE"
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function createGuideAnswer(input, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const data = normalizeGuideInput(input);
  const fallback = buildGuideFallback(data);
  const model = env.OPENAI_MODEL || DEFAULT_MODEL;

  if (!data.question || GUIDE_DENIED_PATTERN.test(data.question) || !GUIDE_TOPIC_PATTERN.test(data.question)) {
    return { mode: "guarded", model, answer: fallback, reasonCode: "OUT_OF_SCOPE" };
  }
  if (!env.OPENAI_API_KEY) {
    return { mode: "fallback", model, answer: fallback, reasonCode: "NOT_CONFIGURED" };
  }

  const safetySource = boundedText(options.clientToken, "anonymous-guide", 120);
  const safetyIdentifier = `chakchak_guide_${createHash("sha256").update(safetySource).digest("hex").slice(0, 32)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        store: false,
        safety_identifier: safetyIdentifier,
        reasoning: { effort: "low" },
        max_output_tokens: 450,
        instructions: [
          "You are the CHAK² in-product guide for first-time public transport users.",
          "Answer only questions about using CHAK², the supplied Rail-Air journey, train connections, the linked local travel plan, field verification, or the displayed data sources.",
          "The supplied CHAK² model facts are authoritative. Never recalculate, override, or invent a probability, train, time, data status, seat, fare, booking, ticket change, or protected connection.",
          "For ticket questions, use only the supplied ticket-protection deadlines and fee bands. Never claim an exact refund, cancellation, rebooking, or seat hold.",
          "Use very plain Korean suitable for all ages. Give one direct answer and up to three short actions.",
          "If a fact is not supplied, say it cannot be confirmed in CHAK² and point to the relevant official operator channel.",
          "Do not provide general knowledge, medical, legal, financial, personal, or unrelated advice. Never repeat personal information from the question."
        ].join(" "),
        input: JSON.stringify(data),
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "chakchak_ai_guide_answer",
            description: "A scoped in-product answer grounded in CHAK² model and journey facts.",
            strict: true,
            schema: guideAnswerSchema
          }
        }
      })
    });

    if (!response.ok) {
      return { mode: "fallback", model, answer: fallback, reasonCode: `UPSTREAM_${response.status}` };
    }
    const payload = await response.json();
    const answer = JSON.parse(extractOutputText(payload));
    if (!validateGuideAnswer(answer)) throw new Error("invalid guide answer");
    return { mode: "live", model: payload.model || model, answer };
  } catch (error) {
    return {
      mode: "fallback",
      model,
      answer: fallback,
      reasonCode: error?.name === "AbortError" ? "TIMEOUT" : "INVALID_RESPONSE"
    };
  } finally {
    clearTimeout(timeout);
  }
}
