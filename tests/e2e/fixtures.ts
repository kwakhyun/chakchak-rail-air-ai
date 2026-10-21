import { demoTrip } from "../../src/data.js";
import { rebaseRailPlan } from "../../src/live-journey.js";

export function liveFusionFor(at = "2030-09-06T17:05:00+09:00") {
  const plan = rebaseRailPlan(demoTrip, at);
  return {
    overallMode: "hybrid", sourceSummary: { live: 3, demo: 4 },
    sources: [
      { id: "incheon-flight", mode: "live", data: { flightId: "KE704", scheduledTime: "1705", estimatedTime: "1705", terminal: "P03", origin: "도쿄" } },
      { id: "airport-rail", mode: "live", data: plan.airportRail.map(train => ({ trainNo: train.id, departureStation: "인천공항2터미널", arrivalStation: "서울", plannedDeparture: train.departure, plannedArrival: train.arrival })) },
      { id: "tago-train", mode: "live", data: plan.trains.map(train => ({ trainNo: train.service.replace("KTX ", ""), departureStation: "서울", arrivalStation: "전주", departureTime: train.departure, arrivalTime: train.arrival, adultFare: train.price, accessibilityReady: true })) }
    ]
  };
}
