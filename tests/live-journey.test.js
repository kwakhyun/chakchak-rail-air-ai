import test from "node:test";
import assert from "node:assert/strict";

import { demoTrip } from "../src/data.js";
import { deriveJourneySignals, rebaseRailPlan } from "../src/live-journey.js";

test("live public data becomes explicit journey-decision signals", () => {
  const signals = deriveJourneySignals({
    sources: [
      {
        id: "incheon-flight",
        mode: "live",
        data: { scheduledTime: "1630", estimatedTime: "1705", terminal: "P03", gate: "256", carousel: "14", origin: "도쿄/나리타", airline: "대한항공" }
      },
      {
        id: "incheon-immigration",
        mode: "live",
        data: [
          { hall: "E", koreanWaiting: 10, foreignWaiting: 120 },
          { hall: "D", koreanWaiting: 5, foreignWaiting: 15 }
        ]
      },
      {
        id: "airport-rail",
        mode: "live",
        data: [
          { plannedDeparture: "20260804150000", actualDeparture: "20260804150400" },
          { plannedArrival: "20260804152000", actualArrival: "20260804152200" }
        ]
      },
      { id: "tago-train", mode: "fallback", data: null },
      { id: "tour-api", mode: "live", data: [{ title: "전주한옥마을", address: "전주" }] },
      { id: "open-weather", mode: "live", data: { precipitationProbability: 68, windSpeedKmh: 24 } }
    ]
  }, "2026-08-04T17:05:00+09:00");

  assert.equal(signals.scheduledArrival, "2026-08-04T16:30:00+09:00");
  assert.equal(signals.estimatedArrival, "2026-08-04T17:05:00+09:00");
  assert.equal(signals.flightDelayMinutes, 35);
  assert.equal(signals.terminal, "T2");
  assert.deepEqual(signals.busiestHall, { hall: "E", waiting: 130 });
  assert.equal(signals.averageRailDelayMinutes, 3);
  assert.equal(signals.liveInputCount, 4);
  assert.equal(signals.ktxMode, "fallback");
  assert.equal(signals.tourismPlaces[0].title, "전주한옥마을");
  assert.ok(signals.weatherSeverity > 0.8);
  assert.ok(signals.immigrationSeverity > 0);
});

test("fallback rail schedule rebases to the selected arrival date", () => {
  const rail = rebaseRailPlan(demoTrip, "2026-08-04T17:05:00+09:00");
  assert.equal(rail.airportRail[0].departure, "2026-08-04T18:48:00+09:00");
  assert.equal(rail.trains[0].arrival, "2026-08-04T21:54:00+09:00");
  assert.equal(rail.trains.at(-1).arrival, "2026-08-05T00:21:00+09:00");
});
