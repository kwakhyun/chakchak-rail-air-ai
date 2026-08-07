import assert from "node:assert/strict";
import test from "node:test";

import { optimizeConstrainedJourney } from "../src/journey-optimizer.js";

function candidate(id, destinationArrivalTime, overrides = {}) {
  return {
    id,
    destinationArrivalTime,
    price: 34_600,
    transferCount: 1,
    reservationAvailable: true,
    decisionProfile: {
      eligible: true,
      conservativeProbability: 0.93,
      p90BufferMinutes: 18,
      accessibility: { violation: false }
    },
    ...overrides
  };
}

const activities = [
  {
    id: "hotel",
    title: "숙소 체크인",
    openingTime: "2026-08-12T15:00:00+09:00",
    closingTime: "2026-08-13T02:00:00+09:00",
    durationMinutes: 30,
    minimumDurationMinutes: 20,
    travelMinutes: 15,
    required: true
  },
  {
    id: "experience",
    title: "예약 체험",
    openingTime: "2026-08-13T09:00:00+09:00",
    closingTime: "2026-08-13T13:00:00+09:00",
    reservationTime: "2026-08-13T10:00:00+09:00",
    reservationToleranceMinutes: 15,
    durationMinutes: 60,
    minimumDurationMinutes: 60,
    travelMinutes: 20,
    required: false
  }
];

test("정식 제약 최적화기는 안전·예산·환승·예약·접근성 위반 후보를 제외한다", () => {
  const result = optimizeConstrainedJourney({
    candidates: [
      candidate("UNSAFE", "2026-08-12T21:00:00+09:00", {
        decisionProfile: { eligible: false, conservativeProbability: 0.62, p90BufferMinutes: -8, accessibility: { violation: false } }
      }),
      candidate("OVER-BUDGET", "2026-08-12T21:20:00+09:00", { price: 61_000 }),
      candidate("NO-ACCESS", "2026-08-12T21:30:00+09:00", {
        decisionProfile: { eligible: true, conservativeProbability: 0.97, p90BufferMinutes: 30, accessibility: { violation: true } }
      }),
      candidate("SELECTED", "2026-08-12T21:54:00+09:00")
    ],
    preferences: { maxPrice: 50_000, maxTransfers: 2, requireReservationAvailability: true },
    activities
  });

  assert.equal(result.policy.id, "chakchak-exact-journey-optimizer-v1");
  assert.equal(result.feasible, true);
  assert.equal(result.selectedCandidateId, "SELECTED");
  assert.ok(result.rejected.find((item) => item.id === "UNSAFE").reasons.includes("BOARDING_SAFETY"));
  assert.ok(result.rejected.find((item) => item.id === "OVER-BUDGET").reasons.includes("MAX_PRICE"));
  assert.ok(result.rejected.find((item) => item.id === "NO-ACCESS").reasons.includes("ACCESSIBILITY"));
});

test("정식 제약 최적화기는 필수 일정과 예약 체류시간을 함께 보존한다", () => {
  const result = optimizeConstrainedJourney({
    candidates: [
      candidate("LATE", "2026-08-13T02:30:00+09:00"),
      candidate("BALANCED", "2026-08-12T21:54:00+09:00")
    ],
    preferences: { maxPrice: 50_000, maxTransfers: 2, arrivalToFirstMinutes: 20 },
    activities
  });

  assert.equal(result.selectedCandidateId, "BALANCED");
  assert.equal(result.selectedPlan.itinerary.requiredPlansKept, 1);
  assert.equal(result.selectedPlan.itinerary.reservationsKept, 1);
  assert.equal(result.selectedPlan.itinerary.items.length, 2);
  assert.equal(result.selectedPlan.itinerary.items[0].id, "hotel");
  assert.equal(result.selectedPlan.itinerary.items[1].reservationKept, true);
});

test("모든 후보가 필수 조건을 위반하면 불가능 상태와 제외 이유를 반환한다", () => {
  const result = optimizeConstrainedJourney({
    candidates: [
      candidate("NO-SEAT", "2026-08-12T21:54:00+09:00", { reservationAvailable: false }),
      candidate("TOO-MANY-TRANSFERS", "2026-08-12T22:10:00+09:00", { transferCount: 4 })
    ],
    preferences: { maxTransfers: 2, requireReservationAvailability: true },
    activities: []
  });

  assert.equal(result.feasible, false);
  assert.equal(result.explanation.headline, "모든 조건을 만족하는 연결 여정을 찾지 못했습니다.");
  assert.equal(result.rejected.length, 2);
});
