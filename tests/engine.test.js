import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SIMULATIONS,
  calculateConnectionRisk,
  simulateConnection,
} from "../src/engine.js";

const NORMAL_INPUT = {
  scheduledArrival: "2026-08-12T00:00:00.000Z",
  seed: "normal-case",
  trains: [
    {
      id: "AREX-101",
      service: "AREX",
      departureTime: "2026-08-12T01:50:00.000Z",
      destination: "Seoul",
    },
    {
      id: "AREX-103",
      service: "AREX",
      departureTime: "2026-08-12T02:30:00.000Z",
      destination: "Seoul",
    },
  ],
  traveler: {
    checkedBaggage: true,
  },
  tourismPlan: {
    startTime: "2026-08-12T04:00:00.000Z",
    flexibleMinutes: 45,
  },
};

test("normal arrival keeps the primary train and exposes UI-ready percentiles", () => {
  const result = simulateConnection(NORMAL_INPUT);

  assert.equal(result.schemaVersion, "1.0");
  assert.equal(result.simulationCount, DEFAULT_SIMULATIONS);
  assert.equal(result.recommendation.action, "KEEP_PRIMARY");
  assert.equal(result.recommendation.selectedTrainId, "AREX-101");
  assert.equal(result.candidates[0].riskLevel, "LOW");
  assert.ok(result.candidates[0].boardingProbability >= 0.9);
  assert.ok(result.candidates[0].bufferMinutes.p50 > 0);
  assert.ok(
    result.platformArrival.minutesAfterScheduledArrival.p90 >=
      result.platformArrival.minutesAfterScheduledArrival.p50,
  );
  assert.ok(result.stageBreakdown.immigration.p90Minutes > 0);
  assert.equal(result.tourismAdjustment.required, false);
});

test("compound disruption switches to the next safe train and shifts tourism", () => {
  const result = calculateConnectionRisk({
    ...NORMAL_INPUT,
    seed: "storm-delay-case",
    trains: [
      {
        id: "KTX-RISKY",
        departureTime: "2026-08-12T02:45:00.000Z",
      },
      {
        id: "KTX-SAFE",
        departureTime: "2026-08-12T05:45:00.000Z",
      },
    ],
    scenarios: {
      heavyRain: "severe",
      flightDelayMinutes: 45,
      immigrationCongestion: "severe",
      baggageDelay: true,
      accessibilityNeeds: true,
      largeLuggage: true,
    },
  });

  assert.ok(result.candidates[0].boardingProbability < 0.85);
  assert.match(result.candidates[0].riskLevel, /HIGH|CRITICAL/);
  assert.equal(result.recommendation.action, "SWITCH_TO_SAFER_TRAIN");
  assert.equal(result.recommendation.selectedTrainId, "KTX-SAFE");
  assert.equal(result.recommendation.switched, true);
  assert.equal(result.tourismAdjustment.required, true);
  assert.equal(result.tourismAdjustment.shiftMinutes, 180);
  assert.equal(result.tourismAdjustment.action, "SHIFT_AND_TRIM");
  assert.ok(
    result.candidates[0].riskReasons.includes("IMMIGRATION_CONGESTION"),
  );
  assert.ok(result.candidates[0].riskReasons.includes("LARGE_LUGGAGE"));
});

test("same seed and input produce byte-for-byte reproducible JSON", () => {
  const first = simulateConnection({ ...NORMAL_INPUT, simulations: 200 });
  const second = simulateConnection({ ...NORMAL_INPUT, simulations: 200 });
  const otherSeed = simulateConnection({
    ...NORMAL_INPUT,
    simulations: 200,
    seed: "different-seed",
  });

  assert.deepEqual(second, first);
  assert.notEqual(
    otherSeed.platformArrival.p90,
    first.platformArrival.p90,
  );
});

test("boundary inputs handle one simulation, missed trains, and validation", () => {
  const result = simulateConnection({
    scheduledArrival: "2026-08-12T00:00:00.000Z",
    simulations: 1,
    seed: 0,
    traveler: { checkedBaggage: false },
    trains: [
      {
        id: "ALREADY-GONE",
        departureTime: "2026-08-11T23:59:00.000Z",
      },
    ],
  });

  assert.equal(result.candidates[0].boardingProbability, 0);
  assert.equal(result.candidates[0].riskLevel, "CRITICAL");
  assert.equal(result.recommendation.action, "REPLAN_ROUTE");
  assert.equal(result.recommendation.noSafeCandidate, true);
  assert.equal(result.stageBreakdown.baggageClaim.meanMinutes, 0);

  assert.throws(
    () => simulateConnection({ scheduledArrival: "bad", trains: [] }),
    /scheduledArrival/,
  );
  assert.throws(
    () =>
      simulateConnection({
        scheduledArrival: NORMAL_INPUT.scheduledArrival,
        trains: [
          { id: "DUP", departureTime: "2026-08-12T02:00:00.000Z" },
          { id: "DUP", departureTime: "2026-08-12T03:00:00.000Z" },
        ],
      }),
    /duplicate train id/,
  );
});
