import { demoTrip, disruptionPresets, sourceCatalog, tourismPlan } from "./data.js";
import { simulateConnection } from "./engine.js";
import { predictChakchakJourney } from "./chakchak-ai.js";
import { P2_VALIDATION_PROTOCOL } from "./real-world-validation.js";
import {
  clearConfirmedJourney,
  createConfirmedJourney,
  loadConfirmedJourney,
  saveConfirmedJourney,
  selectedCandidate
} from "./journey-decision.js";
import {
  deriveJourneySignals,
  fromDateTimeLocalValue,
  rebaseRailPlan,
  todayArrival,
  toDateTimeLocalValue
} from "./live-journey.js";
import { buildTicketProtectionAdvice, TICKET_TYPES } from "./ticket-protection.js";

const app = document.querySelector("#app");
const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul"
});

const iconAsset = (name) => `/assets/icons/chakchak/${name}.svg`;
const ICONS = Object.freeze({
  navMove: { outline: iconAsset("nav-move-outline"), active: iconAsset("nav-move-active") },
  navTrain: { outline: iconAsset("nav-train-outline"), active: iconAsset("nav-train-active") },
  navTravel: { outline: iconAsset("nav-travel-outline"), active: iconAsset("nav-travel-active") },
  navRecord: { outline: iconAsset("nav-record-outline"), active: iconAsset("nav-record-active") },
  signalFlight: iconAsset("signal-flight"),
  signalImmigration: iconAsset("signal-immigration"),
  signalWeather: iconAsset("signal-weather"),
  signalRail: iconAsset("signal-airport-rail"),
  reconciliation: iconAsset("model-reconciliation"),
  reasonSuccess: iconAsset("reason-success"),
  reasonBuffer: iconAsset("reason-buffer"),
  reasonDestination: iconAsset("reason-destination"),
  reasonMobility: iconAsset("reason-mobility"),
  timelineAirport: iconAsset("timeline-airport"),
  timelineTransfer: iconAsset("timeline-transfer"),
  timelineDestination: iconAsset("timeline-destination"),
  travelFood: iconAsset("travel-food"),
  travelCulture: iconAsset("travel-culture"),
  travelExperience: iconAsset("travel-experience"),
  travelStay: iconAsset("travel-stay"),
  travelFallback: iconAsset("travel-fallback"),
  travelPreview: iconAsset("travel-preview"),
  travelArrival: iconAsset("travel-arrival"),
  travelTime: iconAsset("travel-time"),
  travelFirstPlace: iconAsset("travel-first-place"),
  journeyConfirmed: iconAsset("journey-confirmed"),
  journeyLive: iconAsset("journey-live"),
  journeyModel: iconAsset("journey-model"),
  routeAirport: iconAsset("route-airport"),
  routeArex: iconAsset("route-arex"),
  routeKtx: iconAsset("route-ktx"),
  routeDestination: iconAsset("route-destination"),
  stageOrigin: iconAsset("stage-origin"),
  stageAirport: iconAsset("stage-airport"),
  stageArex: iconAsset("stage-arex"),
  stageSeoul: iconAsset("stage-seoul"),
  stageKtx: iconAsset("stage-ktx"),
  stageDestination: iconAsset("stage-destination"),
  decisionPlatform: iconAsset("decision-platform"),
  decisionArex: iconAsset("decision-arex"),
  decisionKtx: iconAsset("decision-ktx"),
  decisionDestination: iconAsset("decision-destination"),
  routeHeading: iconAsset("route-heading"),
  travelRecheck: iconAsset("travel-recheck"),
  fieldSave: iconAsset("field-step-save"),
  fieldPlatform: iconAsset("field-step-platform"),
  fieldTrain: iconAsset("field-step-train"),
  fieldResults: iconAsset("field-step-results"),
  fieldPrivate: iconAsset("field-private"),
  fieldParticipate: iconAsset("field-participate"),
  fieldRecord: iconAsset("field-record"),
  fieldPublished: iconAsset("field-results"),
  fieldGate: iconAsset("field-gate"),
  fieldQuality: iconAsset("field-quality"),
  fieldAccess: iconAsset("field-access"),
  fieldDisruption: iconAsset("field-disruption"),
  fieldOps: iconAsset("field-ops"),
  fieldHonest: iconAsset("field-honest"),
  fieldPending: iconAsset("field-pending"),
  aboutData: iconAsset("about-data"),
  guideMove: iconAsset("guide-move"),
  guideTrain: iconAsset("guide-train"),
  guideTravel: iconAsset("guide-travel"),
  serviceInfo: iconAsset("service-info"),
  promiseSafety: iconAsset("promise-safety"),
  promiseSource: iconAsset("promise-source"),
  promisePrivacy: iconAsset("promise-privacy"),
  promiseOfficial: iconAsset("promise-official")
});

const navigation = Object.freeze([
  { id: "journey", label: "내 이동", icon: ICONS.navMove.outline, activeIcon: ICONS.navMove.active },
  { id: "routes", label: "다음 열차", icon: ICONS.navTrain.outline, activeIcon: ICONS.navTrain.active },
  { id: "travel", label: "여행 일정", icon: ICONS.navTravel.outline, activeIcon: ICONS.navTravel.active },
  { id: "validation", label: "이동 기록", icon: ICONS.navRecord.outline, activeIcon: ICONS.navRecord.active },
  { id: "about", label: "서비스 안내", icon: ICONS.serviceInfo, activeIcon: ICONS.serviceInfo }
]);
const primaryNavigation = Object.freeze(navigation.filter((item) => item.id !== "about"));

const hashView = window.location.hash.replace("#", "");
const initialArrival = todayArrival("17:05");
const initialJourney = {
  flightId: demoTrip.flight.flightId,
  arrivalAt: initialArrival,
  destination: demoTrip.destination.city,
  stayNights: demoTrip.destination.stayNights,
  checkedBags: demoTrip.traveller.checkedBags,
  mobility: demoTrip.traveller.mobility,
  largeLuggage: false,
  ticket: {
    hasBookedTicket: true,
    korail: true,
    arex: true,
    ticketType: "standard",
    arexType: "direct"
  },
  interests: [...demoTrip.traveller.interests]
};
const initialConfirmedJourney = loadConfirmedJourney(window.sessionStorage, initialJourney);
const initialScenarioId = initialConfirmedJourney?.scenarioId || "normal";
const journeySceneCatalog = Object.freeze({
  전주: {
    src: "/assets/illustrations/rail-air-journey-3d.png",
    label: "전주 한옥 장면"
  },
  부산: {
    src: "/assets/illustrations/rail-air-journey-3d-busan.png",
    label: "부산 바다 장면"
  },
  강릉: {
    src: "/assets/illustrations/rail-air-journey-3d-gangneung.png",
    label: "강릉 바다 장면"
  }
});
const travelVisualAssets = Object.freeze({
  replanGuide: "/assets/travel/travel-replan-guide-3d.webp",
  placeFallback: "/assets/travel/travel-place-fallback-3d.webp"
});
const state = {
  scenarioId: initialScenarioId,
  previewDelayMinutes: disruptionPresets[initialScenarioId]?.flightDelayMinutes || 0,
  customDelayActive: false,
  travelDay: "all",
  confirmedJourney: initialConfirmedJourney,
  dataMode: "offline-demo",
  fusion: null,
  fusionLoading: true,
  signals: null,
  journey: initialJourney,
  openaiConfigured: false,
  aiModel: "gpt-5.6-luna",
  aiLocale: "ko",
  aiStatus: "idle",
  aiMode: null,
  aiGuidance: null,
  aiError: null,
  guideOpen: false,
  guideStatus: "idle",
  guideQuestion: "",
  guideAnswer: null,
  guideMode: null,
  guideError: null,
  guideRequestId: 0,
  validationStatus: null,
  pilotStatus: null,
  validationLoading: true,
  validationBusy: false,
  validationError: null,
  validationSession: loadStoredValidationSession(),
  activeView: navigation.some((item) => item.id === hashView) ? hashView : "journey"
};

function buildSimulation(scenarioId) {
  const preset = disruptionPresets[scenarioId];
  const scheduledArrival = state.signals?.scheduledArrival || state.journey.arrivalAt;
  const railPlan = rebaseRailPlan(demoTrip, scheduledArrival);
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
    activities: buildOptimizationActivities(scheduledArrival)
  };
}

function buildOptimizationActivities(scheduledArrival) {
  const date = scheduledArrival.slice(0, 10);
  const nextDate = new Date(`${date}T12:00:00+09:00`);
  nextDate.setDate(nextDate.getDate() + 1);
  const next = nextDate.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  return [
    {
      id: "night-market",
      title: "지역 야간 일정",
      openingTime: `${date}T21:30:00+09:00`,
      closingTime: `${date}T23:30:00+09:00`,
      durationMinutes: 45,
      minimumDurationMinutes: 20,
      travelMinutes: 15,
      required: false
    },
    {
      id: "check-in",
      title: "숙소 체크인",
      openingTime: `${date}T20:00:00+09:00`,
      closingTime: `${next}T02:00:00+09:00`,
      durationMinutes: 30,
      minimumDurationMinutes: 20,
      travelMinutes: 15,
      required: true
    },
    {
      id: "reserved-experience",
      title: "예약 체험",
      openingTime: `${next}T09:00:00+09:00`,
      closingTime: `${next}T17:00:00+09:00`,
      durationMinutes: 60,
      minimumDurationMinutes: 45,
      travelMinutes: 25,
      required: false,
      reservationTime: `${next}T10:10:00+09:00`,
      reservationToleranceMinutes: 60
    }
  ];
}

function localHourFromIso(value) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const [hour, minute] = formatter.format(new Date(value)).split(":").map(Number);
  return hour + minute / 60;
}

function buildChakchakPrediction(scenarioId, scheduledArrival, railPlan) {
  return predictChakchakJourney(buildChakchakInput(scenarioId, scheduledArrival, railPlan));
}

function getViewModel() {
  const preset = disruptionPresets[state.scenarioId];
  const simulation = buildSimulation(state.scenarioId);
  const primary = simulation.candidates[0];
  const scheduledArrival = state.signals?.scheduledArrival || state.journey.arrivalAt;
  const railPlan = rebaseRailPlan(demoTrip, scheduledArrival);
  const chakchakAi = buildChakchakPrediction(state.scenarioId, scheduledArrival, railPlan);
  const modelFallbackRequired = Boolean(chakchakAi.decision?.fallbackRequired);
  const decisionIndex = simulation.candidates.findIndex((candidate) => candidate.id === chakchakAi.recommendation.selectedTrainId);
  const recovery = simulation.candidates[Math.max(0, decisionIndex)] || primary;
  const confirmedCandidate = selectedCandidate(simulation.candidates, state.confirmedJourney);
  const activeCandidate = confirmedCandidate || primary;
  const activeArex = railPlan.airportRail.find((train) => train.id === activeCandidate.id);
  const activeKtx = railPlan.trains.find((train) => train.recommendedArexId === activeCandidate.id);
  const normalSimulation = state.scenarioId === "normal" ? simulation : buildSimulation("normal");
  const normalChakchakAi = state.scenarioId === "normal"
    ? chakchakAi
    : buildChakchakPrediction("normal", scheduledArrival, railPlan);
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

  return {
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
    baselineProbability: normalChakchakAi.candidates[0]?.boardingProbabilityPercent ?? normalSimulation.candidates[0].boardingProbabilityPercent,
    isDisrupted: state.scenarioId !== "normal" || state.previewDelayMinutes > 0,
    canRecover: recovery.id !== primary.id,
    confirmedJourney: state.confirmedJourney,
    isRecovered: Boolean(state.confirmedJourney && activeCandidate.id !== primary.id),
    modelEngineAgreement: Boolean(chakchakAi.decision?.reconciliation?.agreement),
    ticketProtection
  };
}

function modelPredictionFor(view, candidate) {
  return view.modelByTrainId?.get(candidate.id) || null;
}

function displayedProbability(view, candidate) {
  return view.decisionByTrainId?.get(candidate.id)?.conservativeProbabilityPercent ?? candidate.boardingProbabilityPercent;
}

function displayedRiskLevel(view, candidate) {
  const profile = view.decisionByTrainId?.get(candidate.id);
  if (!profile) return candidate.riskLevel;
  if (profile.conservativeProbability >= 0.9 && profile.p90BufferMinutes >= 0) return "LOW";
  if (profile.conservativeProbability >= 0.75 && profile.p90BufferMinutes >= -5) return "MEDIUM";
  return profile.conservativeProbability >= 0.4 ? "HIGH" : "CRITICAL";
}

function predictionSourceLabel(view) {
  return view.modelFallbackRequired ? "안전을 한 번 더 확인" : "착착 안전 확인";
}

function decisionProfileFor(view, candidate) {
  return view.decisionByTrainId?.get(candidate.id) || null;
}

function formatTime(value) {
  return timeFormatter.format(new Date(value));
}

function formatTimeAfterMinutes(value, minutes) {
  return formatTime(new Date(new Date(value).getTime() + minutes * 60_000));
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isCompactScreen() {
  return window.matchMedia("(max-width: 720px)").matches;
}

function dataModeLabel() {
  if (state.fusion?.sourceSummary) {
    const { live = 0, fallback = 0 } = state.fusion.sourceSummary;
    return fallback > 0 ? `${live}개 최신 정보 · ${fallback}개 자동 보완` : `${live}개 최신 정보 연결`;
  }
  if (state.dataMode === "live-ready") return "공공데이터 연결됨";
  if (state.dataMode === "hybrid-demo") return "최신 정보 · 자동 보완";
  return "체험용 정보";
}

function headerDataModeLabel() {
  if (state.fusion?.sourceSummary) {
    return `${state.fusion.sourceSummary.live || 0}/7 데이터 연결`;
  }
  if (state.dataMode === "live-ready") return "공공데이터 연결";
  if (state.dataMode === "hybrid-demo") return "실시간·체험 정보";
  return "체험용 정보";
}

function riskTone(level) {
  if (level === "LOW") return "safe";
  if (level === "MEDIUM") return "watch";
  return "risk";
}

function riskLabel(level) {
  return {
    LOW: "여유 있어요",
    MEDIUM: "서둘러야 해요",
    HIGH: "다음 열차 추천",
    CRITICAL: "다음 열차 추천"
  }[level] || "확인하고 있어요";
}

function probabilitySentence(probability) {
  if (probability >= 95) return "20번 중 19번 이상 탈 수 있어요";
  if (probability >= 90) return "10번 중 9번 이상 탈 수 있어요";
  if (probability >= 85) return "착착 안전 기준을 넘겼어요";
  if (probability >= 70) return "10번 중 7~8번 탈 수 있어요";
  if (probability >= 40) return "시간이 빠듯해요";
  return "지금 열차는 놓칠 가능성이 커요";
}

function stageRows(simulation) {
  const labels = {
    flightArrivalDelay: "비행기 도착 지연",
    deplaning: "비행기에서 내리기",
    immigration: "입국심사",
    baggageClaim: "짐 찾기",
    airportMovement: "공항 안에서 이동",
    railPlatformAccess: "열차 타는 곳까지 이동"
  };
  return Object.entries(simulation.stageBreakdown)
    .map(
      ([key, value]) => `
        <div class="factor-row">
          <span>${labels[key]}</span>
          <div class="factor-track" aria-hidden="true">
            <div class="factor-fill" style="--factor-value:${Math.min(100, Math.max(6, value.p90Minutes * 2.1))}%;--factor-color:${key === "immigration" ? "var(--travel-yellow)" : "var(--air-teal)"}"></div>
          </div>
          <output>${Math.round(value.p90Minutes)}분</output>
        </div>`
    )
    .join("");
}

function signalModeLabel(mode) {
  return mode === "live" ? "최신 정보" : mode === "fallback" ? "자동 보완" : "체험 정보";
}

function liveSignalBoard(view) {
  const signals = view.signals;
  if (state.fusionLoading && !signals) {
    return `<section class="panel signal-board is-loading" aria-busy="true"><div class="signal-board-head"><div><span class="eyebrow">지금 상황</span><h2>공항과 철도 상황을 연결하고 있어요</h2></div><span class="data-pulse">연결 중</span></div><div class="signal-skeleton" aria-hidden="true"><i></i><i></i><i></i><i></i></div></section>`;
  }

  const modes = signals?.inputModes || {};
  const flightValue = signals
    ? signals.flightDelayMinutes > 0 ? `+${signals.flightDelayMinutes}분` : "정시권"
    : "체험";
  const immigrationValue = signals ? `${signals.immigrationTotal.toLocaleString("ko-KR")}명` : "보통";
  const weatherValue = signals ? `${Math.round(signals.precipitationProbability)}%` : "낮음";
  const railValue = signals?.averageRailDelayMinutes === null || signals?.averageRailDelayMinutes === undefined
    ? signals?.railObservationCount ? `${signals.railObservationCount}건` : "시간표"
    : `${signals.averageRailDelayMinutes >= 0 ? "+" : ""}${signals.averageRailDelayMinutes}분`;
  const liveCount = signals?.liveInputCount || 0;

  const cards = [
    { id: "flight", icon: ICONS.signalFlight, label: "항공 도착", value: flightValue, note: signals ? `${signals.airline} · ${signals.terminal} · 게이트 ${signals.gate}` : "대표 항공편 시나리오" },
    { id: "immigration", icon: ICONS.signalImmigration, label: "입국장", value: immigrationValue, note: signals ? `가장 붐비는 ${signals.busiestHall.hall} 입국장 ${signals.busiestHall.waiting}명` : "평균 혼잡 시나리오" },
    { id: "weather", icon: ICONS.signalWeather, label: "공항 날씨", value: weatherValue, note: signals ? `강수확률 · 바람 ${Math.round(signals.windSpeedKmh)}km/h` : "기본 날씨 시나리오" },
    { id: "rail", icon: ICONS.signalRail, label: "공항철도", value: railValue, note: signals?.railObservationCount ? `운행 관측 ${signals.railObservationCount}건 반영` : "검증된 시간표 사용" }
  ];

  return `
    <section class="panel signal-board" aria-labelledby="signal-board-title">
      <div class="signal-board-head">
        <div><span class="eyebrow">지금 상황</span><h2 id="signal-board-title">공항과 철도의 지금 상황이 한곳에 모였어요</h2><p>항공 도착, 입국장, 날씨와 공항철도 운행을 함께 살펴봅니다.</p></div>
        <div class="coverage-badge" aria-label="여정 신호 ${liveCount}개 중 ${signals?.inputSourceCount || 4}개 실시간"><strong>${liveCount}/${signals?.inputSourceCount || 4}</strong><span>실시간 신호</span></div>
      </div>
      <ol class="signal-network">
        ${cards.map((card) => `
          <li class="signal-node mode-${escapeHtml(modes[card.id] || "demo")}">
            <div class="signal-icon"><img src="${card.icon}" alt="" aria-hidden="true" /></div>
            <span>${card.label}</span>
            <strong>${escapeHtml(card.value)}</strong>
            <small>${escapeHtml(card.note)}</small>
            <em>${signalModeLabel(modes[card.id] || "demo")}</em>
          </li>`).join("")}
      </ol>
      <div class="signal-to-decision"><span>지금 정보</span><i aria-hidden="true"></i><strong>놓칠 가능성 확인</strong><i aria-hidden="true"></i><span>안전한 열차·지역 일정</span></div>
    </section>`;
}

function chakchakModelPanel(view) {
  const prediction = modelPredictionFor(view, view.activeCandidate);
  if (!prediction) return "";
  const shownProbability = view.modelFallbackRequired ? displayedProbability(view, view.activeCandidate) : prediction.boardingProbabilityPercent;
  const shownSafe = view.modelFallbackRequired ? view.activeCandidate.isSafe : prediction.isSafe;
  const oodReasons = view.chakchakAi.decision?.oodReasons || [];
  const waterfall = prediction.probabilityWaterfall;
  const visibleEffects = waterfall.contributions;
  const maxEffect = Math.max(1, ...visibleEffects.map((effect) => Math.abs(effect.effectPercentPoints)));
  return `
    <section class="panel chakchak-model-panel" aria-labelledby="chakchak-model-title">
      <div class="model-panel-head">
        <div><span class="eyebrow">착착 안전 확인</span><h2 id="chakchak-model-title">${view.modelFallbackRequired ? "낯선 상황이라 더 여유 있게 살펴봤어요" : "지금 열차를 탈 수 있을지 살펴봤어요"}</h2><p>항공 도착, 입국장, 날씨, 짐과 걷는 속도를 함께 보고 안내합니다.</p></div>
        <span class="model-version">확인 완료<small>한 번 더 점검</small></span>
      </div>
      ${view.modelFallbackRequired ? `<div class="model-ood-alert" role="status"><strong>더 안전하게 안내해요</strong><span>평소와 다른 상황이라 시간을 넉넉하게 잡았습니다.</span>${oodReasons.length ? `<small>확실하지 않을 때는 빠른 열차보다 여유 있는 열차를 먼저 보여드려요.</small>` : ""}</div>` : ""}
      <div class="model-visual-grid">
        <div class="model-score-card">
          <span>이 열차를 탈 수 있는 가능성</span>
          <strong>${formatPercent(shownProbability)}</strong>
          <p>${shownSafe ? "여유 있게 이동할 수 있어요" : "더 여유 있는 열차가 필요해요"}</p>
          <div class="model-validation"><span>항공·공항 상황 <b>반영</b></span><span>짐·이동 도움 <b>반영</b></span></div>
          <em class="model-not-operational">좌석과 운임은 코레일에서 마지막으로 확인해 주세요.</em>
        </div>
        <div class="model-factor-card">
          <div class="model-factor-head"><strong>무엇이 영향을 주었나요?</strong><span>좋아진 점과 조심할 점</span></div>
          <div class="waterfall-equation" aria-label="평소 ${waterfall.baselinePercent}퍼센트에서 현재 ${waterfall.predictedPercent}퍼센트로 바뀜">
            <span><b>${waterfall.baselinePercent}%</b><small>평소 상황</small></span><i aria-hidden="true">→</i><span><b>${waterfall.predictedPercent}%</b><small>지금 상황</small></span>
          </div>
          <ol class="model-waterfall-list">
            ${visibleEffects.map((effect) => {
              const width = Math.max(3, Math.round(Math.abs(effect.effectPercentPoints) / maxEffect * 50));
              const change = Math.abs(Math.round(effect.effectPercentPoints));
              const changeLabel = effect.effectPercentPoints < 0 ? `${change}% 낮아짐` : `${change}% 높아짐`;
              return `<li class="effect-${effect.direction}"><span>${escapeHtml(effect.label)}</span><div class="waterfall-track" aria-hidden="true"><i style="--effect-width:${width}%"></i></div><strong>${changeLabel}</strong></li>`;
            }).join("")}
          </ol>
          <p class="waterfall-proof"><b>쉽게 설명했어요</b><span>항공 지연, 입국장, 날씨, 짐과 이동 속도를 빠짐없이 함께 봤습니다.</span></p>
        </div>
      </div>
      <div class="model-pipeline" aria-label="착착이 안내를 준비하는 순서">
        <span><b>${prediction.inputCoverage.liveRiskSignals}/${prediction.inputCoverage.totalRiskSignals}</b> 지금 정보 반영</span><i aria-hidden="true">→</i>
        <span><b>여러 경우</b> 함께 살펴보기</span><i aria-hidden="true">→</i>
        <span><b>${view.modelFallbackRequired ? "여유 있게" : view.modelEngineAgreement ? "한 번 더" : "더 안전하게"}</b> 마지막 확인</span>
      </div>
      <details class="model-stress-audit"><summary>어떻게 안전을 확인했나요?</summary><p>항공편이 늦거나 입국장이 붐비는 여러 상황을 반복해서 살펴봤습니다. 판단이 어려우면 빠른 열차보다 여유 있는 열차를 먼저 안내합니다.</p></details>
      <p class="model-disclaimer">현재는 시험 운영 중이며 실제 좌석이나 탑승을 보장하지 않습니다.</p>
    </section>`;
}

function reconciliationPanel(view) {
  const reconciliation = view.chakchakAi.decision?.reconciliation;
  if (!reconciliation) return "";
  const title = reconciliation.status === "OOD_ENGINE_ONLY"
    ? "낯선 상황이라 더 여유 있게 확인했어요"
    : reconciliation.agreement
      ? "도착 상황과 이동 조건을 다시 확인했어요"
      : "결과가 달라 더 안전한 열차를 골랐어요";
  return `
    <div class="recommendation-proof status-${reconciliation.agreement ? "safe" : "watch"}">
      <img src="${ICONS.reconciliation}" alt="" aria-hidden="true" />
      <div><strong>${escapeHtml(title)}</strong><p>항공 도착, 입국장 상황, 짐과 걷는 속도를 함께 살펴 최종 열차를 골랐어요.</p></div>
      <ul aria-label="확인한 내용"><li>도착 상황 확인</li><li>개인 이동 조건 확인</li></ul>
    </div>`;
}

function recommendationDetails(view, candidate) {
  const arex = view.railPlan.airportRail.find((train) => train.id === candidate.id);
  const ktx = view.railPlan.trains.find((train) => train.recommendedArexId === candidate.id);
  const profile = decisionProfileFor(view, candidate);
  const probability = Math.round(displayedProbability(view, candidate));
  const p90Buffer = Math.round(candidate.bufferMinutes.p90);
  const arrivalDelay = Math.max(0, Math.round(profile?.destinationDelayMinutes || 0));
  const waitMinutes = Math.max(0, Math.round(profile?.avoidableWaitMinutes || 0));
  const mobilityValue = state.journey.mobility === "standard" ? "편하게 이동" : "도움 반영";
  const mobilityNote = state.journey.mobility === "standard"
    ? `짐 ${state.journey.checkedBags}개와 보통 걸음을 반영했어요`
    : "걷는 속도와 이동 도움을 반영했어요";
  const recommendationTitle = view.isRecovered
    ? "선택한 열차로 안심하고 이동하세요"
    : view.canRecover
      ? "놓칠 걱정을 줄이는 열차예요"
      : "빠르면서도 갈아탈 여유가 있어요";
  const reasons = [
    { icon: ICONS.reasonSuccess, label: "놓치지 않을 가능성", value: `${probability}%`, note: probability >= 85 ? "여유 있게 탈 수 있어요" : "조금 더 살펴봐야 해요" },
    { icon: ICONS.reasonBuffer, label: "갈아탈 여유", value: p90Buffer >= 0 ? `${p90Buffer}분` : `${Math.abs(p90Buffer)}분 부족`, note: p90Buffer >= 0 ? "늦은 경우에도 남는 시간이에요" : "다음 열차가 더 안전해요" },
    { icon: ICONS.reasonDestination, label: `${escapeHtml(state.journey.destination)} 도착`, value: formatTime(ktx.arrival), note: arrivalDelay ? `가장 빠른 안전 일정보다 ${arrivalDelay}분 늦어요` : "가장 빠른 안전 일정이에요" },
    { icon: ICONS.reasonMobility, label: "내 이동 조건", value: mobilityValue, note: mobilityNote }
  ];
  return `
    <section class="recommendation-overview" aria-labelledby="recommendation-detail-title">
      <header class="recommendation-overview-head">
        <div class="recommendation-title-block"><span>착착의 추천</span><h2 id="recommendation-detail-title">${recommendationTitle}</h2><p>${formatTime(arex.departure)} 공항철도를 타고 서울역에서 ${escapeHtml(ktx.service)}로 갈아타세요.</p></div>
        <div class="recommendation-confidence tone-${riskTone(displayedRiskLevel(view, candidate))}"><span>놓치지 않을 가능성</span><strong>${probability}%</strong><small>${riskLabel(displayedRiskLevel(view, candidate))}</small></div>
      </header>
      <ol class="recommendation-timeline" aria-label="추천 열차 이동 시간표">
        <li><img src="${ICONS.timelineAirport}" alt="" aria-hidden="true" /><span>인천공항</span><strong>${formatTime(arex.departure)}</strong><small>공항철도 출발</small></li>
        <li><img src="${ICONS.timelineTransfer}" alt="" aria-hidden="true" /><span>서울역</span><strong>${formatTime(ktx.departure)}</strong><small>${escapeHtml(ktx.service)} 출발</small></li>
        <li><img src="${ICONS.timelineDestination}" alt="" aria-hidden="true" /><span>${escapeHtml(state.journey.destination)}역</span><strong>${formatTime(ktx.arrival)}</strong><small>여행 시작</small></li>
      </ol>
      <section class="recommendation-reasons" aria-labelledby="recommendation-reasons-title">
        <div class="recommendation-section-heading"><div><span>추천 이유</span><h3 id="recommendation-reasons-title">중요한 네 가지만 보여드려요</h3></div><p>${waitMinutes ? `기다림은 약 ${waitMinutes}분이에요.` : "불필요하게 기다리지 않아도 돼요."}</p></div>
        <ul class="recommendation-reason-grid">
          ${reasons.map((reason) => `<li><img src="${reason.icon}" alt="" aria-hidden="true" /><span>${reason.label}</span><strong>${reason.value}</strong><small>${reason.note}</small></li>`).join("")}
        </ul>
        <p class="recommendation-summary">${view.canRecover ? "조금 늦게 출발해도 놓칠 걱정을 크게 줄이고, 도착 뒤 여행 일정까지 이어갈 수 있는 선택이에요." : "목적지에는 빠르게 도착하면서 서울역에서 서두르지 않아도 되는 일정이에요."}</p>
      </section>
      <div class="recommendation-actions">
        ${view.canRecover && !view.isRecovered ? `<button class="button button-primary" data-open-recovery type="button">승차권 보호 순서 확인</button>` : ""}
        <a class="button button-soft" href="https://www.letskorail.com/" target="_blank" rel="noreferrer">코레일에서 좌석 확인</a>
        <a class="button button-plain" href="https://www.arex.or.kr/" target="_blank" rel="noreferrer">공항철도 운행 확인</a>
      </div>
    </section>`;
}

function ticketProtectionPanel(view) {
  const advice = view.ticketProtection;
  if (!advice?.hasBookedTicket) {
    return `
      <section class="panel ticket-protection-empty" aria-labelledby="ticket-protection-title">
        <img src="${ICONS.promiseOfficial}" alt="" aria-hidden="true" />
        <div><span class="eyebrow">승차권 보호</span><h2 id="ticket-protection-title">이미 예매한 표가 있나요?</h2><p>표 종류와 운영사를 알려주면 반환 마감과 안전한 처리 순서를 함께 보여드려요.</p></div>
        <button class="button button-soft" id="open-ticket-setup" type="button">예매한 표 입력</button>
      </section>`;
  }
  return `
    <section class="panel ticket-protection" aria-labelledby="ticket-protection-title">
      <header class="ticket-protection-head">
        <div><span class="eyebrow">예매한 승차권 보호</span><h2 id="ticket-protection-title">대체편을 확인한 뒤 기존 표를 안전하게 처리하세요</h2><p>공항철도와 KTX는 운영사가 달라 각각 확인해야 합니다. 예상 부담은 구간으로만 안내합니다.</p></div>
        <span class="ticket-protection-no-auto"><img src="${ICONS.promiseSafety}" alt="" aria-hidden="true" />자동 처리 안 함</span>
      </header>
      <div class="ticket-operator-grid">
        ${advice.operators.map((operator) => `
          <article class="ticket-operator ticket-operator-${operator.id}">
            <header><img src="${operator.id === "arex" ? ICONS.routeArex : ICONS.routeKtx}" alt="" aria-hidden="true" /><div><span>${escapeHtml(operator.label)}</span><strong>${escapeHtml(operator.service)}</strong><small>${escapeHtml(operator.ticketType)}</small></div></header>
            <dl><div><dt>반환 마감</dt><dd>${escapeHtml(operator.deadline)}</dd></div><div><dt>예상 위약금 구간</dt><dd>${escapeHtml(operator.feeBand)}</dd></div></dl>
            <p>${escapeHtml(operator.detail)}</p>
            <a href="${operator.officialUrl}" target="_blank" rel="noreferrer">${escapeHtml(operator.officialLabel)} <span aria-hidden="true">↗</span></a>
          </article>`).join("")}
      </div>
      <section class="ticket-safe-order" aria-labelledby="ticket-safe-order-title">
        <div class="ticket-section-heading"><span>안전한 처리 순서</span><h3 id="ticket-safe-order-title">기존 표부터 없애지 않도록 차례대로 확인해요</h3></div>
        <ol>${advice.steps.map((step, index) => `<li><span>${index + 1}</span><div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.detail)}</small></div></li>`).join("")}</ol>
      </section>
      <ul class="ticket-risk-checks" aria-label="추가 이동 위험 확인">
        ${advice.checks.map((check) => `<li><span>${escapeHtml(check.label)}</span><strong>${escapeHtml(check.value)}</strong><small>${escapeHtml(check.note)}</small></li>`).join("")}
      </ul>
      <p class="ticket-no-auto-notice"><img src="${ICONS.promiseOfficial}" alt="" aria-hidden="true" /><strong>${escapeHtml(advice.disclaimer)}</strong></p>
    </section>`;
}

function ticketProtectionDialog(view) {
  const advice = view.ticketProtection;
  if (!advice?.hasBookedTicket) {
    return `<p class="recovery-seat-note">예매한 표가 없다면 공식 채널에서 새 좌석과 운임을 확인한 뒤 일정 후보를 저장하세요.</p>`;
  }
  return `
    <section class="recovery-ticket-safety" aria-labelledby="recovery-ticket-safety-title">
      <h3 id="recovery-ticket-safety-title">표를 잃지 않는 순서</h3>
      <ol>
        ${advice.steps.slice(0, 3).map((step, index) => `<li><span>${index + 1}</span><strong>${escapeHtml(step.label)}</strong></li>`).join("")}
      </ol>
      <div class="recovery-operator-links">
        ${advice.operators.map((operator) => `<a href="${operator.officialUrl}" target="_blank" rel="noreferrer"><span>${escapeHtml(operator.label)}</span><strong>${escapeHtml(operator.feeBand)}</strong></a>`).join("")}
      </div>
      <p>${escapeHtml(advice.disclaimer)}</p>
    </section>`;
}

function alternativeRouteOption(candidate, view, recommended, index) {
  const arex = view.railPlan.airportRail.find((train) => train.id === candidate.id);
  const ktx = view.railPlan.trains.find((train) => train.recommendedArexId === candidate.id);
  const recommendedKtx = view.railPlan.trains.find((train) => train.recommendedArexId === recommended.id);
  const probability = Math.round(displayedProbability(view, candidate));
  const riskLevel = displayedRiskLevel(view, candidate);
  const p90Buffer = Math.round(candidate.bufferMinutes.p90);
  const arrivalDifference = Math.round((new Date(ktx.arrival).getTime() - new Date(recommendedKtx.arrival).getTime()) / 60000);
  const comparisonLabel = arrivalDifference < 0
    ? `${Math.abs(arrivalDifference)}분 먼저 도착`
    : arrivalDifference > 0
      ? `${arrivalDifference}분 늦게 도착`
      : "같은 시각 도착";
  const cardLabel = candidate.id === view.primary.id && view.canRecover
    ? "처음 살펴본 열차"
    : arrivalDifference < 0
      ? "더 빠른 열차"
      : "더 여유 있는 열차";
  const explanation = p90Buffer < 0
    ? `도착은 빠르지만 대부분 ${Math.abs(p90Buffer)}분이 부족해 놓칠 가능성이 있어요.`
    : `추천 열차보다 ${comparisonLabel}하지만, 갈아탈 때 대부분 ${p90Buffer}분이 남아요.`;
  return `
    <details class="alternative-route-card">
      <summary>
        <span class="alternative-rank">${index + 1}</span>
        <span class="alternative-main"><small>${cardLabel}</small><strong>${formatTime(arex.departure)} 공항철도 · ${escapeHtml(ktx.service)}</strong><span class="alternative-route-meta">${formatTime(ktx.arrival)} ${escapeHtml(state.journey.destination)} 도착 · ${ktx.price.toLocaleString("ko-KR")}원 예상</span></span>
        <span class="alternative-confidence tone-${riskTone(riskLevel)}"><strong>${probability}%</strong><small>${riskLabel(riskLevel)}</small></span>
      </summary>
      <div class="alternative-route-body">
        <ol aria-label="${escapeHtml(ktx.service)} 이동 시간표">
          <li><span>공항철도 출발</span><strong>${formatTime(arex.departure)}</strong></li>
          <li><span>서울역 출발</span><strong>${formatTime(ktx.departure)}</strong></li>
          <li><span>${escapeHtml(state.journey.destination)} 도착</span><strong>${formatTime(ktx.arrival)}</strong></li>
        </ol>
        <p>${explanation}</p>
        <a class="button button-soft" href="https://www.letskorail.com/" target="_blank" rel="noreferrer">이 열차 좌석 확인</a>
      </div>
    </details>`;
}

function navButtons(className = "") {
  const isMobileNav = className.includes("mobile-nav-item");
  return primaryNavigation
    .map((item) => {
      const isActive = state.activeView === item.id;
      const icon = isMobileNav && isActive ? item.activeIcon : item.icon;
      return `
        <button class="nav-item ${className}" type="button" data-view-target="${item.id}" aria-current="${state.activeView === item.id ? "page" : "false"}">
          <img class="nav-icon" src="${icon}" alt="" aria-hidden="true" />
          <span class="nav-label">${item.label}</span>
        </button>`;
    })
    .join("");
}

function routeSteps(view) {
  const scheduledArrival = view.signals?.scheduledArrival || state.journey.arrivalAt;
  const totalDelay = Math.round(view.simulation.assumptions.normalizedScenarios.flightDelayMinutes);
  const arrivalLabel = totalDelay > 0
    ? `${formatTime(scheduledArrival)} 예정 · ${totalDelay}분 지연 반영`
    : `${formatTime(scheduledArrival)} 도착 예정`;
  return `
    <ol class="route-steps" aria-label="인천공항에서 ${escapeHtml(state.journey.destination)}역까지 이동 순서">
      <li class="route-step is-air"><span class="route-code">AIR</span><strong>인천공항 ${escapeHtml(view.signals?.terminal || "T2")}</strong><span>${arrivalLabel}</span></li>
      <li class="route-step is-transfer"><span class="route-code">AREX</span><strong>서울역</strong><span>${formatTime(view.activeArex.arrival)} 도착</span></li>
      <li class="route-step is-rail"><span class="route-code">KTX</span><strong>${escapeHtml(state.journey.destination)}역</strong><span>${formatTime(view.activeKtx.arrival)} 도착</span></li>
    </ol>`;
}

function journeyTimeline(view) {
  const scheduledArrival = view.signals?.scheduledArrival || state.journey.arrivalAt;
  const totalDelay = Math.round(view.simulation.assumptions.normalizedScenarios.flightDelayMinutes);
  const arrivalLabel = totalDelay > 0
    ? `${formatTime(scheduledArrival)} +${totalDelay}분`
    : formatTime(scheduledArrival);
  const items = [
    ["항공 도착", arrivalLabel, "is-done"],
    ["입국·짐 찾기", `늦어도 ${formatTime(view.simulation.platformArrival.p90)}`, view.isDisrupted ? "is-risk" : "is-current"],
    ["공항철도", `${formatTime(view.activeArex.departure)} 출발`, ""],
    ["KTX 환승", `${formatTime(view.activeKtx.departure)} 출발`, ""],
    [`${state.journey.destination} 도착`, formatTime(view.activeKtx.arrival), ""]
  ];
  return `
    <ol class="timeline" aria-label="오늘 이동 단계">
      ${items.map((item, index) => `
        <li class="timeline-step ${item[2]}">
          <span class="timeline-dot">${index + 1}</span>
          <strong>${item[0]}</strong>
          <span>${item[1]}</span>
        </li>`).join("")}
    </ol>`;
}

function scenarioButtons() {
  const friendlyNames = {
    normal: "현재 도착",
    rain: "비행기 35분 늦음",
    peak: "입국장 혼잡"
  };
  const presetButtons = Object.values(disruptionPresets)
    .map(
      (preset) => `
        <button class="scenario-button" type="button" data-scenario="${preset.id}" aria-pressed="${!state.customDelayActive && preset.id === state.scenarioId}">
          ${friendlyNames[preset.id]}
        </button>`
    )
    .join("");
  const customState = state.customDelayActive
    ? `<span class="scenario-custom-state" role="status">직접 조절 ${state.previewDelayMinutes}분</span>`
    : "";
  return `${presetButtons}${customState}`;
}

function routeOption(candidate, view, featured = false) {
  const arex = view.railPlan.airportRail.find((train) => train.id === candidate.id);
  const ktx = view.railPlan.trains.find((train) => train.recommendedArexId === candidate.id);
  const isPrimary = candidate.id === view.primary.id;
  const isRecovery = candidate.id === view.recovery.id && view.canRecover;
  const selected = state.confirmedJourney
    ? candidate.id === state.confirmedJourney.selectedArexId
    : isPrimary;
  const badge = selected && view.isRecovered
    ? "선택한 일정"
    : isRecovery && view.canRecover
      ? "더 안전한 추천"
    : isPrimary
      ? "처음 선택한 일정"
      : "다른 시간";
  const p90Buffer = Math.round(candidate.bufferMinutes.p90);
  const probability = displayedProbability(view, candidate);
  const riskLevel = displayedRiskLevel(view, candidate);
  const decisionProfile = decisionProfileFor(view, candidate);

  return `
    <li class="route-option ${featured ? "is-featured" : ""} ${selected ? "is-selected" : ""}">
      <div class="route-option-header">
        <div class="option-title">
          <span class="tag ${isRecovery && view.canRecover ? "tag-accent" : ""}">${badge}</span>
          <strong>${formatTime(arex.departure)} 공항철도 · ${ktx.service}</strong>
          <span>서울역에서 갈아타고 ${formatTime(ktx.arrival)} ${escapeHtml(state.journey.destination)} 도착</span>
        </div>
        <div class="probability tone-${riskTone(riskLevel)}">
          <strong>${formatPercent(probability)}</strong>
          <span>${predictionSourceLabel(view)}</span>
        </div>
      </div>
      <div class="option-line" aria-label="인천공항 ${formatTime(arex.departure)} 출발, 서울역 ${formatTime(ktx.departure)} 출발, ${escapeHtml(state.journey.destination)}역 ${formatTime(ktx.arrival)} 도착">
        <span>공항 ${formatTime(arex.departure)}</span><i aria-hidden="true"></i>
        <span>서울 ${formatTime(ktx.departure)}</span><i aria-hidden="true"></i>
        <span>${escapeHtml(state.journey.destination)} ${formatTime(ktx.arrival)}</span>
      </div>
      <div class="option-meta">
        <span class="tag">${p90Buffer >= 0 ? `대부분 ${p90Buffer}분 여유` : `대부분 ${Math.abs(p90Buffer)}분 부족`}</span>
        <span class="tag">${riskLabel(riskLevel)}</span>
        ${decisionProfile ? `<span class="tag tag-accent">안전·도착 함께 확인</span>` : ""}
        <span class="tag">${ktx.price.toLocaleString("ko-KR")}원 예상</span>
      </div>
      ${featured ? `<div class="route-action-row">
        ${isRecovery && view.canRecover && !view.isRecovered ? `<button class="button button-primary" data-open-recovery type="button">승차권 보호 순서 확인</button>` : ""}
        <a class="button button-soft" href="https://www.letskorail.com/" target="_blank" rel="noreferrer">코레일에서 좌석 확인</a>
        <a class="button button-plain" href="https://www.arex.or.kr/" target="_blank" rel="noreferrer">공항철도 확인</a>
      </div>` : ""}
    </li>`;
}

function cleanTravelTime(value) {
  return String(value || "").replace(/^\+1\s*/, "");
}

function travelCategory(type, index) {
  const catalog = {
    food: { label: "지역 음식", icon: ICONS.travelFood },
    culture: { label: "지역 문화", icon: ICONS.travelCulture },
    experience: { label: "체험", icon: ICONS.travelExperience },
    stay: { label: "숙소와 휴식", icon: ICONS.travelStay }
  };
  if (catalog[type]) return catalog[type];
  return {
    label: state.journey.interests[index % Math.max(1, state.journey.interests.length)] || "지역 추천",
    icon: [ICONS.travelFallback, ICONS.travelExperience, ICONS.travelCulture][index % 3]
  };
}

function travelItemsFor(view) {
  const livePlaces = view.signals?.tourismPlaces || [];
  const fallbackItems = view.isRecovered ? tourismPlan.recovered : tourismPlan.original;
  if (livePlaces.length) {
    const times = view.isRecovered ? ["08:40", "10:10", "13:30"] : ["22:20", "09:00", "11:10"];
    return livePlaces.slice(0, 3).map((place, index) => {
      const category = travelCategory(place.contentType, index);
      const day = view.isRecovered || index > 0 ? "next" : "arrival";
      const hasPhoto = Boolean(place.imageUrl);
      return {
        id: place.contentId || `live-place-${index + 1}`,
        time: times[index],
        day,
        dayLabel: day === "arrival" ? "도착한 날" : "다음 날",
        title: place.title,
        detail: place.address || `${state.journey.destination} 관광 장소`,
        imageUrl: hasPhoto ? place.imageUrl.replace(/^http:/, "https:") : travelVisualAssets.placeFallback,
        imageAlt: hasPhoto ? `${place.title} 대표 사진` : "지역 여행 장소를 나타내는 착착 대표 이미지",
        category,
        status: view.isRecovered ? "시간을 옮겼어요" : "공공 관광정보",
        source: "한국관광공사 공공 관광정보",
        changed: view.isRecovered,
        reason: `${category.label} 취향과 ${state.journey.destination}역 도착 시간을 함께 보고 골랐어요.`
      };
    });
  }
  return fallbackItems.slice(0, 3).map((item, index) => {
    const category = travelCategory(item.type, index);
    const day = view.isRecovered || index > 0 || String(item.time).startsWith("+1") ? "next" : "arrival";
    return {
      id: `fallback-place-${index + 1}`,
      time: cleanTravelTime(item.time),
      day,
      dayLabel: day === "arrival" ? "도착한 날" : "다음 날",
      title: item.title,
      detail: item.detail,
      imageUrl: travelVisualAssets.placeFallback,
      imageAlt: "지역 여행 장소를 나타내는 착착 대표 이미지",
      category,
      status: view.isRecovered ? "시간을 옮겼어요" : index === 0 ? "열차 확인 필요" : "추천 일정",
      source: "착착 체험용 대표 일정",
      changed: view.isRecovered,
      reason: `${category.label} 취향과 이동 시간을 함께 보고 준비한 체험 일정이에요.`
    };
  });
}

function minutesBetweenTravelTimes(arrivalTime, item) {
  const arrivalMatch = String(arrivalTime).match(/(\d{2}):(\d{2})/);
  const itemMatch = String(item.time).match(/(\d{2}):(\d{2})/);
  if (!arrivalMatch || !itemMatch) return null;
  const arrivalMinutes = Number(arrivalMatch[1]) * 60 + Number(arrivalMatch[2]);
  let itemMinutes = Number(itemMatch[1]) * 60 + Number(itemMatch[2]);
  if (item.day === "next" || itemMinutes < arrivalMinutes) itemMinutes += 24 * 60;
  return Math.max(0, itemMinutes - arrivalMinutes);
}

function travelGapLabel(minutes) {
  if (!Number.isFinite(minutes)) return "도착 뒤 바로 시작";
  if (minutes < 60) return `${minutes}분 뒤 시작`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}시간 ${rest}분 뒤 시작` : `${hours}시간 뒤 시작`;
}

function travelHero(view, items) {
  const firstItem = items[0];
  const arrivalTime = formatTime(view.activeKtx.arrival);
  const gap = minutesBetweenTravelTimes(arrivalTime, firstItem);
  const heroTitle = view.isRecovered
    ? "늦어져도 여행은 다음 날 자연스럽게 이어져요"
    : `${escapeHtml(state.journey.destination)}역에서 첫 여행까지 이어서 보여드려요`;
  return `
    <section class="travel-visual-hero" aria-labelledby="travel-visual-title">
      <div class="travel-arrival-board">
        <div class="travel-arrival-copy"><span>도착 후 첫 일정</span><h2 id="travel-visual-title">${heroTitle}</h2><p>열차 도착, 장소 위치와 좋아하는 여행을 한 번에 맞췄어요.</p></div>
        <ol class="travel-arrival-steps" aria-label="열차 도착부터 첫 여행까지">
          <li><img src="${ICONS.travelArrival}" alt="" aria-hidden="true" /><span>${escapeHtml(state.journey.destination)}역 도착</span><strong>${arrivalTime}</strong></li>
          <li><img src="${ICONS.travelTime}" alt="" aria-hidden="true" /><span>${firstItem.dayLabel}</span><strong>${escapeHtml(firstItem.time)}</strong></li>
          <li><img src="${ICONS.travelFirstPlace}" alt="" aria-hidden="true" /><span>첫 여행</span><strong>${escapeHtml(firstItem.title)}</strong></li>
        </ol>
        <div class="travel-arrival-result"><strong>${travelGapLabel(gap)}</strong><span>${view.isRecovered ? "무리하지 않도록 다음 날로 옮겼어요" : "역에서 서두르지 않아도 돼요"}</span></div>
      </div>
    </section>`;
}

function travelReplanStrip(view, hasLiveTourism) {
  return `
    <section class="travel-replan-strip status-${view.isRecovered ? "watch" : "safe"}" aria-labelledby="travel-replan-title">
      <div><span>${view.isRecovered ? "대체 일정 준비" : "여행 연결 확인"}</span><h2 id="travel-replan-title">${view.isRecovered ? "늦은 밤 일정은 다음 날 후보로 옮겼어요" : "도착 시각에 맞춰 무리 없는 순서로 준비했어요"}</h2><p>${hasLiveTourism ? "공공 관광정보의 장소" : "확인한 대표 장소"}와 열차 도착을 함께 보고, 좋아하는 여행은 그대로 남겼어요.</p></div>
      <ul aria-label="일정에 반영한 내용"><li>열차 도착 반영</li><li>장소 위치 확인</li><li>여행 취향 유지</li></ul>
    </section>`;
}

function travelPlaceCard(item, index) {
  const mapQuery = encodeURIComponent(`${item.title} ${item.detail}`);
  return `
    <details class="travel-place-card ${item.changed ? "is-changed" : ""}">
      <summary>
        <span class="travel-place-icon" aria-hidden="true"><img src="${item.category.icon}" alt="" /><b>${index + 1}</b></span>
        <div class="travel-place-copy">
          <div class="travel-place-meta"><span>${item.dayLabel}</span><time>${escapeHtml(item.time)}</time><span class="travel-place-status">${escapeHtml(item.status)}</span></div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.detail)}</p>
          <span class="travel-place-category">${escapeHtml(item.category.label)}</span>
          <span class="travel-place-more">장소 자세히 보기</span>
        </div>
      </summary>
      <div class="travel-place-detail">
        <div><strong>이 장소를 고른 이유</strong><p>${escapeHtml(item.reason)}</p></div>
        <dl><div><dt>방문 시간</dt><dd>${item.dayLabel} ${escapeHtml(item.time)}</dd></div><div><dt>정보 출처</dt><dd>${escapeHtml(item.source)}</dd></div></dl>
        <a class="button button-soft" href="https://map.naver.com/p/search/${mapQuery}" target="_blank" rel="noreferrer">지도에서 장소 확인</a>
      </div>
    </details>`;
}

function travelPlanSection(view, items) {
  const filteredItems = state.travelDay === "all" ? items : items.filter((item) => item.day === state.travelDay);
  return `
    <section class="travel-plan-section" aria-labelledby="travel-plan-title">
      <div class="travel-plan-heading"><div><span>나의 지역 일정</span><h2 id="travel-plan-title">시간 순서대로 편하게 확인하세요</h2><p>장소를 펼치면 추천 이유와 지도 위치를 더 자세히 볼 수 있어요.</p></div>
        <div class="travel-day-switcher" aria-label="일정 날짜 선택">
          <button type="button" data-travel-day="all" aria-pressed="${state.travelDay === "all"}">전체</button>
          <button type="button" data-travel-day="arrival" aria-pressed="${state.travelDay === "arrival"}">도착한 날</button>
          <button type="button" data-travel-day="next" aria-pressed="${state.travelDay === "next"}">다음 날</button>
        </div>
      </div>
      ${filteredItems.length
        ? `<div class="travel-place-grid">${filteredItems.map((item, index) => travelPlaceCard(item, index)).join("")}</div>`
        : `<div class="travel-plan-empty"><div><strong>이 날짜에는 아직 일정이 없어요</strong><p>전체 일정을 선택하면 준비된 장소를 모두 볼 수 있어요.</p></div><button class="button button-soft" type="button" data-travel-day="all">전체 일정 보기</button></div>`}
    </section>`;
}

function sourceItems() {
  if (state.fusion?.sources?.length) {
    const modeLabels = {
      live: "최신 정보",
      fallback: "자동 보완",
      demo: "연결 준비",
      empty: "조회값 없음"
    };
    return state.fusion.sources
      .map((source, index) => {
        const displayMode = source.mode === "live" && (source.data === null || (Array.isArray(source.data) && source.data.length === 0))
          ? "empty"
          : source.mode;
        return `
          <li class="source-item">
            <span class="source-number">${index + 1}</span>
            <div class="source-copy">
              <div class="source-copy-head"><strong>${escapeHtml(source.owner)}</strong><span class="source-mode mode-${escapeHtml(displayMode)}">${modeLabels[displayMode] || "확인 중"}</span></div>
              <span>${escapeHtml(source.name)} · ${escapeHtml(source.summary)}</span>
              <a class="source-link" href="${escapeHtml(source.officialUrl)}" target="_blank" rel="noreferrer">공식 출처 보기</a>
            </div>
          </li>`;
      })
      .join("");
  }

  return sourceCatalog
    .map(
      (source, index) => `
        <li class="source-item">
          <span class="source-number">${index + 1}</span>
          <div class="source-copy"><div class="source-copy-head"><strong>${source.owner}</strong><span class="source-mode">공공데이터</span></div><span>${source.name} · ${source.fields}</span></div>
        </li>`
    )
    .join("");
}

function aiGuideCard(view) {
  const guidance = state.aiGuidance;
  const isLoading = state.aiStatus === "loading";
  const connectionLabel = state.openaiConfigured ? "맞춤 설명 준비됨" : "기본 설명 사용 가능";
  const result = guidance
    ? `<div class="ai-result" tabindex="-1" id="ai-result">
        <div class="ai-result-head"><span class="ai-orb" aria-hidden="true">말</span><div><span>${state.aiMode === "live" ? "맞춤 설명" : "기본 설명"}</span><h3>${escapeHtml(guidance.headline)}</h3></div></div>
        <p>${escapeHtml(guidance.summary)}</p>
        <ol class="ai-step-list">${guidance.steps.map((step) => `<li><strong>${escapeHtml(step.label)}</strong><span>${escapeHtml(step.detail)}</span></li>`).join("")}</ol>
        <div class="ai-tourism-note"><strong>여행 일정</strong><span>${escapeHtml(guidance.tourismAdjustment)}</span></div>
        <small>${escapeHtml(guidance.disclaimer)}</small>
      </div>`
    : `<div class="ai-empty">
        <span class="ai-orb" aria-hidden="true">말</span>
        <div><strong>추천 이유를 쉬운 말로 알려드려요</strong><p>착착이 살펴본 결과를 바꾸지 않고 이해하기 쉽게 풀어드립니다.</p></div>
      </div>`;

  return `
    <article class="panel ai-guide-card" aria-busy="${isLoading}">
      <div class="panel-header ai-guide-header">
        <div><span class="eyebrow">쉬운 설명</span><h2>다른 언어로도 편하게 안내해 드려요</h2><p>${connectionLabel} · 이름이나 예약번호는 사용하지 않아요.</p></div>
        <span class="status-pill ${state.openaiConfigured ? "status-safe" : "status-watch"}">${state.openaiConfigured ? "설명 준비됨" : "기본 안내"}</span>
      </div>
      <div class="ai-controls">
        <label for="ai-locale"><span>안내 언어</span><select id="ai-locale">
          <option value="ko" ${state.aiLocale === "ko" ? "selected" : ""}>한국어</option>
          <option value="en" ${state.aiLocale === "en" ? "selected" : ""}>English</option>
          <option value="ja" ${state.aiLocale === "ja" ? "selected" : ""}>日本語</option>
          <option value="zh" ${state.aiLocale === "zh" ? "selected" : ""}>中文</option>
        </select></label>
        <button class="button button-primary" id="request-ai" type="button" ${isLoading ? "disabled" : ""}>${isLoading ? "안내를 만들고 있어요…" : "쉬운 안내 받기"}</button>
      </div>
      ${state.aiError ? `<p class="inline-error">${escapeHtml(state.aiError)}</p>` : ""}
      ${result}
      <details class="calculation-details"><summary>어떤 상황을 살펴봤나요?</summary><p>항공 도착, 비행기에서 내리는 시간, 입국심사, 짐 찾기와 공항 안 이동을 차례로 살펴봤습니다.</p><div class="time-pair"><div><strong>${formatTime(view.simulation.platformArrival.p50)}</strong><span>보통 도착</span></div><div><strong>${formatTime(view.simulation.platformArrival.p90)}</strong><span>여유 있게 잡은 도착</span></div></div><div class="factor-list">${stageRows(view.simulation)}</div></details>
    </article>`;
}

function impactCards() {
  const promises = [
    { icon: ICONS.promiseSafety, tone: "safe", value: "안전을 먼저 봐요", label: "확실하지 않으면 더 여유 있는 열차를 안내해요", footnote: "빠른 이동보다 놓치지 않는 이동을 먼저 살펴요" },
    { icon: ICONS.promiseSource, tone: "rail", value: "어디서 온 정보인지 알려요", label: "실제 정보와 계산한 정보를 분명하게 나눠요", footnote: "연결 상태와 공식 출처를 언제든 확인할 수 있어요" },
    { icon: ICONS.promisePrivacy, tone: "private", value: "꼭 필요한 정보만 써요", label: "이름과 예약번호 없이 이동조건만 사용해요", footnote: "현장 기록은 직접 확인하고 언제든 지울 수 있어요" },
    { icon: ICONS.promiseOfficial, tone: "official", value: "마지막에는 공식 채널로 가요", label: "좌석·운임·표 변경은 운영사에서 확인해요", footnote: "착착이 제공하지 않는 기능은 있다고 말하지 않아요" }
  ];
  return promises.map((item) => `<li class="impact-card impact-card-${item.tone}"><span class="impact-card-icon" aria-hidden="true"><img src="${item.icon}" alt="" /></span><div><strong>${item.value}</strong><span>${item.label}</span><small>${item.footnote}</small></div></li>`).join("");
}

function confirmedJourneyBanner(view, nextView = "travel") {
  if (!view.isRecovered) return "";
  const originalKtx = view.railPlan.trains.find((train) => train.id === view.confirmedJourney?.originalKtxId);
  const nextLabel = nextView === "travel" ? "대체 여행 일정 보기" : nextView === "routes" ? "저장한 열차 보기" : "내 이동 보기";
  return `
    <section class="confirmed-journey-banner" role="status" aria-label="대체 일정 후보 저장 완료">
      <span class="confirmed-journey-icon" aria-hidden="true"><img src="${ICONS.journeyConfirmed}" alt="" /></span>
      <div class="confirmed-journey-copy">
        <span>대체 일정 후보 저장</span>
        <h2>${originalKtx ? `${escapeHtml(originalKtx.service)} 대신 ` : ""}${escapeHtml(view.activeKtx.service)}를 확인할 수 있어요</h2>
        <p>${formatTime(view.activeArex.departure)} 공항철도 → ${formatTime(view.activeKtx.departure)} ${escapeHtml(view.activeKtx.service)} → ${formatTime(view.activeKtx.arrival)} ${escapeHtml(state.journey.destination)} 도착</p>
      </div>
      <div class="confirmed-journey-actions">
        <button class="button button-primary" type="button" data-view-target="${nextView}">${nextLabel}</button>
        <a class="button button-soft" href="https://www.letskorail.com/" target="_blank" rel="noreferrer">공식 좌석 확인</a>
      </div>
    </section>`;
}

function compactDisclosure({ title, description, badge, icon, content, className = "" }) {
  const open = isCompactScreen() ? "" : " open";
  return `
    <details class="mobile-disclosure ${className}"${open}>
      <summary>
        <span class="mobile-disclosure-title"><img src="${icon}" alt="" aria-hidden="true" /><span><strong>${title}</strong><small>${description}</small></span></span>
        <span class="mobile-disclosure-badge">${badge}</span>
      </summary>
      <div class="mobile-disclosure-content">${content}</div>
    </details>`;
}

function mobileNowCard(view) {
  const probability = Math.round(displayedProbability(view, view.activeCandidate));
  const activeRiskLevel = displayedRiskLevel(view, view.activeCandidate);
  const needsRecovery = view.canRecover && !view.isRecovered;
  const p90 = formatTime(view.simulation.platformArrival.p90);
  const headline = view.isRecovered
    ? `${formatTime(view.activeArex.departure)} 공항철도를 타면 돼요`
    : needsRecovery
      ? "더 여유 있는 열차를 먼저 확인하세요"
      : "공항철도 타는 곳으로 천천히 이동하세요";
  const action = view.isRecovered
    ? `<button class="button button-primary" type="button" data-view-target="travel">대체 여행 일정 보기</button>`
    : needsRecovery
      ? `<button class="button button-primary" type="button" data-open-recovery>표 보호 순서와 대체편 확인</button>`
      : `<button class="button button-primary" type="button" data-view-target="routes">열차 시간 확인</button>`;
  return `
    <section class="mobile-now-card tone-card-${riskTone(activeRiskLevel)}" aria-labelledby="mobile-now-title">
      <div class="mobile-now-copy"><span>지금 할 일</span><h2 id="mobile-now-title">${headline}</h2><p>늦어도 ${p90}쯤 타는 곳에 도착할 것으로 봅니다.</p></div>
      <div class="mobile-now-score"><strong>${probability}%</strong><span>${riskLabel(activeRiskLevel)}</span></div>
      ${action}
    </section>`;
}

function journeyView(view) {
  const probability = displayedProbability(view, view.activeCandidate);
  const activeRiskLevel = displayedRiskLevel(view, view.activeCandidate);
  const tone = riskTone(activeRiskLevel);
  const needsRecovery = view.canRecover && !view.isRecovered;
  const nextAction = view.isRecovered
    ? `${formatTime(view.activeArex.departure)} 공항철도를 타면 됩니다.`
    : needsRecovery
      ? "지금 열차는 빠듯합니다. 더 안전한 다음 열차를 확인해 주세요."
      : `${formatTime(view.activeArex.departure)} 공항철도 타는 곳으로 천천히 이동하세요.`;
  const detailCopy = view.isRecovered
    ? `${view.activeKtx.service}를 대체편 후보로 저장했습니다. 탈 수 있는 가능성은 ${formatPercent(probability)}입니다.`
    : needsRecovery
      ? `실시간 상황과 이동조건을 반영해 처음 열차의 가능성이 ${formatPercent(probability)}로 계산됐습니다.`
      : `늦어도 ${formatTime(view.simulation.platformArrival.p90)}쯤 공항철도 타는 곳에 도착할 것으로 봅니다.`;

  return `
    <section class="view-heading journey-heading" aria-labelledby="view-title">
      <div><span class="eyebrow">오늘 이동</span><h1 id="view-title" tabindex="-1">${escapeHtml(view.signals?.origin || demoTrip.flight.originCity)}에서 ${escapeHtml(state.journey.destination)}까지, 한눈에</h1><p>복잡한 시간표 대신 지금 무엇을 하면 되는지 알려드려요.</p><button class="button button-soft journey-edit" id="open-journey-setup" type="button">항공편·여행조건 바꾸기</button></div>
      <div class="journey-heading-visual">
        <span class="data-badge">${dataModeLabel()}</span>
        <img src="/assets/illustrations/rail-air-journey.png" alt="공항에서 공항철도와 고속열차를 타고 목적지까지 이어지는 여정 그림" />
      </div>
    </section>

    ${confirmedJourneyBanner(view, "travel")}
    ${mobileNowCard(view)}
    ${compactDisclosure({
      title: "공항과 철도의 지금 상황",
      description: "항공·입국장·날씨·공항철도",
      badge: `${view.signals?.liveInputCount || 0}/4`,
      icon: ICONS.journeyLive,
      content: liveSignalBoard(view),
      className: "journey-signal-disclosure"
    })}
    ${compactDisclosure({
      title: "착착이 살펴본 근거",
      description: "도착 예상과 열차 가능성을 한 번 더 확인",
      badge: `${Math.round(displayedProbability(view, view.activeCandidate))}%`,
      icon: ICONS.journeyModel,
      content: chakchakModelPanel(view),
      className: "journey-model-disclosure"
    })}

    <section class="journey-hero">
      <article class="panel trip-card">
        <div class="trip-card-head">
          <div><span class="flight-chip">${escapeHtml(state.journey.flightId)} · ${escapeHtml(view.signals?.origin || demoTrip.flight.originCity)} 출발</span><h2>오늘 이동 일정</h2></div>
          <span class="status-pill status-${tone}">${riskLabel(activeRiskLevel)}</span>
        </div>
        ${routeSteps(view)}
        <div class="trip-details"><span>위탁수하물 ${state.journey.checkedBags}개</span><span>${escapeHtml(state.journey.destination)} ${state.journey.stayNights}박</span><span>${view.activeKtx.service}</span><span>${state.journey.mobility === "standard" ? "보통 걸음" : "이동 지원 반영"}</span></div>
      </article>

      <article class="panel possibility-card" id="journey-status">
        <div class="possibility-top"><span>${predictionSourceLabel(view)} 탑승 가능성</span><span class="status-dot status-${tone}">${riskLabel(activeRiskLevel)}</span></div>
        <div class="possibility-main">
          <div class="confidence-gauge" style="--gauge-value:${probability}%;--gauge-color:var(--${tone === "safe" ? "safe-fg" : tone === "watch" ? "warn-fg" : "danger-fg"})" role="img" aria-label="이 열차를 탈 가능성 ${Math.round(probability)}퍼센트"><strong>${Math.round(probability)}<small>%</small></strong></div>
          <div><h2>${probabilitySentence(probability)}</h2><p>${detailCopy}</p></div>
        </div>
        <div class="next-action"><strong>지금 할 일</strong><span>${nextAction}</span></div>
        <div class="hero-actions">
          ${view.canRecover && !view.isRecovered ? `<button class="button button-primary" data-open-recovery type="button">대체편·표 보호 순서 보기</button>` : `<button class="button button-primary" type="button" data-view-target="routes">다른 열차 보기</button>`}
          <button class="button button-soft" id="run-disruption" type="button">35분 늦어졌을 때 보기</button>
          <button class="button button-plain" id="reset-demo" type="button">처음 상태로</button>
        </div>
      </article>
    </section>

    <section class="journey-detail-grid">
      <article class="panel timeline-card"><div class="panel-header"><div><h2>이동 순서</h2><p>현재 상황부터 ${escapeHtml(state.journey.destination)} 도착까지</p></div><strong class="arrival-time">${formatTime(view.activeKtx.arrival)} 도착</strong></div>${journeyTimeline(view)}</article>
    </section>
    ${aiGuideCard(view)}`;
}

function decisionGraphic(view, recommended) {
  const primaryProbability = Math.round(displayedProbability(view, view.primary));
  const recommendedProbability = Math.round(displayedProbability(view, recommended));
  const improvement = Math.max(0, recommendedProbability - primaryProbability);
  if (improvement === 0) {
    return `
      <div class="decision-graphic is-steady" role="img" aria-label="현재 열차 탑승 가능성 ${primaryProbability}퍼센트, 안전 기준 85퍼센트">
        <div class="decision-bar is-after"><span><b>현재 열차</b><em>${primaryProbability}%</em></span><i style="--bar:${primaryProbability}%"></i><small>안심 기준보다 ${Math.max(0, primaryProbability - 85)}% 더 여유 있어요.</small></div>
        <div class="decision-gain"><strong>${Math.max(0, Math.round(recommended.bufferMinutes.p90))}분</strong><span>대부분 남는 시간</span></div>
      </div>`;
  }
  return `
    <div class="decision-graphic" role="img" aria-label="처음 열차 ${primaryProbability}퍼센트, 추천 열차 ${recommendedProbability}퍼센트">
      <div class="decision-bar is-before"><span><b>처음 열차</b><em>${primaryProbability}%</em></span><i style="--bar:${primaryProbability}%"></i></div>
      <div class="decision-arrow" aria-hidden="true">→</div>
      <div class="decision-bar is-after"><span><b>추천 열차</b><em>${recommendedProbability}%</em></span><i style="--bar:${recommendedProbability}%"></i></div>
      <div class="decision-gain"><strong>${recommendedProbability}%</strong><span>${improvement}% 더 안심</span></div>
    </div>`;
}

function journeySceneForDestination(destination) {
  return journeySceneCatalog[destination] || journeySceneCatalog.전주;
}

function previewDelayLabel(minutes) {
  return minutes > 0 ? `${minutes}분 지연` : "지연 없음";
}

function mobileRouteBoard(view, recommended, recommendedArex, recommendedKtx, p90Time, bufferMinutes) {
  const probability = Math.round(displayedProbability(view, recommended));
  const riskLevel = displayedRiskLevel(view, recommended);
  const steps = [
    { icon: ICONS.routeAirport, label: "인천공항 도착", value: formatTime(view.signals?.scheduledArrival || state.journey.arrivalAt), note: view.signals?.terminal || "터미널 확인" },
    { icon: ICONS.routeArex, label: "공항철도 출발", value: formatTime(recommendedArex.departure), note: `타는 곳 ${p90Time} 도착 예상` },
    { icon: ICONS.routeKtx, label: `${recommendedKtx.service} 출발`, value: formatTime(recommendedKtx.departure), note: "서울역에서 갈아타기" },
    { icon: ICONS.routeDestination, label: `${escapeHtml(state.journey.destination)} 도착`, value: formatTime(recommendedKtx.arrival), note: "지역 일정까지 연결" }
  ];
  return `
    <div class="mobile-route-board" aria-label="추천 이동 순서">
      <div class="mobile-route-result">
        <div><span>착착 추천</span><strong>${recommendedKtx.service}</strong><small>지금 상황과 이동조건을 함께 살펴봤어요</small></div>
        <span class="mobile-route-confidence tone-${riskTone(riskLevel)}"><b>${probability}%</b><small>${riskLabel(riskLevel)}</small></span>
      </div>
      <ol class="mobile-route-line">
        ${steps.map((step, index) => `<li><span class="mobile-route-node"><img src="${step.icon}" alt="" aria-hidden="true" /></span><div><small>${index + 1}. ${step.label}</small><strong>${step.value}</strong><span>${step.note}</span></div></li>`).join("")}
      </ol>
      <div class="mobile-route-buffer"><span>갈아탈 때 대부분 남는 시간</span><strong>${bufferMinutes}분</strong></div>
    </div>`;
}

function aiCommandCenter(view, recommended) {
  const prediction = modelPredictionFor(view, view.primary);
  if (!prediction) return "";
  const scheduledArrival = view.signals?.scheduledArrival || state.journey.arrivalAt;
  const p90Time = formatTimeAfterMinutes(scheduledArrival, prediction.platformArrivalMinutes.p90);
  const recommendedArex = view.railPlan.airportRail.find((train) => train.id === recommended.id) || view.activeArex;
  const recommendedKtx = view.railPlan.trains.find((train) => train.recommendedArexId === recommended.id) || view.activeKtx;
  const previewDelay = Math.max(0, Math.min(90, Number(state.previewDelayMinutes) || 0));
  const delayProgress = Math.round(previewDelay / 90 * 100);
  const bufferMinutes = Math.max(0, Math.round(recommended.bufferMinutes.p90));
  const scene = journeySceneForDestination(state.journey.destination);
  const sceneTone = state.scenarioId === "peak" ? "peak" : previewDelay >= 30 ? "rain" : "normal";
  const sceneStatus = view.isRecovered
    ? "대체 일정 후보를 저장했어요"
    : view.canRecover
      ? "더 여유 있는 열차를 찾았어요"
      : "여유 있게 갈 수 있어요";
  const scenarioHint = state.scenarioId === "peak"
    ? `붐비는 입국장${previewDelay ? `과 ${previewDelay}분 지연` : ""}을 반영했어요`
    : previewDelay > 0
      ? `비행기 ${previewDelay}분 지연을 반영했어요`
      : "지금 도착 상황을 반영했어요";
  const stages = [
    { className: "stage-origin", icon: ICONS.stageOrigin, label: `${escapeHtml(view.signals?.origin || demoTrip.flight.originCity)} 출발`, value: formatTimeAfterMinutes(scheduledArrival, -155) },
    { className: "stage-airport", icon: ICONS.stageAirport, label: "인천공항 도착", value: formatTime(scheduledArrival) },
    { className: "stage-arex", icon: ICONS.stageArex, label: "공항철도", value: formatTime(recommendedArex.departure) },
    { className: "stage-seoul", icon: ICONS.stageSeoul, label: "서울역 도착", value: formatTime(recommendedArex.arrival) },
    { className: "stage-ktx", icon: ICONS.stageKtx, label: recommendedKtx.service, value: formatTime(recommendedKtx.departure) },
    { className: "stage-destination", icon: ICONS.stageDestination, label: `${escapeHtml(state.journey.destination)} 도착`, value: formatTime(recommendedKtx.arrival) }
  ];
  const primaryAction = view.canRecover && !view.isRecovered
    ? `<button class="button button-primary visual-primary-action" data-open-recovery type="button">대체편·표 보호 순서 확인</button>`
    : `<button class="button button-primary visual-primary-action" type="button" data-view-target="travel">${view.isRecovered ? "대체 여행 일정 보기" : "이 일정으로 이어가기"}</button>`;

  return `
    <section class="visual-journey-stage scene-${sceneTone}" aria-labelledby="visual-journey-title">
      <span class="sr-only" id="visual-journey-title">${scenarioHint}. ${sceneStatus}. ${escapeHtml(scene.label)}</span>
      ${mobileRouteBoard(view, recommended, recommendedArex, recommendedKtx, p90Time, bufferMinutes)}
      <figure class="journey-scene" aria-label="인천공항에서 공항철도와 고속열차를 타고 ${escapeHtml(state.journey.destination)}까지 이어지는 추천 여정">
        <img class="journey-scene-image" src="${scene.src}" alt="" aria-hidden="true" />
        <ol class="journey-scene-labels">
          ${stages.map((stage) => `<li class="${stage.className}"><span><img src="${stage.icon}" alt="" aria-hidden="true" /></span><small>${stage.label}</small><strong>${stage.value}</strong></li>`).join("")}
        </ol>
      </figure>
      <div class="journey-control-deck">
        <div class="journey-control-main">
          <label class="journey-time-control" for="journey-time-scrubber">
            <span class="journey-time-copy"><b>비행기 지연 시간을 선택하세요</b><output id="journey-delay-output" for="journey-time-scrubber">${previewDelayLabel(previewDelay)}</output></span>
            <span class="journey-scrubber-wrap" style="--delay-position:${delayProgress}%">
              <input id="journey-time-scrubber" type="range" min="0" max="90" step="5" value="${previewDelay}" aria-label="비행기 도착 지연 시간" aria-valuetext="${previewDelayLabel(previewDelay)}" />
            </span>
            <small><span>지연 없음</span><span>30분</span><span>60분</span><span>90분</span></small>
          </label>
          <ol class="journey-decision-stops" aria-label="추천 여정 시간표">
            <li><img src="${ICONS.decisionPlatform}" alt="" aria-hidden="true" /><span>타는 곳 도착</span><strong>${p90Time}</strong></li>
            <li><img src="${ICONS.decisionArex}" alt="" aria-hidden="true" /><span>공항철도</span><strong>${formatTime(recommendedArex.departure)}</strong></li>
            <li><img src="${ICONS.decisionKtx}" alt="" aria-hidden="true" /><span>${recommendedKtx.service}</span><strong>${formatTime(recommendedKtx.departure)}</strong></li>
            <li><img src="${ICONS.decisionDestination}" alt="" aria-hidden="true" /><span>${escapeHtml(state.journey.destination)} 도착</span><strong>${formatTime(recommendedKtx.arrival)}</strong></li>
          </ol>
        </div>
        <div class="journey-control-actions">
          <span class="journey-buffer"><strong>${bufferMinutes}분</strong> 대부분 남는 시간</span>
          ${primaryAction}
          <button class="button button-plain" id="open-route-details" type="button">추천 이유와 다른 열차 보기</button>
        </div>
      </div>
    </section>`;
}

function routesView(view) {
  const recommended = view.isRecovered ? view.activeCandidate : view.canRecover ? view.recovery : view.primary;
  const others = view.simulation.candidates.filter((candidate) => candidate.id !== recommended.id);
  const headingStatus = view.isRecovered ? "대체 일정 후보를 저장했어요" : view.canRecover ? "더 여유 있는 열차를 찾았어요" : "여유 있게 갈 수 있어요";
  return `
    <section class="view-heading routes-visual-heading" aria-labelledby="view-title">
      <div><span class="eyebrow">다음 열차</span><h1 id="view-title" tabindex="-1">탈 수 있는 열차부터 보여드려요</h1><p class="routes-heading-status"><img src="${ICONS.routeHeading}" alt="" aria-hidden="true" />${headingStatus}</p></div>
      <div class="routes-scenario-picker"><span>다른 상황도 미리 보세요</span><div class="scenario-bar" aria-label="다른 상황 미리 보기">${scenarioButtons()}</div></div>
    </section>
    ${confirmedJourneyBanner(view, "travel")}
    ${aiCommandCenter(view, recommended)}
    ${ticketProtectionPanel(view)}
    <details class="panel route-details-drawer" id="route-details">
      <summary><span><strong>추천 이유와 다른 열차 보기</strong><small>왜 이 열차인지 확인하고 다른 시간과 비교해 보세요</small></span></summary>
      <div class="route-details-body">
        ${reconciliationPanel(view)}
        ${recommendationDetails(view, recommended)}
        <section class="alternative-routes-section" aria-labelledby="alternative-routes-title">
          <div class="alternative-routes-heading"><div><span>다른 선택</span><h2 id="alternative-routes-title">다른 열차 ${others.length}개도 바로 비교해 보세요</h2></div><p>열차를 펼치면 출발·환승·도착 시간을 더 자세히 볼 수 있어요.</p></div>
          <div class="alternative-route-list">${others.map((candidate, index) => alternativeRouteOption(candidate, view, recommended, index)).join("")}</div>
        </section>
      </div>
    </details>`;
}

function travelView(view) {
  const hasLiveTourism = Boolean(view.signals?.tourismPlaces?.length);
  const items = travelItemsFor(view);
  return `
    <section class="view-heading travel-visual-heading" aria-labelledby="view-title"><div><span class="eyebrow">여행 일정</span><h1 id="view-title" tabindex="-1">열차가 달라져도 ${escapeHtml(state.journey.destination)} 여행은 이어져요</h1><p>새 도착 시간에 맞춰 무리 없는 지역 일정을 다시 연결해요.</p></div><span class="status-pill status-${view.isRecovered ? "watch" : "safe"}">${view.isRecovered ? "대체 일정" : hasLiveTourism ? "공공 관광정보" : "체험 일정"}</span></section>
    ${confirmedJourneyBanner(view, "journey")}
    ${travelHero(view, items)}
    ${travelReplanStrip(view, hasLiveTourism)}
    ${travelPlanSection(view, items)}
    <section class="travel-next-actions" aria-label="다음 행동">
      <div><img src="${ICONS.travelRecheck}" alt="" aria-hidden="true" /><span>열차부터 다시 확인하고 싶나요?</span><strong>${formatTime(view.activeKtx.arrival)} ${escapeHtml(state.journey.destination)}역 도착 일정과 함께 볼 수 있어요.</strong></div>
      <button class="button button-soft" type="button" data-view-target="routes">추천 열차 다시 보기</button>
      <button class="button button-primary" type="button" data-view-target="journey">전체 여정 보기</button>
    </section>`;
}

function validationView(view) {
  const report = state.validationStatus;
  const pilot = state.pilotStatus;
  const counts = report?.counts || { enrolled: 0, boardingOutcomes: 0, platformArrivals: 0 };
  const evidence = report?.evidence || { id: "COLLECTING", label: "실측 수집 준비", reason: "검증 서버를 확인하고 있습니다." };
  const metrics = report?.metrics;
  const session = state.validationSession?.session;
  const completed = session?.status === "COMPLETE";
  const pilotAccepting = pilot?.phase === "ENROLLING";
  const pilotPhaseLabel = pilot?.phaseLabel || "운영 상태 확인 중";
  const tone = evidence.id === "NEEDS_REVISION" ? "risk" : evidence.id === "OPERATIONAL_CANDIDATE" ? "safe" : "watch";
  const fieldStage = completed ? 4 : session?.platformArrived ? 3 : session ? 2 : 1;
  const resultTarget = P2_VALIDATION_PROTOCOL.metricsSuppressionThreshold;
  const resultProgress = Math.min(resultTarget, counts.boardingOutcomes);
  const participantState = session
    ? completed
      ? "내 기록을 모두 남겼어요"
      : session.platformArrived
        ? "열차 탑승 결과를 기다려요"
        : "승강장에 도착하면 알려주세요"
    : pilotAccepting
      ? "참여코드로 바로 시작할 수 있어요"
      : "참여 접수를 준비하고 있어요";
  const fieldSteps = [
    { label: "출발 전", detail: "안내 저장", icon: ICONS.fieldSave },
    { label: "승강장", detail: "도착 기록", icon: ICONS.fieldPlatform },
    { label: "열차", detail: "탑승 결과", icon: ICONS.fieldTrain },
    { label: "결과 확인", detail: "착착이 비교", icon: ICONS.fieldResults }
  ];
  return `
    <section class="view-heading validation-heading field-visual-heading" aria-labelledby="view-title">
      <div><span class="eyebrow">이동 기록</span><h1 id="view-title" tabindex="-1">실제 이동을 따라 착착의 안내를 확인해요</h1><p>출발 전 한 번, 현장에서 두 번만 알려주면 더 안전한 안내를 만들 수 있어요.</p></div>
      <span class="status-pill status-${pilotAccepting ? "safe" : tone}">${escapeHtml(pilotPhaseLabel)}</span>
    </section>

    <section class="field-visual-hero" aria-labelledby="field-hero-title">
      <div class="field-hero-board">
        <div class="field-hero-copy"><span>${session ? "내 현장 기록" : "참여 방법"}</span><h2 id="field-hero-title">${session ? participantState : "세 번만 알려주면 확인이 끝나요"}</h2><p>출발 전 안내를 저장하고, 승강장 도착과 열차 탑승 결과를 실제 시각으로 남겨요.</p></div>
        <ol class="field-journey-stops" aria-label="실제 이동 확인 순서">
          ${fieldSteps.map((step, index) => `<li class="${fieldStage > index + 1 ? "is-complete" : fieldStage === index + 1 && (session || pilotAccepting) ? "is-current" : ""}"><img src="${step.icon}" alt="" aria-hidden="true" /><span>${step.label}</span><strong>${step.detail}</strong></li>`).join("")}
        </ol>
        <div class="field-privacy-points" aria-label="개인정보 보호 원칙"><span>이름 저장 안 함</span><span>최대 30일 보관</span><span>언제든 삭제</span></div>
      </div>
    </section>

    <section class="field-status-strip" aria-label="이동 기록 현재 상태">
      <div><img src="${ICONS.fieldParticipate}" alt="" aria-hidden="true" /><span>지금 참여</span><strong>${pilotAccepting ? "참여할 수 있어요" : "접수 준비 중이에요"}</strong><small>${pilotAccepting ? `${pilot?.admission?.available || 0}개의 코드를 사용할 수 있어요` : "접수가 열리면 참여코드를 입력해요"}</small></div>
      <div><img src="${ICONS.fieldRecord}" alt="" aria-hidden="true" /><span>내 기록</span><strong>${participantState}</strong><small>${session ? escapeHtml(view.activeKtx.service) : "아직 저장한 이동 기록이 없어요"}</small></div>
      <div><img src="${ICONS.fieldPublished}" alt="" aria-hidden="true" /><span>결과 공개</span><strong>${counts.boardingOutcomes}/${resultTarget}건 확인</strong><small>${report?.realWorldPerformanceAvailable ? "충분한 결과가 모였어요" : "30건 전에는 성능 숫자를 숨겨요"}</small></div>
    </section>

    <section class="field-main-grid">
      <article class="panel field-participation-card validation-participation">
        <div class="field-participation-head"><div><span class="eyebrow">내 이동 알려주기</span><h2>${session ? "지금 이동 순간을 기록해 주세요" : "개인정보 없이 참여할 수 있어요"}</h2><p>이름·연락처·예약번호·항공편 번호는 저장하지 않아요.</p></div>${session ? `<span class="source-mode mode-live">기록 중</span>` : ""}</div>
        ${session ? `
          <div class="validation-session-summary"><span>익명으로 참여 중</span><strong>${escapeHtml(view.activeKtx.service)}</strong><small>${session.status === "COMPLETE" ? "탑승 결과 기록 완료" : session.platformArrived ? "타는 곳 도착 기록 완료" : "출발 전 안내를 저장하고 현장 기록을 기다립니다"}</small>${session.participantMatchCode ? `<div class="pilot-match-code"><span>추가 확인용 익명 코드</span><b>${escapeHtml(session.participantMatchCode)}</b><small>현장 담당자에게 이 코드만 보여주세요. 이름이나 예약번호는 필요하지 않습니다.</small></div>` : ""}</div>
          <div class="validation-event-actions">
            <button class="button button-soft" type="button" data-validation-event="PLATFORM_ARRIVED" ${session.platformArrived || completed || state.validationBusy ? "disabled" : ""}>${session.platformArrived ? "승강장 도착 기록됨" : "지금 승강장에 도착했어요"}</button>
            <button class="button button-primary" type="button" data-validation-event="TRAIN_BOARDED" ${completed || state.validationBusy ? "disabled" : ""}>열차를 탔어요</button>
            <button class="button button-plain" type="button" data-validation-event="TRAIN_MISSED" ${completed || state.validationBusy ? "disabled" : ""}>열차를 놓쳤어요</button>
          </div>
          <p class="validation-clock-note">버튼을 누른 시각을 정확하게 저장합니다. 실제 이동 시간이 되기 전에는 기록할 수 없습니다.</p>
          <button class="validation-withdraw" id="withdraw-validation" type="button" ${state.validationBusy ? "disabled" : ""}>동의 철회하고 이 여정 기록 모두 삭제</button>` : `
          <div class="field-prep-note status-${pilotAccepting ? "safe" : "watch"}"><strong>${pilotAccepting ? "현장에서 받은 코드가 있다면 시작할 수 있어요" : "지금은 참여 접수를 준비하고 있어요"}</strong><span>${pilotAccepting ? "코드는 한 번만 사용할 수 있어요." : "아래 내용을 미리 확인하고, 접수가 열리면 참여코드를 입력해 주세요."}</span></div>
          <label class="pilot-code-field"><span>현장에서 받은 참여코드</span><input id="pilot-code" type="text" inputmode="text" autocomplete="one-time-code" maxlength="14" placeholder="CHAK-XXXX-XXXX" aria-describedby="pilot-code-help" ${pilotAccepting ? "" : "disabled"}/><small id="pilot-code-help">한 번만 사용할 수 있어 체험 기록과 실제 이동을 구분할 수 있어요.</small></label>
          <label class="validation-consent"><input id="validation-consent" type="checkbox" /><span><strong>익명으로 이동 결과를 알려주는 데 동의합니다</strong><small>이동조건, 안내 결과, 도착 시각과 탑승 결과를 최대 30일 보관합니다. 이름·연락처·예약번호는 저장하지 않으며 언제든 삭제할 수 있습니다.</small></span></label>
          <label class="validation-consent validation-consent-optional"><input id="institution-match-consent" type="checkbox" /><span><strong>기관 자료와 한 번 더 확인하는 데 동의합니다 <em>선택</em></strong><small>선택하면 현장에서 받은 익명 코드로 기관 자료와 맞는지 확인할 수 있습니다. 별도의 협의가 끝난 뒤에만 진행합니다.</small></span></label>
          <button class="button button-primary validation-start" id="start-validation" type="button" ${state.validationBusy || !pilotAccepting ? "disabled" : ""}>${state.validationBusy ? "출발 전 안내를 저장하고 있어요…" : pilotAccepting ? "현재 여정 확인 시작" : "참여 접수 전입니다"}</button>`}
        ${state.validationError ? `<p class="inline-error" role="alert">${escapeHtml(state.validationError)}</p>` : ""}
      </article>

      <aside class="panel field-results-card validation-metrics-card">
        <div class="field-results-heading"><div><span class="eyebrow">정직한 결과 공개</span><h2>${report?.realWorldPerformanceAvailable ? "충분한 이동 결과가 모였어요" : "30건 전에는 정확도 숫자를 숨겨요"}</h2><p>적은 기록으로 좋아졌다고 말하지 않아요.</p></div><span class="status-pill status-${report?.realWorldPerformanceAvailable ? "safe" : "watch"}">${report?.realWorldPerformanceAvailable ? "결과 공개" : "확인 중"}</span></div>
        ${report?.realWorldPerformanceAvailable && metrics && !metrics.suppressed ? `
          <div class="validation-metric-grid">
            <div><strong>${Math.round(metrics.boarding.successRate * 100)}%</strong><span>실제 탑승 성공</span></div>
            <div><strong>${metrics.boarding.fusedBrier.toFixed(3)}</strong><span>탑승 안내 오차</span></div>
            <div><strong>${metrics.platformArrival.p50MaeMinutes.toFixed(1)}분</strong><span>보통 도착 시각 차이</span></div>
            <div><strong>${Math.round(metrics.platformArrival.p90CoverageRate * 100)}%</strong><span>늦은 도착까지 맞춘 비율</span></div>
          </div>` : `
          <div class="field-result-gate"><div><img src="${ICONS.fieldGate}" alt="" aria-hidden="true" /><strong>${resultTarget}</strong><span>건이 모이면 공개</span></div><progress max="${resultTarget}" value="${resultProgress}" aria-label="실제 이동 결과 ${resultTarget}건 중 ${resultProgress}건 확인"></progress><p>현재 ${counts.boardingOutcomes}건을 확인했어요. 결과가 충분해질 때까지 기다립니다.</p></div>`}
        <ul class="field-quality-list"><li><img src="${ICONS.fieldQuality}" alt="" aria-hidden="true" /><span>중복·잘못된 기록</span><strong>${report?.quality?.status === "BLOCKED" ? "점검 필요" : "자동 확인"}</strong></li><li><img src="${ICONS.fieldAccess}" alt="" aria-hidden="true" /><span>이동 도움이 필요한 경우</span><strong>${report?.segments?.accessibility?.completed || 0}건</strong></li><li><img src="${ICONS.fieldDisruption}" alt="" aria-hidden="true" /><span>여러 지연이 겹친 경우</span><strong>${report?.segments?.disrupted?.completed || 0}건</strong></li></ul>
      </aside>
    </section>

    <details class="field-ops-details panel">
      <summary><span><img src="${ICONS.fieldOps}" alt="" aria-hidden="true" />이동 기록 서비스 상태 보기</span><small>개인정보 없이 필요한 개수만 확인해요</small></summary>
      <div class="field-ops-content">
        <div class="pilot-ops-head"><div><span class="eyebrow">서비스 상태</span><h2>이동 기록이 안전하게 작동하는지 살펴봐요</h2></div><span class="source-mode ${pilotAccepting ? "mode-live" : "mode-demo"}">${escapeHtml(pilotPhaseLabel)}</span></div>
        <div class="pilot-ops-metrics"><div><span>사용 가능 코드</span><strong>${pilot?.admission?.available || 0}</strong><small>발급 ${pilot?.admission?.issued || 0}개</small></div><div><span>진행 중 여정</span><strong>${pilot?.operations?.inProgress || 0}</strong><small>등록 ${pilot?.operations?.enrolled || 0}건</small></div><div class="${(pilot?.operations?.overdueOutcomes || 0) > 0 ? "is-alert" : ""}"><span>확인 필요한 결과</span><strong>${pilot?.operations?.overdueOutcomes || 0}</strong><small>출발 72시간 경과</small></div><div><span>추가 확인 동의</span><strong>${pilot?.operations?.institutionMatchEligible || 0}</strong><small>기관 확인 전</small></div></div>
        <ul class="pilot-readiness" aria-label="이동 기록 준비 상태"><li><i class="readiness-${pilot?.readiness?.admissionControl === "PASS" ? "pass" : "wait"}"></i><span>참여코드 통제</span><strong>${pilot?.readiness?.admissionControl === "PASS" ? "준비됨" : "준비 중"}</strong></li><li><i class="readiness-${pilot?.readiness?.consentIntegrity === "PASS" ? "pass" : "block"}"></i><span>동의 내용 확인</span><strong>${pilot?.readiness?.consentIntegrity === "PASS" ? "준비됨" : "확인 필요"}</strong></li><li><i class="readiness-${pilot?.readiness?.outcomeFollowUp === "PASS" ? "pass" : "block"}"></i><span>결과 확인</span><strong>${pilot?.readiness?.outcomeFollowUp === "PASS" ? "정상" : "확인 필요"}</strong></li><li><i class="readiness-wait"></i><span>안전한 저장 공간</span><strong>준비 중</strong></li></ul>
        ${(pilot?.alerts || []).length ? `<div class="pilot-alerts">${pilot.alerts.map((alert) => `<p><strong>${escapeHtml(alert.severity)}</strong>${escapeHtml(alert.message)}</p>`).join("")}</div>` : ""}
      </div>
    </details>

    <section class="field-honesty-strip" aria-labelledby="field-honesty-title">
      <div class="field-honesty-title"><div><span class="eyebrow">정직한 안내</span><h2 id="field-honesty-title">확인한 사실만 말씀드려요</h2></div></div>
      <div><img src="${ICONS.fieldHonest}" alt="" aria-hidden="true" /><p><strong>확인할 수 있어요</strong>열차를 탔는지, 승강장에 몇 시에 도착했는지 확인해요.</p></div>
      <div><img src="${ICONS.fieldPending}" alt="" aria-hidden="true" /><p><strong>아직 말할 수 없어요</strong>성공률이 높아졌다는 말은 충분한 참여와 추가 확인 뒤에만 해요.</p></div>
    </section>`;
}

function aboutView(view) {
  const sourcesOpen = isCompactScreen() ? "" : " open";
  return `
    <section class="view-heading" aria-labelledby="view-title"><div><span class="eyebrow">서비스 안내</span><h1 id="view-title" tabindex="-1">착착은 이렇게 안내해요</h1><p>사용하는 정보와 계산 방법, 제공할 수 있는 기능을 투명하게 알려드립니다.</p></div><span class="data-badge">${dataModeLabel()}</span></section>
    <section class="about-layout">
      <details class="panel sources-panel about-data-disclosure"${sourcesOpen}><summary><span class="about-data-summary"><img src="${ICONS.aboutData}" alt="" aria-hidden="true" /><span><strong>연결된 공공·개방 데이터</strong><small>공식 출처와 현재 연결 상태를 확인하세요</small></span></span><span class="mobile-disclosure-badge"><strong>7개</strong><small>보기</small></span></summary><div class="about-data-content"><div class="panel-header"><div><h2>사용하는 공공·개방 데이터</h2><p>항공·공항·철도·기상·관광 정보를 한 여정으로 연결합니다.</p></div></div><ol class="source-list">${sourceItems()}</ol></div></details>
      <aside class="section-stack">
        <article class="panel plain-language-card"><h2>도착 예상 안내</h2><dl><div><dt>가장 흔한 도착</dt><dd>평소에는 이 시각쯤 타는 곳에 도착할 것으로 예상해요.</dd></div><div><dt>늦는 경우까지 본 도착</dt><dd>입국과 수하물이 늦어지는 경우까지 포함한 예상이에요.</dd></div><div><dt>열차를 탈 가능성</dt><dd>현재 상황과 개인 이동조건을 함께 살펴본 결과예요.</dd></div></dl></article>
        <article class="panel honesty-card"><h2>현재 가능한 것</h2><p>항공·입국·날씨·공항철도 정보를 함께 살펴보고, 다음 열차와 지역 여행 일정을 다시 연결합니다.</p><h3>기관 협업이 필요한 것</h3><p>좌석은 코레일 공식 채널에서 확인합니다. 자동 결제와 표 변경은 아직 제공하지 않습니다.</p></article>
      </aside>
    </section>
    <section class="panel impact-panel"><div class="panel-header"><div><h2>서비스가 지키는 약속</h2><p>누구나 안심하고 사용할 수 있도록 다음 원칙을 모든 안내에 적용합니다.</p></div><span class="status-pill status-safe">안심 기준</span></div><ul class="impact-grid">${impactCards()}</ul><p class="demo-notice">실제 이동 결과가 충분히 모이기 전에는 성능 수치를 공개하지 않으며, 좌석과 승차권은 운영사 공식 채널에서 마지막으로 확인하도록 안내합니다.</p></section>`;
}

function activeContent(view) {
  if (state.activeView === "routes") return routesView(view);
  if (state.activeView === "travel") return travelView(view);
  if (state.activeView === "validation") return validationView(view);
  if (state.activeView === "about") return aboutView(view);
  return journeyView(view);
}

function aiGuideQuestions() {
  const common = ["지금 무엇을 해야 해?", "왜 이 열차를 추천했어?"];
  const byView = {
    journey: "늦어지면 어떻게 해야 해?",
    routes: "예매한 표는 어떻게 해야 해?",
    travel: "여행 일정은 어떻게 바뀌어?",
    validation: "이동 기록은 왜 필요해?",
    about: "어떤 정보를 사용해?"
  };
  return [...common, byView[state.activeView] || byView.journey];
}

function aiGuideOverlay(view) {
  const answer = state.guideAnswer;
  const isLoading = state.guideStatus === "loading";
  const isJourneyLoading = state.fusionLoading;
  const guideDisabled = isLoading || isJourneyLoading;
  const relatedLabels = {
    journey: "내 이동에서 보기",
    routes: "다음 열차에서 보기",
    travel: "여행 일정에서 보기",
    validation: "이동 기록에서 보기",
    about: "서비스 안내에서 보기"
  };
  const guideSteps = [
    { view: "journey", icon: ICONS.guideMove, title: "1. 내 이동 연결", detail: "항공편·짐·예매한 표를 알려주세요" },
    { view: "routes", icon: ICONS.guideTrain, title: "2. 다음 열차 확인", detail: "탈 가능성이 높은 열차부터 확인해요" },
    { view: "travel", icon: ICONS.guideTravel, title: "3. 여행 일정 이어가기", detail: "새 도착 시각에 맞춰 지역 일정을 봐요" }
  ];
  const answerBlock = answer
    ? `<div class="ai-guide-conversation" id="ai-guide-answer" tabindex="-1">
        <p class="ai-guide-user-message">${escapeHtml(state.guideQuestion)}</p>
        <div class="ai-guide-answer">
          <div class="ai-guide-answer-head"><img src="/assets/brand/chakchak-logo-app.png" alt="" aria-hidden="true" /><span>${state.guideMode === "live" ? "착착 AI가 현재 여정을 보고 답했어요" : "착착 기본 안내"}</span></div>
          <p>${escapeHtml(answer.answer)}</p>
          ${answer.actions?.length ? `<ol>${answer.actions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}</ol>` : ""}
          ${answer.relatedView && answer.relatedView !== "none" ? `<button class="button button-soft" type="button" data-view-target="${answer.relatedView}">${relatedLabels[answer.relatedView] || "관련 화면 보기"}</button>` : ""}
          <small>${escapeHtml(answer.disclaimer)}</small>
        </div>
      </div>`
    : `<div class="ai-guide-onboarding">
        <div><strong>처음이라면 이 순서로 시작하세요</strong><p>원하는 단계만 눌러 바로 이동할 수 있어요.</p></div>
        <ol>${guideSteps.map((step) => `<li><button type="button" data-view-target="${step.view}"><img src="${step.icon}" alt="" aria-hidden="true" /><span><strong>${step.title}</strong><small>${step.detail}</small></span></button></li>`).join("")}</ol>
      </div>`;
  return `
    <aside class="ai-guide-overlay ${state.guideOpen ? "is-open" : ""}" aria-label="착착 AI 가이드">
      <section class="ai-guide-popover" id="ai-guide-popover" role="dialog" aria-modal="false" aria-labelledby="ai-guide-title" ${state.guideOpen ? "" : "hidden"}>
        <header><div><span class="ai-guide-mini-mark"><img src="/assets/brand/chakchak-logo-app.png" alt="" aria-hidden="true" /></span><div><strong id="ai-guide-title">착착 AI 가이드</strong><small>현재 여정과 착착 사용법만 안내해요</small></div></div><button id="close-ai-guide" type="button" aria-label="AI 가이드 닫기">닫기</button></header>
        <div class="ai-guide-scroll">
          ${answerBlock}
          ${state.guideError ? `<p class="ai-guide-error" role="alert">${escapeHtml(state.guideError)}</p>` : ""}
          ${isJourneyLoading ? `<p class="ai-guide-loading-note">현재 여정 정보를 먼저 확인하고 있어요. 잠시만 기다려 주세요.</p>` : ""}
          <div class="ai-guide-suggestions" aria-label="자주 묻는 질문">${aiGuideQuestions().map((question) => `<button type="button" data-guide-question="${escapeHtml(question)}" ${guideDisabled ? "disabled" : ""}>${escapeHtml(question)}</button>`).join("")}</div>
        </div>
        <form class="ai-guide-form" id="ai-guide-form">
          <label for="ai-guide-question">궁금한 내용을 물어보세요</label>
          <div><input id="ai-guide-question" name="question" maxlength="180" autocomplete="off" placeholder="예: 지금 무엇을 해야 해?" ${guideDisabled ? "disabled" : ""} /><button type="submit" ${guideDisabled ? "disabled" : ""}>${isLoading ? "답변 중" : isJourneyLoading ? "확인 중" : "보내기"}</button></div>
          <small>이름·연락처·예약번호는 입력하지 마세요.</small>
        </form>
      </section>
      <button class="ai-guide-fab" id="toggle-ai-guide" type="button" aria-label="${state.guideOpen ? "AI 가이드 닫기" : "착착 AI 가이드 열기"}" aria-expanded="${state.guideOpen}" aria-controls="ai-guide-popover">
        <span class="ai-guide-fab-glow" aria-hidden="true"></span>
        <img src="/assets/brand/chakchak-logo-app.png" alt="" aria-hidden="true" />
        <span>${state.guideOpen ? "가이드 닫기" : "AI에게 물어보기"}</span>
      </button>
    </aside>`;
}

function render(options = {}) {
  const view = getViewModel();
  const recoveryArex = view.railPlan.airportRail.find((item) => item.id === view.recovery.id);
  const recoveryKtx = view.railPlan.trains.find((item) => item.recommendedArexId === view.recovery.id);

  app.innerHTML = `
    <div class="topbar-wrap">
      <header class="topbar app-shell">
        <button class="brand" type="button" data-view-target="journey" aria-label="착착 내 이동으로 이동">
          <span class="brand-mark" aria-hidden="true"><img src="/assets/brand/chakchak-logo-app.png" alt="" /></span>
          <span class="brand-copy"><strong>착착 CHAK²</strong><span>항공부터 철도까지 이어주는 여행 도우미</span></span>
        </button>
        <nav class="topnav" aria-label="주요 메뉴">${navButtons()}</nav>
        <div class="header-actions">
          <span class="mode-pill ${state.dataMode === "live-ready" ? "is-live" : ""}">${headerDataModeLabel()}</span>
          <button class="header-about-button" type="button" data-view-target="about" aria-current="${state.activeView === "about" ? "page" : "false"}"><img src="${ICONS.serviceInfo}" alt="" aria-hidden="true" /><span>서비스 안내</span></button>
        </div>
      </header>
    </div>

    <main id="main" class="app-shell view-shell">${activeContent(view)}</main>

    ${aiGuideOverlay(view)}

    <nav class="mobile-nav" aria-label="모바일 주요 메뉴">${navButtons("mobile-nav-item")}</nav>

    <footer class="site-footer"><div class="app-shell footer-grid"><div class="footer-brand"><img src="/assets/brand/chakchak-logo-app.png" alt="" aria-hidden="true" /><div><strong>착착 CHAK²</strong><p>착륙부터 열차 착석까지, 안심할 수 있는 이동을 돕습니다.</p></div></div><span>착착 자체 AI × 공공·개방 데이터</span></div></footer>

    <dialog id="journey-setup-dialog" aria-labelledby="journey-setup-title" aria-describedby="journey-setup-description">
      <form class="dialog-body journey-setup-form" id="journey-setup-form">
        <span class="dialog-kicker">내 이동 연결하기</span>
        <h2 id="journey-setup-title">항공편과 여행조건을 알려주세요</h2>
        <p id="journey-setup-description">이름이나 예약번호 없이 필요한 이동조건만 사용합니다.</p>
        <div class="setup-grid">
          <label><span>도착 항공편</span><input id="journey-flight" name="flight" value="${escapeHtml(state.journey.flightId)}" maxlength="8" pattern="[A-Za-z0-9]{2,8}" autocomplete="off" required /></label>
          <label><span>도착 예정</span><input id="journey-arrival" name="arrival" type="datetime-local" value="${toDateTimeLocalValue(state.journey.arrivalAt)}" required /></label>
          <label><span>지역 목적지</span><select id="journey-destination" name="destination"><option value="전주" selected>전주 · 현재 이용 가능</option><option disabled>부산 · 지원 준비 중</option><option disabled>강릉 · 지원 준비 중</option></select></label>
          <label><span>위탁수하물</span><select id="journey-bags" name="bags"><option value="0" ${state.journey.checkedBags === 0 ? "selected" : ""}>없음</option><option value="1" ${state.journey.checkedBags === 1 ? "selected" : ""}>1개</option><option value="2" ${state.journey.checkedBags >= 2 ? "selected" : ""}>2개 이상</option></select></label>
        </div>
        <fieldset class="setup-options"><legend>이동할 때 필요한 도움</legend><label><input id="journey-mobility" type="checkbox" ${state.journey.mobility !== "standard" ? "checked" : ""} /><span>천천히 걷거나 엘리베이터 동선이 필요해요</span></label><label><input id="journey-large-luggage" type="checkbox" ${state.journey.largeLuggage ? "checked" : ""} /><span>큰 짐이 있어요</span></label></fieldset>
        <fieldset class="ticket-setup-card">
          <legend>예매한 승차권</legend>
          <label class="ticket-setup-toggle"><input id="journey-has-ticket" type="checkbox" ${state.journey.ticket?.hasBookedTicket ? "checked" : ""} /><span><strong>이미 예매한 열차표가 있어요</strong><small>예약번호는 입력하지 않습니다.</small></span></label>
          <div class="ticket-setup-details" id="ticket-setup-details" ${state.journey.ticket?.hasBookedTicket ? "" : "hidden"}>
            <div class="ticket-operator-options" role="group" aria-label="예매한 운영사">
              <label><input id="journey-ticket-arex" type="checkbox" ${state.journey.ticket?.arex ? "checked" : ""} /><span>공항철도 표</span></label>
              <label><input id="journey-ticket-korail" type="checkbox" ${state.journey.ticket?.korail !== false ? "checked" : ""} /><span>KTX·코레일 표</span></label>
            </div>
            <div class="ticket-setup-selects">
              <label><span>KTX·코레일 표 종류</span><select id="journey-ticket-type">${TICKET_TYPES.map((type) => `<option value="${type.id}" ${state.journey.ticket?.ticketType === type.id ? "selected" : ""}>${type.label}</option>`).join("")}</select></label>
              <label><span>공항철도 표 종류</span><select id="journey-arex-type"><option value="direct" ${state.journey.ticket?.arexType !== "general" ? "selected" : ""}>직통열차 승차권</option><option value="general" ${state.journey.ticket?.arexType === "general" ? "selected" : ""}>일반열차·교통카드</option></select></label>
            </div>
            <p>표 종류에 따라 반환 마감과 부담이 달라요. 최종 금액은 각 운영사 공식 채널에서 확인합니다.</p>
          </div>
        </fieldset>
        <p class="setup-hint">항공·입국·날씨·철도 데이터를 다시 불러와 탑승 가능성을 계산합니다.</p>
        <div class="dialog-actions"><button class="button button-soft" id="close-journey-setup" type="button">취소</button><button class="button button-primary" type="submit">이 여정으로 계산하기</button></div>
      </form>
    </dialog>

    <dialog id="recovery-dialog" aria-labelledby="recovery-title" aria-describedby="recovery-description">
      <div class="dialog-body">
        <span class="dialog-kicker">더 안전한 열차를 찾았어요</span>
        <h2 id="recovery-title">대체 일정과 승차권 처리 순서를 확인하세요</h2>
        <p id="recovery-description">${view.isDisrupted ? view.preset.note : "지금 공항 상황과 짐·이동 조건"}을 살펴보니, 지금 열차를 탈 수 있는 가능성은 ${formatPercent(displayedProbability(view, view.primary))}예요. 더 여유 있는 열차와 ${escapeHtml(state.journey.destination)} 일정까지 함께 준비했습니다.</p>
        <div class="recovery-compare">
          <div class="recovery-card"><span>지금 일정</span><strong>${formatTime(view.railPlan.airportRail[0].departure)} · ${view.railPlan.trains[0].service}</strong><small>${formatPercent(displayedProbability(view, view.primary))} 가능</small></div>
          <span class="recovery-arrow" aria-hidden="true">다음</span>
          <div class="recovery-card is-new"><span>추천 일정</span><strong>${formatTime(recoveryArex.departure)} · ${recoveryKtx.service}</strong><small>${formatPercent(displayedProbability(view, view.recovery))} 가능</small></div>
        </div>
        ${ticketProtectionDialog(view)}
        <div class="dialog-actions"><button class="button button-soft" id="close-recovery" type="button">지금 일정 유지</button><button class="button button-primary" id="apply-recovery" type="button">대체 일정 후보로 저장</button></div>
      </div>
    </dialog>
    <div class="toast-region" id="toast-region" aria-live="polite" aria-atomic="true"></div>`;

  bindEvents(view);
  if (options.focusSelector) {
    window.requestAnimationFrame(() => document.querySelector(options.focusSelector)?.focus({ preventScroll: true }));
  }
}

function bindEvents(view) {
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", (event) => {
      setActiveView(button.dataset.viewTarget, { focusHeading: event.detail === 0 });
    });
  });
  document.querySelectorAll("[data-travel-day]").forEach((button) => {
    button.addEventListener("click", () => {
      state.travelDay = button.dataset.travelDay;
      render({ focusSelector: `[data-travel-day="${state.travelDay}"]` });
    });
  });
  document.querySelectorAll("img[data-fallback-src]").forEach((image) => {
    image.addEventListener("error", () => {
      if (image.dataset.fallbackApplied === "true") return;
      image.dataset.fallbackApplied = "true";
      image.src = image.dataset.fallbackSrc;
      image.alt = image.dataset.fallbackAlt || "지역 여행을 나타내는 착착 대표 이미지";
    });
  });
  document.querySelector("#run-disruption")?.addEventListener("click", () => setScenario("rain"));
  document.querySelector("#reset-demo")?.addEventListener("click", () => setScenario("normal"));
  document.querySelectorAll("[data-scenario]").forEach((button) => {
    button.addEventListener("click", () => setScenario(button.dataset.scenario));
  });
  const journeyTimeScrubber = document.querySelector("#journey-time-scrubber");
  journeyTimeScrubber?.addEventListener("input", (event) => {
    const minutes = Math.max(0, Math.min(90, Number(event.target.value) || 0));
    const output = document.querySelector("#journey-delay-output");
    const wrapper = event.target.closest(".journey-scrubber-wrap");
    event.target.setAttribute("aria-valuetext", previewDelayLabel(minutes));
    if (output) output.textContent = previewDelayLabel(minutes);
    wrapper?.style.setProperty("--delay-position", `${Math.round(minutes / 90 * 100)}%`);
  });
  journeyTimeScrubber?.addEventListener("change", (event) => setPreviewDelay(Number(event.target.value)));
  document.querySelector("#open-route-details")?.addEventListener("click", () => {
    const details = document.querySelector("#route-details");
    if (!details) return;
    details.open = true;
    details.querySelector("summary")?.focus({ preventScroll: true });
    details.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });
  document.querySelectorAll("[data-open-recovery]").forEach((button) => button.addEventListener("click", openRecovery));
  document.querySelector("#close-recovery")?.addEventListener("click", closeRecovery);
  document.querySelector("#open-journey-setup")?.addEventListener("click", openJourneySetup);
  document.querySelector("#open-ticket-setup")?.addEventListener("click", () => {
    openJourneySetup();
    window.requestAnimationFrame(() => document.querySelector("#journey-has-ticket")?.focus());
  });
  document.querySelector("#close-journey-setup")?.addEventListener("click", closeJourneySetup);
  document.querySelector("#journey-has-ticket")?.addEventListener("change", (event) => {
    const details = document.querySelector("#ticket-setup-details");
    if (details) details.hidden = !event.target.checked;
  });
  document.querySelector("#journey-setup-form")?.addEventListener("submit", applyJourneySetup);
  document.querySelector("#apply-recovery")?.addEventListener("click", () => {
    const originalArex = view.railPlan.airportRail.find((item) => item.id === view.primary.id);
    const originalKtx = view.railPlan.trains.find((item) => item.recommendedArexId === view.primary.id);
    state.confirmedJourney = createConfirmedJourney({
      journey: state.journey,
      scenarioId: state.scenarioId,
      selectedArex: recoveryArexFor(view),
      selectedKtx: recoveryKtxFor(view),
      originalArex,
      originalKtx,
      probabilityPercent: displayedProbability(view, view.recovery)
    });
    saveConfirmedJourney(window.sessionStorage, state.confirmedJourney);
    state.activeView = "journey";
    window.history.replaceState(null, "", "#journey");
    resetAiGuidance();
    syncValidationPlan(view.recovery.id);
    closeRecovery();
    render({ focusSelector: "#journey-status" });
    announce(`대체 일정 후보를 저장했어요. 좌석과 기존 표를 공식 채널에서 직접 확인해 주세요. 탈 수 있는 가능성은 ${Math.round(displayedProbability(view, view.recovery))}퍼센트예요.`);
  });
  document.querySelector("#ai-locale")?.addEventListener("change", (event) => {
    state.aiLocale = event.target.value;
  });
  document.querySelector("#request-ai")?.addEventListener("click", () => requestAiGuidance(view));
  document.querySelector("#toggle-ai-guide")?.addEventListener("click", () => {
    state.guideOpen = !state.guideOpen;
    render({ focusSelector: state.guideOpen ? "#ai-guide-question" : "#toggle-ai-guide" });
  });
  document.querySelector("#close-ai-guide")?.addEventListener("click", () => {
    state.guideOpen = false;
    render({ focusSelector: "#toggle-ai-guide" });
  });
  document.querySelector("#ai-guide-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    requestAiGuideAnswer(view, document.querySelector("#ai-guide-question")?.value || "");
  });
  document.querySelectorAll("[data-guide-question]").forEach((button) => {
    button.addEventListener("click", () => requestAiGuideAnswer(view, button.dataset.guideQuestion || ""));
  });
  document.querySelector("#start-validation")?.addEventListener("click", () => startValidation(view));
  document.querySelectorAll("[data-validation-event]").forEach((button) => {
    button.addEventListener("click", () => recordValidationEvent(button.dataset.validationEvent));
  });
  document.querySelector("#withdraw-validation")?.addEventListener("click", withdrawValidation);
}

function setActiveView(viewId, options = {}) {
  if (!navigation.some((item) => item.id === viewId)) return;
  state.activeView = viewId;
  window.history.replaceState(null, "", `#${viewId}`);
  render({ focusSelector: options.focusHeading ? "#view-title" : null });
  window.scrollTo({
    top: 0,
    behavior: isCompactScreen() || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
  });
}

function setScenario(scenarioId) {
  state.scenarioId = disruptionPresets[scenarioId] ? scenarioId : "normal";
  state.previewDelayMinutes = disruptionPresets[state.scenarioId].flightDelayMinutes;
  state.customDelayActive = false;
  clearConfirmedSelection();
  resetAiGuidance();
  render();
  const view = getViewModel();
  announce(`${view.preset.label}. 이 열차를 탈 수 있는 가능성은 ${Math.round(displayedProbability(view, view.primary))}퍼센트예요.`);
}

function setPreviewDelay(minutes) {
  const nextDelay = Math.round(Math.max(0, Math.min(90, Number(minutes) || 0)) / 5) * 5;
  state.previewDelayMinutes = nextDelay;
  state.customDelayActive = true;
  clearConfirmedSelection();
  resetAiGuidance();
  render({ focusSelector: "#journey-time-scrubber" });
  const view = getViewModel();
  announce(`${previewDelayLabel(nextDelay)}으로 살펴봤어요. 추천 열차를 탈 수 있는 가능성은 ${Math.round(displayedProbability(view, view.recovery || view.primary))}퍼센트예요.`);
}

function recoveryArexFor(view) {
  return view.railPlan.airportRail.find((item) => item.id === view.recovery.id);
}

function recoveryKtxFor(view) {
  return view.railPlan.trains.find((item) => item.recommendedArexId === view.recovery.id);
}

function clearConfirmedSelection() {
  state.confirmedJourney = null;
  clearConfirmedJourney(window.sessionStorage);
}

function resetAiGuidance() {
  state.aiStatus = "idle";
  state.aiMode = null;
  state.aiGuidance = null;
  state.aiError = null;
  resetAiGuideResponse();
}

function resetAiGuideResponse() {
  state.guideRequestId += 1;
  state.guideStatus = "idle";
  state.guideQuestion = "";
  state.guideAnswer = null;
  state.guideMode = null;
  state.guideError = null;
}

function getClientToken() {
  const storageKey = "chakchak-ai-session";
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) return saved;
    const created = window.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return "anonymous-demo";
  }
}

async function requestAiGuidance(view) {
  state.aiLocale = document.querySelector("#ai-locale")?.value || state.aiLocale;
  state.aiStatus = "loading";
  state.aiGuidance = null;
  state.aiError = null;
  render({ focusSelector: "#request-ai" });

  try {
    const response = await fetch("/api/ai/concierge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientToken: getClientToken(),
        locale: state.aiLocale,
        scenario: view.preset.label,
        disruptionNote: view.preset.note,
        probability: displayedProbability(view, view.activeCandidate),
        originalProbability: displayedProbability(view, view.primary),
        recovered: view.isRecovered,
        destination: state.journey.destination,
        interests: state.journey.interests,
        selectedTrain: {
          id: view.activeKtx.id,
          service: view.activeKtx.service,
          airportDeparture: formatTime(view.activeArex.departure),
          railDeparture: formatTime(view.activeKtx.departure),
          destinationArrival: formatTime(view.activeKtx.arrival)
        },
        originalTrain: {
          id: view.railPlan.trains[0].id,
          service: view.railPlan.trains[0].service
        }
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.guidance) throw new Error(payload.error || "AI 안내를 불러오지 못했습니다.");
    state.aiStatus = "ready";
    state.aiMode = payload.mode;
    state.aiModel = payload.model || state.aiModel;
    state.aiGuidance = payload.guidance;
    render({ focusSelector: "#ai-result" });
    announce(payload.mode === "live" ? "맞춤 안내를 준비했어요." : "기본 안내를 준비했어요.");
  } catch (error) {
    state.aiStatus = "error";
    state.aiError = error instanceof Error ? error.message : "AI 안내를 불러오지 못했습니다.";
    render({ focusSelector: "#request-ai" });
  }
}

async function requestAiGuideAnswer(view, rawQuestion) {
  const question = String(rawQuestion || "").trim().slice(0, 180);
  if (!question) {
    state.guideOpen = true;
    state.guideError = "궁금한 내용을 한 문장으로 입력해 주세요.";
    render({ focusSelector: "#ai-guide-question" });
    return;
  }
  if (state.fusionLoading) {
    state.guideOpen = true;
    state.guideError = "현재 여정 정보를 확인하고 있어요. 잠시 후 다시 물어봐 주세요.";
    render({ focusSelector: "#close-ai-guide" });
    return;
  }

  const guideCandidate = view.isRecovered ? view.activeCandidate : view.canRecover ? view.recovery : view.primary;
  const guideArex = view.railPlan.airportRail.find((item) => item.id === guideCandidate.id) || view.activeArex;
  const guideKtx = view.railPlan.trains.find((item) => item.recommendedArexId === guideCandidate.id) || view.activeKtx;
  const probability = Math.round(displayedProbability(view, guideCandidate));
  const p50 = formatTime(view.simulation.platformArrival.p50);
  const p90 = formatTime(view.simulation.platformArrival.p90);
  state.guideOpen = true;
  state.guideStatus = "loading";
  state.guideQuestion = question;
  state.guideAnswer = null;
  state.guideError = null;
  const guideRequestId = ++state.guideRequestId;
  render({ focusSelector: "#ai-guide-title" });

  try {
    const response = await fetch("/api/ai/guide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientToken: getClientToken(),
        question,
        activeView: state.activeView,
        dataMode: state.dataMode,
        journey: {
          origin: view.signals?.origin || demoTrip.flight.originCity,
          destination: state.journey.destination,
          checkedBags: state.journey.checkedBags,
          mobilitySupport: state.journey.mobility !== "standard" || state.journey.largeLuggage
        },
        ticketProtection: {
          hasBookedTicket: view.ticketProtection?.hasBookedTicket,
          operators: (view.ticketProtection?.operators || []).map((operator) => ({
            label: operator.label,
            deadline: operator.deadline,
            feeBand: operator.feeBand,
            officialLabel: operator.officialLabel
          })),
          steps: (view.ticketProtection?.steps || []).map((step) => step.label),
          disclaimer: view.ticketProtection?.disclaimer
        },
        model: {
          boardingProbability: probability,
          riskLabel: riskLabel(displayedRiskLevel(view, guideCandidate)),
          platformP50: p50,
          platformP90: p90,
          selectedTrain: guideKtx.service,
          airportRailDeparture: formatTime(guideArex.departure),
          trainDeparture: formatTime(guideKtx.departure),
          destinationArrival: formatTime(guideKtx.arrival),
          recovered: view.isRecovered,
          fallbackRequired: view.modelFallbackRequired
        }
      })
    });
    const payload = await response.json();
    if (guideRequestId !== state.guideRequestId) return;
    if (!response.ok || !payload.answer) throw new Error(payload.error || "AI 가이드 답변을 준비하지 못했습니다.");
    state.guideStatus = "ready";
    state.guideMode = payload.mode;
    state.guideAnswer = payload.answer;
    state.aiModel = payload.model || state.aiModel;
    render({ focusSelector: "#ai-guide-answer" });
    announce("착착 AI 가이드가 답변했어요.");
  } catch (error) {
    if (guideRequestId !== state.guideRequestId) return;
    state.guideStatus = "error";
    state.guideError = error instanceof Error ? error.message : "AI 가이드 답변을 준비하지 못했습니다.";
    render({ focusSelector: "#ai-guide-question" });
  }
}

function openRecovery() {
  const dialog = document.querySelector("#recovery-dialog");
  if (dialog && !dialog.open) dialog.showModal();
}

function openJourneySetup() {
  const dialog = document.querySelector("#journey-setup-dialog");
  if (dialog && !dialog.open) dialog.showModal();
}

function closeJourneySetup() {
  const dialog = document.querySelector("#journey-setup-dialog");
  if (dialog?.open) dialog.close();
}

async function applyJourneySetup(event) {
  event.preventDefault();
  const flightId = String(document.querySelector("#journey-flight")?.value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  const arrivalValue = document.querySelector("#journey-arrival")?.value;
  if (flightId.length < 2) {
    announce("항공편 번호를 확인해 주세요.");
    return;
  }
  const hasBookedTicket = Boolean(document.querySelector("#journey-has-ticket")?.checked);
  const hasKorailTicket = Boolean(document.querySelector("#journey-ticket-korail")?.checked);
  const hasArexTicket = Boolean(document.querySelector("#journey-ticket-arex")?.checked);
  if (hasBookedTicket && !hasKorailTicket && !hasArexTicket) {
    announce("예매한 공항철도표 또는 KTX·코레일표를 하나 이상 선택해 주세요.");
    document.querySelector("#journey-ticket-arex")?.focus();
    return;
  }

  state.journey.flightId = flightId;
  state.journey.arrivalAt = fromDateTimeLocalValue(arrivalValue, state.journey.arrivalAt);
  state.journey.destination = document.querySelector("#journey-destination")?.value || "전주";
  state.journey.checkedBags = Number(document.querySelector("#journey-bags")?.value || 0);
  state.journey.mobility = document.querySelector("#journey-mobility")?.checked ? "assisted" : "standard";
  state.journey.largeLuggage = Boolean(document.querySelector("#journey-large-luggage")?.checked);
  state.journey.ticket = {
    hasBookedTicket,
    korail: hasKorailTicket,
    arex: hasArexTicket,
    ticketType: document.querySelector("#journey-ticket-type")?.value || "standard",
    arexType: document.querySelector("#journey-arex-type")?.value || "direct"
  };
  state.scenarioId = "normal";
  state.previewDelayMinutes = 0;
  state.customDelayActive = false;
  clearConfirmedSelection();
  state.fusion = null;
  state.signals = null;
  state.fusionLoading = true;
  resetAiGuidance();
  closeJourneySetup();
  render({ focusSelector: "#view-title" });
  await loadFusionData({ announceResult: true });
}

function closeRecovery() {
  const dialog = document.querySelector("#recovery-dialog");
  if (dialog?.open) dialog.close();
}

function announce(message) {
  const region = document.querySelector("#toast-region");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function loadStoredValidationSession() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem("chakchak-p2-validation-session") || "null");
    return parsed?.token && parsed?.session ? parsed : null;
  } catch {
    return null;
  }
}

function saveValidationSession(token, session) {
  state.validationSession = token && session ? { token, session } : null;
  try {
    if (state.validationSession) window.localStorage.setItem("chakchak-p2-validation-session", JSON.stringify(state.validationSession));
    else window.localStorage.removeItem("chakchak-p2-validation-session");
  } catch {
    // 저장이 제한된 브라우저에서는 현재 화면에서만 토큰을 유지합니다.
  }
}

async function startValidation(view) {
  if (!document.querySelector("#validation-consent")?.checked) {
    state.validationError = "익명 실측 검증 참여 내용을 확인하고 동의해 주세요.";
    render({ focusSelector: "#validation-consent" });
    return;
  }
  const pilotCode = document.querySelector("#pilot-code")?.value?.trim() || "";
  if (state.pilotStatus?.admission?.inviteRequired && !pilotCode) {
    state.validationError = "현장에서 받은 일회용 참여코드를 입력해 주세요.";
    render({ focusSelector: "#pilot-code" });
    return;
  }
  const institutionMatchConsent = Boolean(document.querySelector("#institution-match-consent")?.checked);
  state.validationBusy = true;
  state.validationError = null;
  render({ focusSelector: "#start-validation" });
  try {
    const scheduledArrival = view.signals?.scheduledArrival || state.journey.arrivalAt;
    const input = buildChakchakInput(state.scenarioId, scheduledArrival, view.railPlan);
    const response = await fetch("/api/validation/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        consent: true,
        institutionMatchConsent,
        pilotCode,
        plannedTrainId: view.activeCandidate.id
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.token || !payload.session) throw new Error(payload.error || "실측 검증을 시작하지 못했습니다.");
    saveValidationSession(payload.token, payload.session);
    state.validationBusy = false;
    await loadValidationStatus({ refreshSession: false });
    render({ focusSelector: ".validation-session-summary" });
    announce("익명 예측을 잠갔습니다. 실제 이동 시 현장 결과를 기록해 주세요.");
  } catch (error) {
    state.validationBusy = false;
    state.validationError = error instanceof Error ? error.message : "실측 검증을 시작하지 못했습니다.";
    render({ focusSelector: "#start-validation" });
  }
}

async function recordValidationEvent(eventType) {
  const token = state.validationSession?.token;
  if (!token) return;
  state.validationBusy = true;
  state.validationError = null;
  render();
  try {
    const response = await fetch("/api/validation/observe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, eventType })
    });
    const payload = await response.json();
    if (!response.ok || !payload.session) throw new Error(payload.error || "현장 기록을 저장하지 못했습니다.");
    saveValidationSession(token, payload.session);
    state.validationBusy = false;
    await loadValidationStatus({ refreshSession: false });
    render({ focusSelector: ".validation-session-summary" });
    announce(eventType === "PLATFORM_ARRIVED" ? "승강장 도착 시각을 기록했습니다." : eventType === "TRAIN_BOARDED" ? "탑승 성공을 기록했습니다." : "열차를 놓친 결과를 기록했습니다.");
  } catch (error) {
    state.validationBusy = false;
    state.validationError = error instanceof Error ? error.message : "현장 기록을 저장하지 못했습니다.";
    render();
  }
}

async function syncValidationPlan(trainId) {
  const token = state.validationSession?.token;
  if (!token || state.validationSession?.session?.status === "COMPLETE") return;
  try {
    const response = await fetch("/api/validation/observe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, eventType: "PLAN_SELECTED", trainId })
    });
    const payload = await response.json();
    if (response.ok && payload.session) saveValidationSession(token, payload.session);
  } catch {
    // 여정 변경은 다음 실측 화면에서 다시 동기화할 수 있습니다.
  }
}

async function withdrawValidation() {
  const token = state.validationSession?.token;
  if (!token) return;
  if (!window.confirm("이 익명 여정의 예측과 현장 기록을 저장소에서 모두 삭제할까요?")) return;
  state.validationBusy = true;
  state.validationError = null;
  render();
  try {
    const response = await fetch("/api/validation/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "기록을 삭제하지 못했습니다.");
    saveValidationSession(null, null);
    state.validationBusy = false;
    await loadValidationStatus({ refreshSession: false });
    render({ focusSelector: "#view-title" });
    announce("이 여정의 실측 기록을 모두 삭제했습니다.");
  } catch (error) {
    state.validationBusy = false;
    state.validationError = error instanceof Error ? error.message : "기록을 삭제하지 못했습니다.";
    render();
  }
}

async function loadValidationStatus(options = {}) {
  state.validationLoading = true;
  try {
    const [response, pilotResponse] = await Promise.all([
      fetch("/api/validation/status", { cache: "no-store" }),
      fetch("/api/pilot/status", { cache: "no-store" })
    ]);
    if (!response.ok || !pilotResponse.ok) throw new Error("VALIDATION_STATUS_ERROR");
    state.validationStatus = await response.json();
    state.pilotStatus = await pilotResponse.json();
    if (options.refreshSession !== false && state.validationSession?.token) {
      const sessionResponse = await fetch("/api/validation/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: state.validationSession.token })
      });
      if (sessionResponse.ok) {
        const payload = await sessionResponse.json();
        saveValidationSession(state.validationSession.token, payload.session);
      } else {
        saveValidationSession(null, null);
      }
    }
  } catch {
    state.validationStatus = null;
    state.pilotStatus = null;
  } finally {
    state.validationLoading = false;
    if (state.activeView === "validation") render();
  }
}

async function detectDataMode() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error("FUSION_RESPONSE_ERROR");
    const payload = await response.json();
    state.dataMode = payload.dataMode || state.dataMode;
    state.openaiConfigured = Boolean(payload.ai?.configured);
    state.aiModel = payload.ai?.model || state.aiModel;
    render();
  } catch {
    state.dataMode = "offline-demo";
  }
}

async function loadFusionData(options = {}) {
  state.fusionLoading = true;
  resetAiGuidance();
  try {
    const response = await fetch(`/api/data/fusion?flight=${encodeURIComponent(state.journey.flightId)}&at=${encodeURIComponent(state.journey.arrivalAt)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("FUSION_RESPONSE_ERROR");
    state.fusion = await response.json();
    state.signals = deriveJourneySignals(state.fusion, state.journey.arrivalAt);
    state.dataMode = state.fusion.overallMode === "live"
      ? "live-ready"
      : state.fusion.sourceSummary?.live > 0 ? "hybrid-demo" : "offline-demo";
    state.fusionLoading = false;
    render();
    if (options.announceResult) {
      announce(`${state.journey.flightId} 여정을 다시 계산했습니다. 핵심 입력 ${state.signals.liveInputCount}개가 실시간입니다.`);
    }
  } catch {
    state.fusion = null;
    state.signals = null;
    state.fusionLoading = false;
    render();
  }
}

window.addEventListener("hashchange", () => {
  const next = window.location.hash.replace("#", "");
  if (navigation.some((item) => item.id === next) && next !== state.activeView) {
    state.activeView = next;
    render({ focusSelector: "#view-title" });
  }
});

render();
detectDataMode();
loadFusionData();
loadValidationStatus();
