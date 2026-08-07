import test from "node:test";
import assert from "node:assert/strict";

import {
  JOURNEY_DECISION_STORAGE_KEY,
  clearConfirmedJourney,
  createConfirmedJourney,
  loadConfirmedJourney,
  saveConfirmedJourney,
  selectedCandidate
} from "../src/journey-decision.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

const journey = {
  flightId: "KE704",
  arrivalAt: "2026-08-12T17:05:00+09:00",
  destination: "전주",
  checkedBags: 1,
  mobility: "standard",
  largeLuggage: false
};

test("확정한 여정은 같은 여행에서 저장하고 다시 불러올 수 있다", () => {
  const storage = memoryStorage();
  const snapshot = createConfirmedJourney({
    journey,
    scenarioId: "rain",
    selectedArex: { id: "AREX-1948" },
    selectedKtx: { id: "KTX-421" },
    originalArex: { id: "AREX-1848" },
    originalKtx: { id: "KTX-419" },
    probabilityPercent: 95.4,
    now: () => new Date("2026-08-05T01:00:00.000Z")
  });

  assert.equal(saveConfirmedJourney(storage, snapshot), true);
  assert.deepEqual(loadConfirmedJourney(storage, journey), snapshot);
  assert.equal(loadConfirmedJourney(storage, journey).probabilityPercent, 95);
  assert.equal(selectedCandidate([{ id: "AREX-1848" }, { id: "AREX-1948" }], snapshot).id, "AREX-1948");
});

test("다른 항공편이나 여행조건의 오래된 선택은 자동으로 버린다", () => {
  const storage = memoryStorage();
  storage.setItem(JOURNEY_DECISION_STORAGE_KEY, JSON.stringify({
    schemaVersion: "1.0",
    decisionId: "old",
    journeyKey: "다른 여행",
    scenarioId: "rain",
    selectedArexId: "AREX-1948",
    selectedKtxId: "KTX-421",
    confirmedAt: "2026-08-05T01:00:00.000Z"
  }));

  assert.equal(loadConfirmedJourney(storage, journey), null);
  assert.equal(storage.getItem(JOURNEY_DECISION_STORAGE_KEY), null);
});

test("상황을 다시 고르면 확정한 여정을 깨끗하게 지울 수 있다", () => {
  const storage = memoryStorage();
  storage.setItem(JOURNEY_DECISION_STORAGE_KEY, "saved");
  clearConfirmedJourney(storage);
  assert.equal(storage.getItem(JOURNEY_DECISION_STORAGE_KEY), null);
});
