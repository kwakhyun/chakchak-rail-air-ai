import { createJourneyViews } from "./views/journey.js";
import { createRoutesViews } from "./views/routes.js";
import { createTravelViews } from "./views/travel.js";
import { createValidationViews } from "./views/validation.js";
import { createJourneyModel } from "./journey-model.js";
import { plannedTravelItems } from "./travel-itinerary.js";
import { captureUiState, restoreUiState } from "./ui-state.js";
import { createLatestRequest } from "./api-client.js";
const fusionRequests = createLatestRequest();
const guidanceRequests = createLatestRequest();
import { demoTrip, disruptionPresets, sourceCatalog } from "./data.js";
import { P2_VALIDATION_PROTOCOL } from "./real-world-validation.js";
import {
  clearConfirmedJourney,
  createConfirmedJourney,
  loadConfirmedJourney,
  saveConfirmedJourney,
} from "./journey-decision.js";
import {
  deriveJourneySignals,
  withExampleFlight,
  fromDateTimeLocalValue,
  nextDayArrival,
  toDateTimeLocalValue
} from "./live-journey.js";
import { TICKET_TYPES } from "./ticket-protection.js";

const app = document.querySelector("#app");
if (!(app instanceof HTMLElement)) {
  throw new Error("CHAK² app root is missing.");
}

const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul"
});
const compactScreenQuery = window.matchMedia("(max-width: 720px)");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

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
const initialArrival = nextDayArrival("17:05");
const initialJourney = {
  flightId: demoTrip.flight.flightId,
  useExampleFlight: new URLSearchParams(window.location.search).get("mode") !== "live",
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
    src: "/assets/illustrations/rail-air-journey-3d.webp",
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
  activeDialog: null,
  validationStatus: null,
  pilotStatus: null,
  validationLoading: true,
  validationBusy: false,
  validationError: null,
  validationSession: loadStoredValidationSession(),
  activeView: navigation.some((item) => item.id === hashView) ? hashView : "journey"
};

const { getViewModel, buildChakchakInput } = createJourneyModel(state);

const viewContext = {
  get ICONS() { return ICONS; },
  get P2_VALIDATION_PROTOCOL() { return P2_VALIDATION_PROTOCOL; },
  get aiGuideCard() { return aiGuideCard; },
  get compactDisclosure() { return compactDisclosure; },
  get confirmedJourneyBanner() { return confirmedJourneyBanner; },
  get dataModeLabel() { return dataModeLabel; },
  get decisionProfileFor() { return decisionProfileFor; },
  get demoTrip() { return demoTrip; },
  get displayedProbability() { return displayedProbability; },
  get displayedRiskLevel() { return displayedRiskLevel; },
  get escapeHtml() { return escapeHtml; },
  get formatPercent() { return formatPercent; },
  get journeyDateLabel() {
    return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" }).format(new Date(state.journey.arrivalAt));
  },
  get formatTime() { return formatTime; },
  get formatTimeAfterMinutes() { return formatTimeAfterMinutes; },
  get impactCards() { return impactCards; },
  get isCompactScreen() { return isCompactScreen; },
  get journeySceneCatalog() { return journeySceneCatalog; },
  get modelPredictionFor() { return modelPredictionFor; },
  get plannedTravelItems() { return plannedTravelItems; },
  get predictionSourceLabel() { return predictionSourceLabel; },
  get probabilitySentence() { return probabilitySentence; },
  get riskLabel() { return riskLabel; },
  get riskTone() { return riskTone; },
  get scenarioButtons() { return scenarioButtons; },
  get signalModeLabel() { return signalModeLabel; },
  get sourceItems() { return sourceItems; },
  get state() { return state; },
  get travelVisualAssets() { return travelVisualAssets; },
};
const { liveSignalBoard, chakchakModelPanel, routeSteps, journeyTimeline, mobileNowCard, journeyView } = createJourneyViews(viewContext);
const { reconciliationPanel, recommendationDetails, ticketProtectionPanel, ticketProtectionDialog, alternativeRouteOption, routeOption, decisionGraphic, journeySceneForDestination, previewDelayLabel, mobileRouteBoard, aiCommandCenter, routesView } = createRoutesViews(viewContext);
const { travelCategory, travelItemsFor, travelGapLabel, travelHero, travelReplanStrip, travelPlaceCard, travelPlanSection, travelView } = createTravelViews(viewContext);
const { validationView, aboutView } = createValidationViews(viewContext);

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
  const arrivalDate = new Date(state.journey.arrivalAt).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const valueDate = new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  return `${valueDate > arrivalDate ? "다음 날 " : ""}${timeFormatter.format(new Date(value))}`;
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
  return compactScreenQuery.matches;
}

function dataModeLabel() {
  if (state.journey.useExampleFlight) return "예시 항공편과 열차 시간표";
  if (state.fusion?.sourceSummary) {
    const { live = 0, fallback = 0 } = state.fusion.sourceSummary;
    return fallback > 0 ? `${live}개 최신 정보 · ${fallback}개 자동 보완` : `${live}개 최신 정보 연결`;
  }
  if (state.dataMode === "live-ready") return "공공데이터 연결됨";
  if (state.dataMode === "hybrid-demo") return "최신 정보 · 자동 보완";
  return "체험용 정보";
}

function headerDataModeLabel() {
  if (state.journey.useExampleFlight) return "예시 여정 체험";
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
  if (probability >= 95) return "탑승 가능성이 매우 높아요";
  if (probability >= 90) return "탑승 가능성이 높아요";
  if (probability >= 85) return "착착 안전 기준을 넘겼어요";
  if (probability >= 70) return "탑승 시간을 더 확인해 주세요";
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
  return mode === "live" ? "최신 정보" : mode === "example" ? "예시 항공편" : "조회 불가 · 체험 입력";
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

function sourceItems() {
  if (!state.journey.useExampleFlight && state.fusion?.sources?.length) {
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
    { icon: ICONS.promisePrivacy, tone: "private", value: "꼭 필요한 정보만 써요", label: "이름과 예약번호 없이 이동 조건만 사용해요", footnote: "현장 기록은 직접 확인하고 언제든 지울 수 있어요" },
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
  const open = "";
  return `
    <details class="mobile-disclosure ${className}"${open}>
      <summary>
        <span class="mobile-disclosure-title"><img src="${icon}" alt="" aria-hidden="true" /><span><strong>${title}</strong><small>${description}</small></span></span>
        <span class="mobile-disclosure-badge">${badge}</span>
      </summary>
      <div class="mobile-disclosure-content">${content}</div>
    </details>`;
}

function unavailableJourneyView(view) {
  const trains = view.railPlan.timetable || [];
  if (trains.length) return `
    <section class="view-heading" aria-labelledby="view-title"><div><span class="eyebrow">${viewContext.journeyDateLabel} 출발</span><h1 id="view-title" tabindex="-1">서울에서 ${escapeHtml(state.journey.destination)}까지 열차 시간표</h1><p>서울역 출발 기준입니다. 공항에서 서울역까지의 이동은 별도로 확인해 주세요.</p></div></section>
    <section class="panel unavailable-journey"><h2>원하는 열차에 맞춰 이동을 준비하세요</h2><p>입력한 항공편과 바로 연결되는 추천편은 없어, 선택한 날짜의 열차 시간표를 먼저 보여드려요.</p><div class="hero-actions"><button class="button button-primary" id="open-journey-setup" type="button">항공편·여행조건 바꾸기</button><a class="button button-soft" href="https://www.letskorail.com/" target="_blank" rel="noreferrer">코레일에서 좌석 확인</a></div></section>
    <section class="timetable-list" aria-label="선택한 날짜의 열차 시간표">${trains.map(train => `
      <article class="panel timetable-card"><div><span class="tag">${train.source === "official" ? "공식 시간표" : "체험 시간표 · 실제 운행 확인 필요"}</span><h2>${escapeHtml(train.service)}</h2></div><div class="option-line"><span>서울역 ${formatTime(train.departure)}</span><i aria-hidden="true"></i><span>${escapeHtml(state.journey.destination)}역 ${formatTime(train.arrival)}</span></div><p>${train.fareKnown === false ? "운임은 코레일에서 확인해 주세요." : `${train.price.toLocaleString("ko-KR")}원부터 · 좌석 확인 필요`}</p></article>`).join("")}</section>`;
  return `<section class="view-heading"><span class="eyebrow">연결 여정 확인</span><h1 id="view-title" tabindex="-1">연결 가능한 열차를 찾지 못했어요</h1><p>${escapeHtml(view.railPlan.sourceLabel)}</p></section>
    <section class="panel unavailable-journey" role="status"><h2>당일 이동 계획을 다시 확인해 주세요</h2><p>도착 이후 탑승과 환승 조건을 만족하는 열차가 없습니다. 다음 날 이동이나 다른 교통편을 공식 채널에서 확인해 주세요.</p>
    <div class="hero-actions"><button class="button button-primary" id="open-journey-setup" type="button">항공편·여행조건 바꾸기</button><a class="button button-soft" href="https://www.letskorail.com/" target="_blank" rel="noreferrer">공식 시간표 확인</a></div></section>`;
}

function activeContent(view) {
  if (view.noSafeCandidate && ["journey", "routes"].includes(state.activeView)) return unavailableJourneyView(view);
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
  const guideDisabled = isLoading || isJourneyLoading || view.noSafeCandidate;
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
          ${view.noSafeCandidate ? `<p class="ai-guide-loading-note">연결 가능한 여정을 먼저 확인해 주세요.</p>` : ""}
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
  const uiSnapshot = captureUiState(app);
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
        <p id="journey-setup-description">이름이나 예약번호 없이 필요한 이동 조건만 사용합니다.</p>
        <div class="setup-grid">
          <label><span>도착 항공편</span><input id="journey-flight" name="flight" value="${escapeHtml(state.journey.flightId)}" maxlength="8" pattern="[A-Za-z0-9]{2,8}" autocomplete="off" required /></label>
          <label><span>도착 예정</span><input id="journey-arrival" name="arrival" type="datetime-local" value="${toDateTimeLocalValue(state.journey.arrivalAt)}" required /></label>
          <label><span>지역 목적지</span><select id="journey-destination" name="destination"><option value="전주" selected>전주 · 현재 이용 가능</option><option disabled>부산 · 지원 준비 중</option><option disabled>강릉 · 지원 준비 중</option></select></label>
          <label><span>위탁수하물</span><select id="journey-bags" name="bags"><option value="0" ${state.journey.checkedBags === 0 ? "selected" : ""}>없음</option><option value="1" ${state.journey.checkedBags === 1 ? "selected" : ""}>1개</option><option value="2" ${state.journey.checkedBags >= 2 ? "selected" : ""}>2개 이상</option></select></label>
        </div>
        <label class="setup-hint"><input id="journey-live-flight" type="checkbox" ${state.journey.useExampleFlight ? "" : "checked"} /> 실제 항공편과 시간표 조회</label>
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

    ${view.noSafeCandidate ? "" : `    <dialog id="recovery-dialog" aria-labelledby="recovery-title" aria-describedby="recovery-description">
      <div class="dialog-body">
        <span class="dialog-kicker">더 안전한 열차를 찾았어요</span>
        <h2 id="recovery-title">대체 일정과 승차권 처리 순서를 확인하세요</h2>
        <p id="recovery-description">${view.isDisrupted ? view.preset.note : "지금 공항 상황과 짐·이동 조건"}을 살펴보니, 지금 열차를 탑승 가능성은 ${formatPercent(displayedProbability(view, view.primary))}예요. 더 여유 있는 열차와 ${escapeHtml(state.journey.destination)} 일정까지 함께 준비했습니다.</p>
        <div class="recovery-compare">
          <div class="recovery-card"><span>지금 일정</span><strong>${formatTime(view.railPlan.airportRail[0].departure)} · ${view.railPlan.trains[0].service}</strong><small>${formatPercent(displayedProbability(view, view.primary))} 가능</small></div>
          <span class="recovery-arrow" aria-hidden="true">다음</span>
          <div class="recovery-card is-new"><span>추천 일정</span><strong>${formatTime(recoveryArex.departure)} · ${recoveryKtx.service}</strong><small>${formatPercent(displayedProbability(view, view.recovery))} 가능</small></div>
        </div>
        ${ticketProtectionDialog(view)}
        <div class="dialog-actions"><button class="button button-soft" id="close-recovery" type="button">지금 일정 유지</button><button class="button button-primary" id="apply-recovery" type="button">대체 일정 후보 저장</button></div>
      </div>
    </dialog>
`}
    <div class="toast-region" id="toast-region" aria-live="polite" aria-atomic="true"></div>`;

  bindEvents(view);
  const activeDialog = state.activeDialog === "recovery"
    ? document.querySelector("#recovery-dialog")
    : state.activeDialog === "journey-setup"
      ? document.querySelector("#journey-setup-dialog")
      : null;
  if (activeDialog && !activeDialog.open) activeDialog.showModal();
  restoreUiState(app, uiSnapshot);
  if (options.focusSelector && !activeDialog) {
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
    details.scrollIntoView({ behavior: reducedMotionQuery.matches ? "auto" : "smooth", block: "start" });
  });
  document.querySelectorAll("[data-open-recovery]").forEach((button) => button.addEventListener("click", openRecovery));
  document.querySelector("#close-recovery")?.addEventListener("click", closeRecovery);
  document.querySelector("#open-journey-setup")?.addEventListener("click", openJourneySetup);
  document.querySelector("#open-ticket-setup")?.addEventListener("click", () => {
    openJourneySetup();
    window.requestAnimationFrame(() => document.querySelector("#journey-has-ticket")?.focus());
  });
  document.querySelector("#close-journey-setup")?.addEventListener("click", closeJourneySetup);
  document.querySelector("#recovery-dialog")?.addEventListener("close", () => {
    if (state.activeDialog === "recovery") state.activeDialog = null;
  });
  document.querySelector("#journey-setup-dialog")?.addEventListener("close", () => {
    if (state.activeDialog === "journey-setup") state.activeDialog = null;
  });
  document.querySelector("#journey-has-ticket")?.addEventListener("change", (event) => {
    const details = document.querySelector("#ticket-setup-details");
    if (details) details.hidden = !event.target.checked;
  });
  document.querySelector("#journey-setup-form")?.addEventListener("submit", applyJourneySetup);
  document.querySelector("#apply-recovery")?.addEventListener("click", () => {
    if (getViewModel().noSafeCandidate) return;
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
    announce(`대체 일정 후보를 저장했어요. 좌석과 기존 표를 공식 채널에서 직접 확인해 주세요. 탑승 가능성은 ${Math.round(displayedProbability(view, view.recovery))}퍼센트예요.`);
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
    behavior: isCompactScreen() || reducedMotionQuery.matches ? "auto" : "smooth"
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
  announce(`${view.preset.label}. 이 열차를 탑승 가능성은 ${Math.round(displayedProbability(view, view.primary))}퍼센트예요.`);
}

function setPreviewDelay(minutes) {
  const nextDelay = Math.round(Math.max(0, Math.min(90, Number(minutes) || 0)) / 5) * 5;
  state.previewDelayMinutes = nextDelay;
  state.customDelayActive = true;
  clearConfirmedSelection();
  resetAiGuidance();
  render({ focusSelector: "#journey-time-scrubber" });
  const view = getViewModel();
  announce(`${previewDelayLabel(nextDelay)}으로 살펴봤어요. 추천 열차를 탑승 가능성은 ${Math.round(displayedProbability(view, view.recovery || view.primary))}퍼센트예요.`);
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
  guidanceRequests.cancel();
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
  if (view.noSafeCandidate) return;
  const request = guidanceRequests.start();
  state.aiLocale = document.querySelector("#ai-locale")?.value || state.aiLocale;
  state.aiStatus = "loading";
  state.aiGuidance = null;
  state.aiError = null;
  render({ focusSelector: "#request-ai" });

  try {
    const response = await fetch("/api/ai/concierge", {
      method: "POST",
      signal: request.signal,
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
    if (!request.isCurrent()) return;
    if (!response.ok || !payload.guidance) throw new Error(payload.error || "AI 안내를 불러오지 못했습니다.");
    state.aiStatus = "ready";
    state.aiMode = payload.mode;
    state.aiModel = payload.model || state.aiModel;
    state.aiGuidance = payload.guidance;
    render({ focusSelector: "#ai-result" });
    announce(payload.mode === "live" ? "맞춤 안내를 준비했어요." : "기본 안내를 준비했어요.");
  } catch (error) {
    if (!request.isCurrent()) return;
    state.aiStatus = "error";
    state.aiError = error instanceof Error ? error.message : "AI 안내를 불러오지 못했습니다.";
    render({ focusSelector: "#request-ai" });
  }
}

async function requestAiGuideAnswer(view, rawQuestion) {
  if (view.noSafeCandidate) { announce("연결 가능한 여정을 먼저 확인해 주세요."); return; }
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
  if (getViewModel().noSafeCandidate) return;
  state.activeDialog = "recovery";
  const dialog = document.querySelector("#recovery-dialog");
  if (dialog && !dialog.open) dialog.showModal();
}

function openJourneySetup() {
  state.activeDialog = "journey-setup";
  const dialog = document.querySelector("#journey-setup-dialog");
  if (dialog && !dialog.open) dialog.showModal();
}

function closeJourneySetup() {
  state.activeDialog = null;
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

  state.journey = {
    ...state.journey,
    flightId,
    useExampleFlight: flightId === demoTrip.flight.flightId && !document.querySelector("#journey-live-flight")?.checked,
    arrivalAt: fromDateTimeLocalValue(arrivalValue, state.journey.arrivalAt),
    destination: document.querySelector("#journey-destination")?.value || "전주",
    checkedBags: Number(document.querySelector("#journey-bags")?.value || 0),
    mobility: document.querySelector("#journey-mobility")?.checked ? "assisted" : "standard",
    largeLuggage: Boolean(document.querySelector("#journey-large-luggage")?.checked),
    ticket: {
      hasBookedTicket,
      korail: hasKorailTicket,
      arex: hasArexTicket,
      ticketType: document.querySelector("#journey-ticket-type")?.value || "standard",
      arexType: document.querySelector("#journey-arex-type")?.value || "direct"
    }
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
  state.activeDialog = null;
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
  if (view.noSafeCandidate) { announce("연결 가능한 여정을 먼저 확인해 주세요."); return; }
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
    if (options.render !== false && state.activeView === "validation") render();
  }
}

async function detectDataMode(options = {}) {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) throw new Error("FUSION_RESPONSE_ERROR");
    const payload = await response.json();
    if (!state.fusion) state.dataMode = payload.dataMode || state.dataMode;
    state.openaiConfigured = Boolean(payload.ai?.configured);
    state.aiModel = payload.ai?.model || state.aiModel;
    if (options.render !== false) render();
  } catch {
    state.dataMode = "offline-demo";
  }
}

async function loadFusionData(options = {}) {
  const request = fusionRequests.start();
  // A complete, deterministic example must not be replaced by unrelated live observations.
  if (state.journey.useExampleFlight) {
    state.fusion = withExampleFlight({ sources: [], sourceSummary: { live: 0, demo: 7 }, overallMode: "demo" }, state.journey.arrivalAt);
    state.signals = deriveJourneySignals(state.fusion, state.journey.arrivalAt);
    state.dataMode = "offline-demo";
    state.fusionLoading = false;
    if (options.render !== false) render();
    return;
  }
  const requestedArrival = state.journey.arrivalAt;
  state.fusionLoading = true;
  resetAiGuidance();
  try {
    const response = await fetch(`/api/data/fusion?flight=${encodeURIComponent(state.journey.flightId)}&at=${encodeURIComponent(requestedArrival)}`, { cache: "no-store", signal: request.signal });
    if (!response.ok) throw new Error("FUSION_RESPONSE_ERROR");
    const fusion = await response.json();
    if (!request.isCurrent()) return;
    state.fusion = state.journey.useExampleFlight ? withExampleFlight(fusion, requestedArrival) : fusion;
    state.signals = deriveJourneySignals(state.fusion, requestedArrival);
    state.dataMode = state.fusion.overallMode === "live"
      ? "live-ready"
      : state.fusion.sourceSummary?.live > 0 ? "hybrid-demo" : "offline-demo";
    state.fusionLoading = false;
    if (options.render !== false) render();
    if (options.announceResult) {
      announce(`${state.journey.flightId} 여정을 다시 계산했습니다. 핵심 입력 ${state.signals.liveInputCount}개가 실시간입니다.`);
    }
  } catch {
    if (!request.isCurrent()) return;
    state.fusion = null;
    state.signals = null;
    state.dataMode = "offline-demo";
    state.fusionLoading = false;
    if (options.render !== false) render();
  }
}

window.addEventListener("hashchange", () => {
  const next = window.location.hash.replace("#", "");
  if (navigation.some((item) => item.id === next) && next !== state.activeView) {
    state.activeView = next;
    render({ focusSelector: "#view-title" });
  }
});

async function bootstrap() {
  render();
  const validationPromise = loadValidationStatus({ render: false });
  await Promise.all([
    detectDataMode({ render: false }),
    loadFusionData({ render: false })
  ]);
  render();
  await validationPromise;
  if (state.activeView === "validation") render();
}

bootstrap();

// Recheck elapsed departure times while the page stays open; drafts survive these renders.
window.setInterval(() => { if (!document.hidden) render(); }, 60_000);
window.setInterval(() => { if (!document.hidden && !state.fusionLoading) loadFusionData(); }, 300_000);
