import { demoTrip, disruptionPresets } from "./data.js";
import { simulateConnection } from "./engine.js";
import { predictChakchakJourney } from "./chakchak-ai.js";
import { selectedCandidate } from "./journey-decision.js";
import { rebaseRailPlan } from "./live-journey.js";
import { buildRailPlan } from "./rail-plan.js";
import { buildTravelActivities } from "./travel-itinerary.js";
import { buildTicketProtectionAdvice } from "./ticket-protection.js";
const localTimeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function createJourneyModel(state) {
function currentRailPlan(scheduledArrival) {
  const plan = buildRailPlan(demoTrip, scheduledArrival, state.fusion, state.signals?.terminal);
  // Keep a diagnostic model input for the about/validation panels; never present it as a recommendation.
  return plan.unavailable ? { ...rebaseRailPlan(demoTrip, scheduledArrival), ...plan, airportRail: rebaseRailPlan(demoTrip, scheduledArrival).airportRail, trains: rebaseRailPlan(demoTrip, scheduledArrival).trains } : plan;
}
function buildSimulation(scenarioId) {
  const preset = disruptionPresets[scenarioId];
  const scheduledArrival = state.signals?.scheduledArrival || state.journey.arrivalAt;
  const railPlan = currentRailPlan(scheduledArrival);
  const liveFlightDelay = state.signals?.flightDelayMinutes || 0;
  const liveWeather = state.signals?.weatherSeverity || 0;
  const liveImmigration = state.signals?.immigrationSeverity || 0;
  const addedDelay = Number.isFinite(state.previewDelayMinutes)
    ? Math.max(0, Math.min(90, state.previewDelayMinutes))
    : preset.flightDelayMinutes;
  return simulateConnection({
    scheduledArrival,
    trains: railPlan.airportRail.map((train) => ({
      id: train.id,
      label: train.service,
      service: train.service,
      destination: demoTrip.rail.transferStation,
      departureTime: train.departure
    })),
    seed: `chakchak-${state.journey.flightId}-${scheduledArrival}-${scenarioId}-${state.journey.checkedBags}-${state.journey.mobility}`,
    simulations: 1200,
    boardingBufferMinutes: demoTrip.airport.arexBoardingBufferMinutes,
    safeProbability: 0.85,
    scenarios: {
      heavyRain: Math.max(liveWeather, preset.weatherSeverity),
      flightDelayMinutes: Math.max(0, liveFlightDelay + addedDelay),
      immigrationCongestion: Math.max(liveImmigration, preset.immigrationMultiplier - 1),
      baggageDelayMinutes: preset.baggageDelayMinutes
    },
    traveler: {
      checkedBaggage: state.journey.checkedBags > 0,
      accessibilityNeeds: state.journey.mobility !== "standard",
      largeLuggage: state.journey.largeLuggage
    },
    tourismPlan: {
      startTime: `${scheduledArrival.slice(0, 10)}T22:20:00+09:00`,
      flexibleMinutes: 45
    }
  });
}

function buildChakchakInput(scenarioId, scheduledArrival, railPlan) {
  const preset = disruptionPresets[scenarioId];
  const liveFlightDelay = state.signals?.flightDelayMinutes || 0;
  const addedDelay = Number.isFinite(state.previewDelayMinutes)
    ? Math.max(0, Math.min(90, state.previewDelayMinutes))
    : preset.flightDelayMinutes;
  return {
    scheduledArrival,
    context: {
      flightDelayMinutes: Math.max(0, liveFlightDelay + addedDelay),
      weatherSeverity: Math.max(state.signals?.weatherSeverity || 0, preset.weatherSeverity),
      immigrationSeverity: Math.max(state.signals?.immigrationSeverity || 0, preset.immigrationMultiplier - 1),
      baggageDelayMinutes: preset.baggageDelayMinutes,
      checkedBaggage: state.journey.checkedBags > 0,
      accessibilityNeeds: state.journey.mobility !== "standard",
      largeLuggage: state.journey.largeLuggage,
      terminal: state.signals?.terminal || demoTrip.flight.terminal,
      arrivalHourLocal: localHourFromIso(scheduledArrival),
      boardingBufferMinutes: demoTrip.airport.arexBoardingBufferMinutes,
      flightMode: state.signals?.inputModes?.flight,
      immigrationMode: state.signals?.inputModes?.immigration,
      weatherMode: state.signals?.inputModes?.weather
    },
    candidates: railPlan.airportRail.map((train) => {
      const ktx = railPlan.trains.find((candidate) => candidate.recommendedArexId === train.id);
      return {
        id: train.id,
        departureTime: train.departure,
        destinationArrivalTime: ktx?.arrival,
        accessibilityReady: typeof ktx?.accessibilityReady === "boolean" ? ktx.accessibilityReady : undefined,
        price: ktx?.price,
        transferCount: 1,
        reservationAvailable: null
      };
    }),
    preferences: {
      maxPrice: 50_000,
      maxTransfers: 2,
      arrivalToFirstMinutes: 20
    },
    activities: buildTravelActivities(scheduledArrival, state.signals?.tourismPlaces)
  };
}

function localHourFromIso(value) {
  const [hour, minute] = localTimeFormatter.format(new Date(value)).split(":").map(Number);
  return hour + minute / 60;
}

function buildChakchakPrediction(scenarioId, scheduledArrival, railPlan) {
  return predictChakchakJourney(buildChakchakInput(scenarioId, scheduledArrival, railPlan));
}

let viewModelCache = null;

function getViewModel() {
  const dependencies = {
    scenarioId: state.scenarioId,
    previewDelayMinutes: state.previewDelayMinutes,
    journey: state.journey,
    signals: state.signals,
    confirmedJourney: state.confirmedJourney,
    minuteBucket: Math.floor(Date.now() / 60_000)
  };
  if (
    viewModelCache
    && viewModelCache.scenarioId === dependencies.scenarioId
    && viewModelCache.previewDelayMinutes === dependencies.previewDelayMinutes
    && viewModelCache.journey === dependencies.journey
    && viewModelCache.signals === dependencies.signals
    && viewModelCache.confirmedJourney === dependencies.confirmedJourney
    && viewModelCache.minuteBucket === dependencies.minuteBucket
  ) {
    return viewModelCache.value;
  }

  const preset = disruptionPresets[state.scenarioId];
  const simulation = buildSimulation(state.scenarioId);
  const primary = simulation.candidates[0];
  const scheduledArrival = state.signals?.scheduledArrival || state.journey.arrivalAt;
  const railPlan = currentRailPlan(scheduledArrival);
  const chakchakAi = buildChakchakPrediction(state.scenarioId, scheduledArrival, railPlan);
  const modelFallbackRequired = Boolean(chakchakAi.decision?.fallbackRequired);
  const decisionIndex = simulation.candidates.findIndex((candidate) => candidate.id === chakchakAi.recommendation.selectedTrainId);
  const recovery = simulation.candidates[Math.max(0, decisionIndex)] || primary;
  const savedCandidate = selectedCandidate(simulation.candidates, state.confirmedJourney);
  const confirmedCandidate = savedCandidate && chakchakAi.optimization.candidates.find(c => c.id === savedCandidate.id)?.feasible ? savedCandidate : null;
  const activeCandidate = confirmedCandidate || primary;
  const activeArex = railPlan.airportRail.find((train) => train.id === activeCandidate.id);
  const activeKtx = railPlan.trains.find((train) => train.recommendedArexId === activeCandidate.id);
  const protectionCandidate = confirmedCandidate || recovery;
  const protectionArex = railPlan.airportRail.find((train) => train.id === protectionCandidate.id);
  const protectionKtx = railPlan.trains.find((train) => train.recommendedArexId === protectionCandidate.id);
  const ticketProtection = buildTicketProtectionAdvice({
    ticket: state.journey.ticket,
    existingArex: railPlan.airportRail[0],
    existingKtx: railPlan.trains[0],
    alternativeArex: protectionArex,
    alternativeKtx: protectionKtx,
    allKtx: railPlan.trains,
    journey: state.journey
  });

  const viewModel = {
    preset,
    simulation,
    primary,
    recovery,
    activeCandidate,
    activeArex,
    activeKtx,
    railPlan,
    signals: state.signals,
    chakchakAi,
    modelFallbackRequired,
    modelByTrainId: new Map(chakchakAi.candidates.map((candidate) => [candidate.id, candidate])),
    decisionByTrainId: new Map(chakchakAi.candidates.map((candidate) => [candidate.id, candidate.decisionProfile])),
    baselineProbability: chakchakAi.candidates[0]?.probabilityWaterfall.baselinePercent ?? 0,
    isDisrupted: state.scenarioId !== "normal" || state.previewDelayMinutes > 0,
    noSafeCandidate: railPlan.unavailable || chakchakAi.recommendation.noSafeCandidate,
    activities: buildTravelActivities(scheduledArrival, state.signals?.tourismPlaces),
    canRecover: !railPlan.unavailable && !chakchakAi.recommendation.noSafeCandidate && recovery.id !== primary.id,
    confirmedJourney: state.confirmedJourney,
    isRecovered: !railPlan.unavailable && !chakchakAi.recommendation.noSafeCandidate && Boolean(state.confirmedJourney && activeCandidate.id !== primary.id),
    modelEngineAgreement: Boolean(chakchakAi.decision?.reconciliation?.agreement),
    ticketProtection
  };
  viewModelCache = { ...dependencies, value: viewModel };
  return viewModel;
}


return { getViewModel, buildChakchakInput };
}
