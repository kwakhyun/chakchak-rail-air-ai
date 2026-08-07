import assert from "node:assert/strict";
import test from "node:test";

import { buildTicketProtectionAdvice } from "../src/ticket-protection.js";

const arex = {
  id: "AREX-1848",
  service: "공항철도 직통",
  departure: "2026-08-12T18:48:00+09:00",
  arrival: "2026-08-12T19:39:00+09:00"
};

const ktx = {
  id: "KTX-419",
  service: "KTX 419",
  origin: "서울역",
  departure: "2026-08-12T20:12:00+09:00",
  arrival: "2026-08-12T21:54:00+09:00"
};

const lastKtx = {
  id: "KTX-425",
  service: "KTX 425",
  origin: "서울역",
  departure: "2026-08-12T22:42:00+09:00",
  arrival: "2026-08-13T00:21:00+09:00"
};

test("예매한 표가 없으면 승차권 처리 안내를 만들지 않는다", () => {
  const advice = buildTicketProtectionAdvice({ ticket: { hasBookedTicket: false } });
  assert.equal(advice.hasBookedTicket, false);
  assert.deepEqual(advice.operators, []);
});

test("KTX와 공항철도 표를 서로 다른 운영사 안내로 분리한다", () => {
  const advice = buildTicketProtectionAdvice({
    ticket: { hasBookedTicket: true, korail: true, arex: true, ticketType: "standard", arexType: "direct" },
    existingArex: arex,
    existingKtx: ktx,
    alternativeArex: arex,
    alternativeKtx: ktx,
    allKtx: [ktx, lastKtx],
    journey: { mobility: "standard", largeLuggage: false },
    now: "2026-08-12T12:00:00+09:00"
  });

  assert.equal(advice.operators.length, 2);
  assert.equal(advice.operators[0].id, "korail");
  assert.match(advice.operators[0].feeBand, /없음~.*5%/);
  assert.equal(advice.operators[1].id, "arex");
  assert.match(advice.operators[1].feeBand, /1천원/);
  assert.match(advice.disclaimer, /자동으로 취소하거나 다시 예매하지 않습니다/);
});

test("할인·패스·단체표는 일반표와 다른 반환 위험을 안내한다", () => {
  const base = {
    hasBookedTicket: true,
    korail: true,
    arex: false
  };
  const common = {
    existingKtx: ktx,
    alternativeKtx: ktx,
    allKtx: [ktx, lastKtx],
    journey: { mobility: "standard" },
    now: "2026-08-12T19:00:00+09:00"
  };

  const discount = buildTicketProtectionAdvice({ ticket: { ...base, ticketType: "discount" }, ...common });
  const pass = buildTicketProtectionAdvice({ ticket: { ...base, ticketType: "pass" }, ...common });
  const group = buildTicketProtectionAdvice({ ticket: { ...base, ticketType: "group" }, ...common });

  assert.match(discount.operators[0].feeBand, /할인 재적용/);
  assert.match(pass.operators[0].feeBand, /상품별/);
  assert.match(group.operators[0].feeBand, /30%/);
});

test("막차·자정 이후 도착·접근성 조건을 추가로 확인한다", () => {
  const advice = buildTicketProtectionAdvice({
    ticket: { hasBookedTicket: true, korail: true, arex: false, ticketType: "standard" },
    existingKtx: ktx,
    alternativeArex: arex,
    alternativeKtx: lastKtx,
    allKtx: [ktx, lastKtx],
    journey: { mobility: "assisted", largeLuggage: true },
    now: "2026-08-12T12:00:00+09:00"
  });

  assert.equal(advice.checks.find((item) => item.id === "last-train").value, "막차 후보");
  assert.equal(advice.checks.find((item) => item.id === "midnight").value, "다음 날 도착");
  assert.equal(advice.checks.find((item) => item.id === "accessibility").value, "도움 동선 필요");
  assert.deepEqual(advice.steps.map((item) => item.id), ["alternative", "penalty", "secure", "confirm"]);
});
