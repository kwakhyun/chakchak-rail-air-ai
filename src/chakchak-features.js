export const CHAKCHAK_FEATURES = Object.freeze([
  { id: "flightDelayMinutes", label: "항공 도착 지연", unit: "분", group: "flight", min: 0, max: 240 },
  { id: "weatherSeverity", label: "공항 날씨", unit: "단계", group: "weather", min: 0, max: 2 },
  { id: "immigrationSeverity", label: "입국장 혼잡", unit: "단계", group: "immigration", min: 0, max: 2 },
  { id: "baggageDelayMinutes", label: "수하물 추가 지연", unit: "분", group: "baggage", min: 0, max: 90 },
  { id: "checkedBaggage", label: "위탁수하물", unit: "여부", group: "baggage", min: 0, max: 1 },
  { id: "accessibilityNeeds", label: "이동 지원", unit: "여부", group: "mobility", min: 0, max: 1 },
  { id: "largeLuggage", label: "큰 짐", unit: "여부", group: "mobility", min: 0, max: 1 },
  { id: "terminalT2", label: "제2여객터미널", unit: "여부", group: "airport", min: 0, max: 1 },
  { id: "arrivalHourLocal", label: "도착 시간대", unit: "시", group: "airport", min: 0, max: 23.999 },
  { id: "arrivalHourSin", label: "도착 시간 주기(사인)", unit: "주기값", group: "airport", min: -1, max: 1 },
  { id: "arrivalHourCos", label: "도착 시간 주기(코사인)", unit: "주기값", group: "airport", min: -1, max: 1 },
  { id: "timePeakSeverity", label: "시간대 혼잡", unit: "단계", group: "airport", min: 0, max: 1 },
  { id: "connectionWindowMinutes", label: "열차까지 남은 시간", unit: "분", group: "schedule", min: 35, max: 360 },
  { id: "boardingBufferMinutes", label: "승차 안전 여유", unit: "분", group: "schedule", min: 0, max: 30 },
  { id: "weatherFlightInteraction", label: "기상·항공지연 결합", unit: "결합값", group: "flight", min: 0, max: 480 },
  { id: "immigrationBaggageInteraction", label: "입국·수하물 결합", unit: "결합값", group: "immigration", min: 0, max: 2 },
  { id: "mobilityLuggageInteraction", label: "이동지원·큰 짐 결합", unit: "결합값", group: "mobility", min: 0, max: 1 },
  { id: "expectedProcessMinutes", label: "공항 이동 누적부하", unit: "분", group: "process", min: 40, max: 520 },
  { id: "uncertaintyMinutes", label: "공항 이동 불확실성", unit: "분", group: "process", min: 0, max: 160 },
  { id: "processLoadSquared", label: "누적부하 비선형값", unit: "지수", group: "process", min: 0, max: 30 },
  { id: "scheduleMarginMinutes", label: "예상 이동 후 여유", unit: "분", group: "schedule", min: -480, max: 320 },
  { id: "conservativeMarginMinutes", label: "불확실성 반영 여유", unit: "분", group: "schedule", min: -680, max: 320 }
]);

export const CHAKCHAK_TRAINING_ENVELOPE = Object.freeze({
  version: "chakchak-simulator-2026-08-v3-terminal-time-envelope",
  flightDelayMinutes: Object.freeze({ min: 0, max: 240, label: "항공 도착 지연", unit: "분" }),
  weatherSeverity: Object.freeze({ min: 0, max: 2, label: "공항 날씨", unit: "단계" }),
  immigrationSeverity: Object.freeze({ min: 0, max: 2, label: "입국장 혼잡", unit: "단계" }),
  baggageDelayMinutes: Object.freeze({ min: 0, max: 90, label: "수하물 추가 지연", unit: "분" }),
  arrivalHourLocal: Object.freeze({ min: 0, max: 23.999, label: "도착 시간대", unit: "시" }),
  connectionWindowMinutes: Object.freeze({ min: 35, max: 360, label: "열차까지 남은 시간", unit: "분" }),
  boardingBufferMinutes: Object.freeze({ min: 0, max: 30, label: "승차 안전 여유", unit: "분" })
});

export const CHAKCHAK_TIME_FEATURE_IDS = Object.freeze(
  CHAKCHAK_FEATURES.filter((feature) => !["connectionWindowMinutes", "boardingBufferMinutes", "scheduleMarginMinutes", "conservativeMarginMinutes"].includes(feature.id))
    .map((feature) => feature.id)
);

export const CHAKCHAK_PROBABILITY_FEATURE_IDS = Object.freeze(CHAKCHAK_FEATURES.map((feature) => feature.id));

const featureById = new Map(CHAKCHAK_FEATURES.map((feature) => [feature.id, feature]));

export function buildChakchakFeatureVector(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("착착 AI 입력은 객체여야 합니다.");
  }

  const flightDelayMinutes = bounded(input.flightDelayMinutes, "flightDelayMinutes");
  const weatherSeverity = bounded(input.weatherSeverity, "weatherSeverity");
  const immigrationSeverity = bounded(input.immigrationSeverity, "immigrationSeverity");
  const baggageDelayMinutes = bounded(input.baggageDelayMinutes, "baggageDelayMinutes");
  const checkedBaggage = booleanNumber(input.checkedBaggage);
  const accessibilityNeeds = booleanNumber(input.accessibilityNeeds);
  const largeLuggage = booleanNumber(input.largeLuggage);
  const terminalT2 = normalizeTerminal(input.terminal) === "T2" ? 1 : 0;
  const arrivalHourLocal = bounded(input.arrivalHourLocal ?? 17, "arrivalHourLocal");
  const arrivalAngle = arrivalHourLocal / 24 * Math.PI * 2;
  const timePeakSeverity = peakSeverity(arrivalHourLocal);
  const connectionWindowMinutes = bounded(input.connectionWindowMinutes, "connectionWindowMinutes");
  const boardingBufferMinutes = bounded(input.boardingBufferMinutes ?? 5, "boardingBufferMinutes");
  const expectedProcessMinutes =
    flightDelayMinutes + weatherSeverity * 9 +
    14 + accessibilityNeeds * 7 + largeLuggage * 2 + timePeakSeverity * 2 +
    22 + immigrationSeverity * 23 + weatherSeverity * 2 + timePeakSeverity * 8 +
    (checkedBaggage ? 18 + baggageDelayMinutes + largeLuggage * 7 + weatherSeverity * 3 : 0) +
    11 + weatherSeverity * 3 + accessibilityNeeds * 8 + largeLuggage * 5 + terminalT2 * 4 + timePeakSeverity * 2 +
    7 + weatherSeverity * 2 + accessibilityNeeds * 5 + largeLuggage * 3 + terminalT2 * 2;
  const flightStandardDeviation = 7 + weatherSeverity * 7 + Math.min(flightDelayMinutes * 0.12, 15);
  const deplaningMean = 14 + accessibilityNeeds * 7 + largeLuggage * 2 + timePeakSeverity * 2;
  const immigrationMean = 22 + immigrationSeverity * 23 + weatherSeverity * 2 + timePeakSeverity * 8;
  const baggageMean = checkedBaggage ? 18 + baggageDelayMinutes + largeLuggage * 7 + weatherSeverity * 3 : 0;
  const movementMean = 11 + weatherSeverity * 3 + accessibilityNeeds * 8 + largeLuggage * 5 + terminalT2 * 4 + timePeakSeverity * 2;
  const platformMean = 7 + weatherSeverity * 2 + accessibilityNeeds * 5 + largeLuggage * 3 + terminalT2 * 2;
  const uncertaintyMinutes = Math.sqrt(
    flightStandardDeviation ** 2 +
    (deplaningMean * 0.3) ** 2 +
    (immigrationMean * 0.48) ** 2 +
    (baggageMean * 0.46) ** 2 +
    (movementMean * 0.3) ** 2 +
    (platformMean * 0.28) ** 2
  );

  return {
    flightDelayMinutes,
    weatherSeverity,
    immigrationSeverity,
    baggageDelayMinutes,
    checkedBaggage,
    accessibilityNeeds,
    largeLuggage,
    terminalT2,
    arrivalHourLocal,
    arrivalHourSin: Math.sin(arrivalAngle),
    arrivalHourCos: Math.cos(arrivalAngle),
    timePeakSeverity,
    connectionWindowMinutes,
    boardingBufferMinutes,
    weatherFlightInteraction: weatherSeverity * flightDelayMinutes,
    immigrationBaggageInteraction: immigrationSeverity * checkedBaggage,
    mobilityLuggageInteraction: accessibilityNeeds * largeLuggage,
    expectedProcessMinutes,
    uncertaintyMinutes,
    processLoadSquared: expectedProcessMinutes ** 2 / 10_000,
    scheduleMarginMinutes: connectionWindowMinutes - boardingBufferMinutes - expectedProcessMinutes,
    conservativeMarginMinutes: connectionWindowMinutes - boardingBufferMinutes - expectedProcessMinutes - 1.2816 * uncertaintyMinutes
  };
}

export function assessChakchakInputCoverage(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("착착 AI 입력은 객체여야 합니다.");
  }

  const reasons = [];
  let maximumDistance = 0;
  for (const [id, envelope] of Object.entries(CHAKCHAK_TRAINING_ENVELOPE)) {
    if (!envelope || typeof envelope !== "object") continue;
    const fallbackValue = id === "boardingBufferMinutes" ? 5 : envelope.min;
    const value = Number(input[id] ?? fallbackValue);
    if (!Number.isFinite(value)) continue;
    if (value >= envelope.min && value <= envelope.max) continue;
    const range = Math.max(1, envelope.max - envelope.min);
    const distance = value < envelope.min
      ? (envelope.min - value) / range
      : (value - envelope.max) / range;
    maximumDistance = Math.max(maximumDistance, distance);
    reasons.push({
      feature: id,
      label: envelope.label,
      value: round(value, 2),
      unit: envelope.unit,
      trainedRange: [envelope.min, envelope.max],
      message: `${envelope.label} ${round(value, 1)}${envelope.unit}은 학습 확인 범위 ${envelope.min}~${envelope.max}${envelope.unit} 밖입니다.`
    });
  }

  const score = round(Math.min(1, maximumDistance), 3);
  return {
    envelopeVersion: CHAKCHAK_TRAINING_ENVELOPE.version,
    isOutOfDistribution: reasons.length > 0,
    fallbackRequired: reasons.length > 0,
    score,
    severity: reasons.length === 0 ? "IN_RANGE" : score > 0.25 ? "FAR_OUTSIDE" : "OUTSIDE",
    reasons
  };
}

export function chakchakFeatureDefinition(id) {
  return featureById.get(id) || { id, label: id, unit: "", group: "other" };
}

function bounded(value, id) {
  const definition = featureById.get(id);
  const number = Number(value ?? definition?.min ?? 0);
  if (!Number.isFinite(number)) throw new TypeError(`${id} 값이 숫자가 아닙니다.`);
  return Math.min(definition.max, Math.max(definition.min, number));
}

function booleanNumber(value) {
  return value === true || value === 1 || value === "1" ? 1 : 0;
}

function normalizeTerminal(value) {
  const terminal = String(value || "T1").trim().toUpperCase();
  return terminal === "T1" || terminal === "1" || terminal === "P01" ? "T1" : "T2";
}

function peakSeverity(hour) {
  if (hour >= 6 && hour < 9.5) return 0.7;
  if (hour >= 15.5 && hour < 20.5) return 1;
  if (hour >= 22 || hour < 4.5) return 0.35;
  return 0.15;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
