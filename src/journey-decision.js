export const JOURNEY_DECISION_STORAGE_KEY = "chakchak-confirmed-journey-v1";

const SCHEMA_VERSION = "1.0";

export function createJourneyKey(journey) {
  return [
    journey?.flightId || "",
    journey?.arrivalAt || "",
    journey?.destination || "",
    Number(journey?.checkedBags || 0),
    journey?.mobility || "standard",
    Boolean(journey?.largeLuggage),
    Boolean(journey?.useExampleFlight)
  ].join("|");
}

export function createConfirmedJourney({
  journey,
  scenarioId,
  selectedArex,
  selectedKtx,
  originalArex,
  originalKtx,
  probabilityPercent,
  now = () => new Date()
}) {
  if (!selectedArex?.id || !selectedKtx?.id) {
    throw new TypeError("선택한 열차 정보가 필요합니다.");
  }

  const confirmedAt = now().toISOString();
  const decisionId = globalThis.crypto?.randomUUID?.() || `decision-${confirmedAt}`;
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    decisionId,
    journeyKey: createJourneyKey(journey),
    scenarioId: scenarioId || "normal",
    selectedArexId: selectedArex.id,
    selectedKtxId: selectedKtx.id,
    originalArexId: originalArex?.id || null,
    originalKtxId: originalKtx?.id || null,
    probabilityPercent: Math.max(0, Math.min(100, Math.round(Number(probabilityPercent) || 0))),
    tourismPlanVersion: "arrival-aware-v1",
    confirmedAt
  });
}

export function isConfirmedJourney(value, journey) {
  return Boolean(
    value &&
    value.schemaVersion === SCHEMA_VERSION &&
    typeof value.decisionId === "string" &&
    value.journeyKey === createJourneyKey(journey) &&
    typeof value.scenarioId === "string" &&
    typeof value.selectedArexId === "string" &&
    typeof value.selectedKtxId === "string" &&
    typeof value.confirmedAt === "string"
  );
}

export function loadConfirmedJourney(storage, journey) {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(JOURNEY_DECISION_STORAGE_KEY) || "null");
    if (isConfirmedJourney(parsed, journey)) return Object.freeze(parsed);
    storage.removeItem(JOURNEY_DECISION_STORAGE_KEY);
  } catch {
    try {
      storage.removeItem(JOURNEY_DECISION_STORAGE_KEY);
    } catch {
      // 저장소가 제한된 환경에서는 현재 화면 상태만 사용합니다.
    }
  }
  return null;
}

export function saveConfirmedJourney(storage, snapshot) {
  if (!storage || !snapshot) return false;
  try {
    storage.setItem(JOURNEY_DECISION_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function clearConfirmedJourney(storage) {
  try {
    storage?.removeItem(JOURNEY_DECISION_STORAGE_KEY);
  } catch {
    // 저장소가 제한된 환경에서는 현재 화면 상태만 비웁니다.
  }
}

export function selectedCandidate(candidates, snapshot) {
  if (!snapshot || !Array.isArray(candidates)) return null;
  return candidates.find((candidate) => candidate.id === snapshot.selectedArexId) || null;
}
