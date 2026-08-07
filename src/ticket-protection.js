export const TICKET_TYPES = Object.freeze([
  { id: "standard", label: "일반 승차권" },
  { id: "discount", label: "할인 승차권" },
  { id: "pass", label: "철도 패스" },
  { id: "group", label: "단체 승차권" }
]);

export const KORAIL_REFUND_GUIDE_URL = "https://www.korail.com/ticket/reserve/guide/pay";
export const AREX_TERMS_URL = "https://www.arex.or.kr/content.do?menuNo=MN201503060000000002";

const ticketTypeLabel = (ticketType) => TICKET_TYPES.find((item) => item.id === ticketType)?.label || "일반 승차권";

const koreaCalendarDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function minutesUntil(value, now) {
  const departure = new Date(value).getTime();
  const current = new Date(now).getTime();
  if (!Number.isFinite(departure) || !Number.isFinite(current)) return null;
  return Math.round((departure - current) / 60_000);
}

function korailFeeAdvice(ticketType, minutesToDeparture, arrival, now) {
  if (ticketType === "pass") {
    return {
      deadline: "패스 사용일·횟수 복구 여부 확인",
      feeBand: "상품별 규정",
      detail: "패스마다 반환과 사용 횟수 복구 기준이 달라요. 코레일에서 패스 이름을 기준으로 확인하세요."
    };
  }
  if (ticketType === "discount") {
    return {
      deadline: minutesToDeparture !== null && minutesToDeparture > 0 ? "출발 전 할인 조건 다시 확인" : "역 창구에서 즉시 확인",
      feeBand: "할인 재적용 여부에 따라 달라짐",
      detail: "특가·할인표는 바꾼 표에 같은 할인이 다시 적용되지 않을 수 있어요. 반환 전 새 표의 최종 금액도 확인하세요."
    };
  }

  const afterArrival = new Date(arrival).getTime() <= new Date(now).getTime();
  if (afterArrival) {
    return {
      deadline: "도착 시각이 지나 반환이 어려워요",
      feeBand: "반환 불가 가능",
      detail: "목적지 도착 시각이 지난 표는 반환되지 않을 수 있어 역 창구 확인이 필요해요."
    };
  }
  if (minutesToDeparture !== null && minutesToDeparture <= 0) {
    return {
      deadline: "출발 후에는 역 창구에서 확인",
      feeBand: ticketType === "group" ? "운임의 약 40~70% 가능" : "운임의 약 20~70% 가능",
      detail: "출발 후에는 시각에 따라 부담이 크게 올라갈 수 있어요. 코레일톡 일부 KTX는 출발 후 10분 이내 예외가 있을 수 있습니다."
    };
  }
  if (ticketType === "group") {
    return {
      deadline: minutesToDeparture !== null && minutesToDeparture > 1_440 ? "출발 하루 전까지 먼저 확인" : "출발 전 바로 확인",
      feeBand: minutesToDeparture !== null && minutesToDeparture > 1_440 ? "인원수×400원 또는 5~20% 가능" : "운임의 약 30% 가능",
      detail: "단체표는 인원수와 반환 시점에 따라 부담이 커질 수 있으므로 새 좌석을 확인한 뒤 담당 창구에서 처리하세요."
    };
  }
  if (minutesToDeparture !== null && minutesToDeparture > 180) {
    return {
      deadline: "출발 3시간 전까지 변경 가능 여부 확인",
      feeBand: "없음~운임의 약 5% 가능",
      detail: "요일·명절 기간과 반환 시점에 따라 달라져요. 결제 직전 코레일의 최종 금액을 확인하세요."
    };
  }
  return {
    deadline: "출발 전 바로 확인",
    feeBand: "운임의 약 5~30% 가능",
    detail: "출발이 가까워질수록 부담이 커질 수 있어요. 좌석을 확인한 뒤 기존 표의 최종 반환 금액을 확인하세요."
  };
}

function arexFeeAdvice(arexType, minutesToDeparture) {
  if (arexType === "general") {
    return {
      deadline: "개표·사용 전 반환 방법 확인",
      feeBand: "교통카드·1회용 표에 따라 다름",
      detail: "일반열차는 직통열차 예약표와 처리 방식이 달라요. 사용한 결제수단과 개표 여부를 기준으로 공항철도에서 확인하세요."
    };
  }
  if (minutesToDeparture !== null && minutesToDeparture <= 0) {
    return {
      deadline: "출발 후에는 바로 공식 확인",
      feeBand: "기본운임 수준 가능",
      detail: "직통열차는 출발 후 반환 부담이 커질 수 있어요. 이미 개표했거나 사용기한이 지난 경우 반환이 어려울 수 있습니다."
    };
  }
  return {
    deadline: "출발 전 반환 가능 여부 확인",
    feeBand: minutesToDeparture !== null && minutesToDeparture > 1_440 ? "수수료 없음 가능" : "약 1천원 가능",
    detail: "직통열차는 전날까지 수수료가 면제될 수 있고, 출발 당일에는 수수료가 생길 수 있어요. 공식 화면의 최종 금액을 확인하세요."
  };
}

export function buildTicketProtectionAdvice({
  ticket,
  existingArex,
  existingKtx,
  alternativeArex,
  alternativeKtx,
  allKtx = [],
  journey,
  now = new Date()
}) {
  const normalized = {
    hasBookedTicket: Boolean(ticket?.hasBookedTicket),
    korail: ticket?.korail !== false,
    arex: Boolean(ticket?.arex),
    ticketType: ticket?.ticketType || "standard",
    arexType: ticket?.arexType || "direct"
  };
  if (!normalized.hasBookedTicket) {
    return Object.freeze({ hasBookedTicket: false, operators: [], checks: [], steps: [] });
  }

  const operators = [];
  if (normalized.korail && existingKtx) {
    const minutesToDeparture = minutesUntil(existingKtx.departure, now);
    const fee = korailFeeAdvice(normalized.ticketType, minutesToDeparture, existingKtx.arrival, now);
    operators.push(Object.freeze({
      id: "korail",
      label: "KTX·코레일 승차권",
      service: existingKtx.service,
      ticketType: ticketTypeLabel(normalized.ticketType),
      ...fee,
      officialUrl: KORAIL_REFUND_GUIDE_URL,
      officialLabel: "코레일 반환 기준 확인"
    }));
  }
  if (normalized.arex && existingArex) {
    const minutesToDeparture = minutesUntil(existingArex.departure, now);
    operators.push(Object.freeze({
      id: "arex",
      label: normalized.arexType === "general" ? "공항철도 일반열차" : "공항철도 직통열차",
      service: existingArex.service,
      ticketType: normalized.arexType === "general" ? "교통카드·1회용 표" : "직통열차 승차권",
      ...arexFeeAdvice(normalized.arexType, minutesToDeparture),
      officialUrl: AREX_TERMS_URL,
      officialLabel: "공항철도 반환 기준 확인"
    }));
  }

  const lastKtx = allKtx.at(-1);
  const isLastTrain = Boolean(alternativeKtx?.id && lastKtx?.id === alternativeKtx.id);
  const crossesMidnight = Boolean(
    alternativeKtx?.departure &&
    alternativeKtx?.arrival &&
    koreaCalendarDate.format(new Date(alternativeKtx.arrival)) !==
      koreaCalendarDate.format(new Date(alternativeKtx.departure))
  );
  const checks = [
    {
      id: "transfer",
      label: "환승역",
      value: alternativeKtx?.origin || "서울역",
      note: alternativeArex ? `공항철도 ${alternativeArex.service.includes("직통") ? "직통열차" : "일반열차"}에서 이동 동선을 확인하세요.` : "환승 동선을 확인하세요."
    },
    {
      id: "last-train",
      label: "막차",
      value: isLastTrain ? "막차 후보" : "뒤 열차 있음",
      note: isLastTrain ? "놓치면 같은 날 대체편이 없을 수 있어요." : "문제가 생기면 뒤 열차도 다시 비교할 수 있어요."
    },
    {
      id: "midnight",
      label: "자정 이후 도착",
      value: crossesMidnight ? "다음 날 도착" : "당일 도착",
      note: crossesMidnight ? "숙소 체크인과 목적지 교통 마감도 함께 확인하세요." : "목적지 도착 뒤 이동시간을 확인하세요."
    },
    {
      id: "accessibility",
      label: "접근성",
      value: journey?.mobility !== "standard" ? "도움 동선 필요" : journey?.largeLuggage ? "큰 짐 동선 확인" : "일반 이동",
      note: journey?.mobility !== "standard" || journey?.largeLuggage
        ? "엘리베이터와 이동지원 가능 여부를 공식 안내에서 확인하세요."
        : "환승시간과 승강장 이동거리를 마지막으로 확인하세요."
    }
  ];

  const steps = [
    { id: "alternative", label: "대체편 좌석·이동조건 확인", detail: "코레일과 공항철도 공식 채널에서 실제 이용 가능 여부를 먼저 확인합니다." },
    { id: "penalty", label: "기존 표의 반환 마감·예상 부담 확인", detail: "표 종류와 운영사를 나눠 최종 반환 금액과 변경 가능 여부를 확인합니다." },
    { id: "secure", label: "새 표 확보가 확실할 때 기존 표 처리", detail: "좌석 확보가 확정되기 전에 기존 표부터 없애지 않도록 안내합니다." },
    { id: "confirm", label: "환승·막차·도착 뒤 이동까지 최종 확인", detail: "두 운영사 표와 목적지 일정을 각각 확인한 뒤 여정 후보를 확정합니다." }
  ];

  return Object.freeze({
    hasBookedTicket: true,
    operators: Object.freeze(operators),
    checks: Object.freeze(checks.map(Object.freeze)),
    steps: Object.freeze(steps.map(Object.freeze)),
    disclaimer: "착착은 승차권을 자동으로 취소하거나 다시 예매하지 않습니다. 공식 채널에서 사용자가 확인하고 직접 처리합니다."
  });
}
