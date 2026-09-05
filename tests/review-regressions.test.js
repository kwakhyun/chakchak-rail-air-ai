import test from "node:test";
import assert from "node:assert/strict";
import { buildDataFusion, normalizeFlight } from "../lib/public-data.mjs";
import { compactModelInput } from "../lib/model-input.mjs";
import { buildRailPlan } from "../src/rail-plan.js";
import { demoTrip } from "../src/data.js";
import { createJourneyModel } from "../src/journey-model.js";
import { plannedTravelItems } from "../src/travel-itinerary.js";
import { createLatestRequest } from "../src/api-client.js";

const at = "2030-09-05T17:05:00+09:00";
const now = new Date("2030-09-05T16:00:00+09:00");
function state(arrivalAt = at) {
  return { scenarioId: "normal", previewDelayMinutes: 0, journey: { flightId: "KE704", arrivalAt, checkedBags: 1, mobility: "standard", ticket: {} }, signals: null, fusion: null, confirmedJourney: null };
}

test("a missing flight must not borrow another flight's times", () => {
  assert.equal(normalizeFlight({ items: [{ flightId: "KE999", scheduledDateTime: "1100" }] }, "KE704"), null);
  assert.equal(normalizeFlight({ items: [{ flightId: "ke 704", scheduledDateTime: "1100" }] }, "KE704").flightId, "ke 704");
});

test("cache distinguishes arrival hours; unavailable weather is not a zero observation", async () => {
  let calls = 0;
  const options = { env: {}, fetchImpl: async () => { calls++; return { ok: true, headers: { get: () => "application/json" }, json: async () => ({ hourly: {
    time: ["2030-09-05T09:00", "2030-09-05T23:00"], precipitation_probability: [0, 95], wind_speed_10m: [2, 60]
  } }) }; } };
  const first = await buildDataFusion({ flightId: "TEST1", targetDateTime: "2030-09-05T09:00:00+09:00" }, options);
  const second = await buildDataFusion({ flightId: "TEST1", targetDateTime: "2030-09-05T23:00:00+09:00" }, options);
  assert.equal(first.sources.at(-1).data.precipitationProbability, 0);
  assert.equal(second.sources.at(-1).data.precipitationProbability, 95);
  assert.equal(calls, 2);
  const cached = await buildDataFusion({ flightId: "TEST1", targetDateTime: "2030-09-05T23:00:00+09:00" }, options);
  assert.equal(cached.cache.hit, true);
  const outside = await buildDataFusion({ flightId: "TEST1", targetDateTime: "2031-01-01T23:00:00+09:00" }, options);
  assert.equal(outside.sources.at(-1).data, null);
  assert.equal(outside.sources.at(-1).mode, "unavailable");
});

test("official schedules determine candidates and reject missed transfers", () => {
  const fusion = { sources: [
    { id: "airport-rail", mode: "live", data: [{ trainNo: "A1", departureStation: "인천공항2터미널", arrivalStation: "서울", plannedDeparture: "20300905184800", plannedArrival: "20300905193900", actualArrival: "20300905202000" }] },
    { id: "tago-train", mode: "live", data: [
      { trainNo: "501", departureTime: "20300905201200", arrivalTime: "20300905215400", adultFare: 35000 },
      { trainNo: "503", departureTime: "20300905211200", arrivalTime: "20300905225400", adultFare: 35000 }
    ] }
  ] };
  const plan = buildRailPlan(demoTrip, at, fusion, "T2", now);
  assert.equal(plan.trains.length, 1);
  assert.equal(plan.trains[0].service, "KTX 503");
  assert.equal(plan.authoritative, true);
  fusion.sources[1].data = [];
  assert.equal(buildRailPlan(demoTrip, at, fusion, "T2", now).unavailable, true);
});

test("ambiguous airport observations stay explicitly labelled as a demo connection", () => {
  const fusion = { sources: [{ id: "airport-rail", mode: "live", data: [{ trainNo: "A1", plannedDeparture: "20300905184800", plannedArrival: "20300905193900" }] }] };
  const plan = buildRailPlan(demoTrip, at, fusion, "T2", now);
  assert.equal(plan.authoritative, false);
  assert.match(plan.sourceLabel, /체험/);
  assert.equal(buildRailPlan(demoTrip, at, null, "T2", new Date("2030-09-05T23:00:00+09:00")).unavailable, true);
});

test("late arrivals have no recoverable or bookable itinerary even if diagnostics choose a candidate", () => {
  const current = state("2030-09-05T23:00:00+09:00");
  const view = createJourneyModel(current).getViewModel();
  assert.equal(view.noSafeCandidate, true);
  assert.equal(view.canRecover, false);
  assert.deepEqual(plannedTravelItems(view, current.journey.arrivalAt), []);
});

test("displayed travel times are selected optimizer times, and unverified hours remain labelled", () => {
  const current = state();
  const model = createJourneyModel(current);
  let view = model.getViewModel();
  assert.equal(model.getViewModel(), view, "UI-only reads reuse the calculation");
  current.confirmedJourney = { selectedArexId: view.recovery.id };
  view = model.getViewModel();
  const items = plannedTravelItems(view, current.journey.arrivalAt);
  const plan = view.chakchakAi.optimization.candidates.find(c => c.id === view.activeCandidate.id);
  assert.ok(items.length > 0);
  assert.deepEqual(items.map(i => i.startTime), plan.itinerary.items.map(i => i.startTime));
  assert.ok(items.every(i => i.status === "영업시간 확인 필요" && Date.parse(i.startTime) > Date.parse(view.activeKtx.arrival)));
});

test("superseding or cancelling a request invalidates its result and aborts its signal", () => {
  const requests = createLatestRequest();
  const first = requests.start();
  const second = requests.start();
  assert.equal(first.isCurrent(), false);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.isCurrent(), true);
  requests.cancel();
  assert.equal(second.isCurrent(), false);
});

test("server and Worker share terminal, price and itinerary constraints without arbitrary fields", () => {
  const input = compactModelInput({ scheduledArrival: at, context: { terminal: "T2", arrivalHourLocal: 17, secret: "discard" }, candidates: [{ id: "A", departureTime: at, price: 40000, reservationAvailable: false }], preferences: { maxPrice: 30000 }, activities: [{ id: "museum", title: "박물관", openingTime: at, closingTime: at, durationMinutes: 60, required: true }] });
  assert.equal(input.context.terminal, "T2");
  assert.equal(input.context.secret, undefined);
  assert.equal(input.candidates[0].reservationAvailable, false);
  assert.equal(input.preferences.maxPrice, 30000);
  assert.equal(input.activities[0].required, true);
});
