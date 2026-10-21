import { assertJourneyWorkload, MAX_OPTIMIZATION_NODES, MAX_OPTIMIZATION_MS } from "./computation-limits.js";
const MINUTE_MS = 60_000;

export const CHAKCHAK_CONSTRAINT_POLICY = Object.freeze({
  id: "chakchak-exact-journey-optimizer-v1",
  method: "bounded exact search with infeasible-prefix pruning",
  hardConstraints: Object.freeze([
    "BOARDING_SAFETY",
    "ACCESSIBILITY",
    "MAX_PRICE",
    "MAX_TRANSFERS",
    "RESERVATION_AVAILABILITY",
    "TOURISM_OPENING_HOURS"
  ]),
  objectiveOrder: Object.freeze([
    "KEEP_REQUIRED_PLANS",
    "KEEP_RESERVATIONS",
    "PRESERVE_STAY_MINUTES",
    "EARLIER_DESTINATION_ARRIVAL",
    "LOWER_PRICE",
    "FEWER_TRANSFERS"
  ])
});

export function optimizeConstrainedJourney({ candidates, preferences = {}, activities = [], now = () => performance.now() }) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError("제약 최적화 후보 여정이 필요합니다.");
  }
  assertJourneyWorkload(candidates, activities);
  const budget = { nodes: 0, now, deadline: now() + MAX_OPTIMIZATION_MS };

  const normalizedPreferences = {
    maxPrice: finiteOrInfinity(preferences.maxPrice),
    maxTransfers: finiteOrInfinity(preferences.maxTransfers),
    arrivalToFirstMinutes: finiteOr(preferences.arrivalToFirstMinutes, 20),
    requireReservationAvailability: Boolean(preferences.requireReservationAvailability)
  };
  const normalizedActivities = activities.map(normalizeActivity);
  const evaluated = candidates.map((candidate) => evaluateCandidate(candidate, normalizedPreferences, normalizedActivities, budget));
  const feasible = evaluated.filter((candidate) => candidate.feasible).sort(compareCandidatePlans);
  const selected = feasible[0] || evaluated.sort(compareFallbackCandidates)[0];

  return {
    schemaVersion: "1.0",
    search: { visitedNodes: budget.nodes, complete: true, maxNodes: MAX_OPTIMIZATION_NODES },
    policy: CHAKCHAK_CONSTRAINT_POLICY,
    feasible: feasible.length > 0,
    selectedCandidateId: selected.id,
    selectedPlan: selected,
    candidates: evaluated,
    rejected: evaluated.filter((candidate) => !candidate.feasible).map((candidate) => ({ id: candidate.id, reasons: candidate.rejectionReasons })),
    explanation: buildExplanation(selected, normalizedPreferences, normalizedActivities)
  };
}

function evaluateCandidate(candidate, preferences, activities, budget) {
  const profile = candidate.decisionProfile || {};
  const price = finiteOr(candidate.price, 0);
  const transferCount = finiteOr(candidate.transferCount, 1);
  const reservationAvailable = candidate.reservationAvailable;
  const rejectionReasons = [];
  if (!profile.eligible) rejectionReasons.push("BOARDING_SAFETY");
  if (profile.accessibility?.violation) rejectionReasons.push("ACCESSIBILITY");
  if (price > preferences.maxPrice) rejectionReasons.push("MAX_PRICE");
  if (transferCount > preferences.maxTransfers) rejectionReasons.push("MAX_TRANSFERS");
  if (reservationAvailable === false || (preferences.requireReservationAvailability && reservationAvailable !== true)) {
    rejectionReasons.push("RESERVATION_AVAILABILITY");
  }

  const itinerary = optimizeActivities(candidate.destinationArrivalTime, activities, preferences.arrivalToFirstMinutes, budget);
  if (!itinerary.feasible) rejectionReasons.push("TOURISM_OPENING_HOURS");
  const feasible = rejectionReasons.length === 0;
  const arrivalMs = parseDate(candidate.destinationArrivalTime, "candidate.destinationArrivalTime");
  const objective = {
    requiredPlansKept: itinerary.requiredPlansKept,
    reservationsKept: itinerary.reservationsKept,
    preservedStayMinutes: itinerary.preservedStayMinutes,
    destinationArrivalMs: arrivalMs,
    price,
    transferCount
  };
  return {
    id: String(candidate.id),
    feasible,
    rejectionReasons,
    destinationArrivalTime: new Date(arrivalMs).toISOString(),
    price,
    transferCount,
    reservationStatus: reservationAvailable === true ? "CONFIRMED" : reservationAvailable === false ? "UNAVAILABLE" : "OFFICIAL_CONFIRMATION_REQUIRED",
    safetyProbability: finiteOr(profile.conservativeProbability, 0),
    p90BufferMinutes: finiteOr(profile.p90BufferMinutes, -720),
    objective,
    itinerary
  };
}

function optimizeActivities(destinationArrivalTime, activities, arrivalToFirstMinutes, budget) {
  if (!activities.length) {
    return { feasible: true, items: [], requiredPlansKept: 0, reservationsKept: 0, preservedStayMinutes: 0, plannedStayMinutes: 0, preservationRate: 1 };
  }
  const arrivalMs = parseDate(destinationArrivalTime, "destinationArrivalTime") + arrivalToFirstMinutes * MINUTE_MS;
  const required = activities.filter((activity) => activity.required);
  let best = null;
  function visit(order, remaining) {
    budget.nodes += 1;
    if (budget.nodes > MAX_OPTIMIZATION_NODES || budget.now() > budget.deadline) {
      const error = new RangeError("OPTIMIZATION_BUDGET_EXCEEDED");
      error.status = error.statusCode = 503;
      throw error; // Never return a partial search as an optimal recommendation.
    }
    const plan = scheduleActivities(arrivalMs, order);
    if (!plan.feasible) return;
    if (required.every(activity => order.includes(activity)) && (!best || compareItineraries(plan, best) < 0)) best = plan;
    for (const activity of remaining) visit([...order, activity], remaining.filter(other => other !== activity));
  }
  visit([], activities);
  if (!best) {
    return { feasible: false, items: [], requiredPlansKept: 0, reservationsKept: 0, preservedStayMinutes: 0, plannedStayMinutes: sum(activities.map((item) => item.durationMinutes)), preservationRate: 0 };
  }
  return best;
}

function scheduleActivities(arrivalMs, activities) {
  let cursor = arrivalMs;
  const items = [];
  let requiredPlansKept = 0;
  let reservationsKept = 0;
  let preservedStayMinutes = 0;
  let plannedStayMinutes = 0;
  for (const activity of activities) {
    cursor += activity.travelMinutes * MINUTE_MS;
    const openingMs = parseDate(activity.openingTime, `activities.${activity.id}.openingTime`);
    const closingMs = parseDate(activity.closingTime, `activities.${activity.id}.closingTime`);
    let startMs = Math.max(cursor, openingMs);
    let reservationKept = false;
    if (activity.reservationTime) {
      const reservationMs = parseDate(activity.reservationTime, `activities.${activity.id}.reservationTime`);
      const earliestReservation = reservationMs - activity.reservationToleranceMinutes * MINUTE_MS;
      const latestReservation = reservationMs + activity.reservationToleranceMinutes * MINUTE_MS;
      startMs = Math.max(startMs, earliestReservation);
      if (startMs > latestReservation) return { feasible: false };
      reservationKept = true;
    }
    const availableMinutes = Math.floor((closingMs - startMs) / MINUTE_MS);
    const durationMinutes = Math.min(activity.durationMinutes, availableMinutes);
    if (durationMinutes < activity.minimumDurationMinutes) return { feasible: false };
    const endMs = startMs + durationMinutes * MINUTE_MS;
    items.push({
      id: activity.id,
      title: activity.title,
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      durationMinutes,
      plannedDurationMinutes: activity.durationMinutes,
      required: activity.required,
      reservationKept
    });
    cursor = endMs;
    requiredPlansKept += Number(activity.required);
    reservationsKept += Number(reservationKept);
    preservedStayMinutes += durationMinutes;
    plannedStayMinutes += activity.durationMinutes;
  }
  return {
    feasible: true,
    items,
    requiredPlansKept,
    reservationsKept,
    preservedStayMinutes,
    plannedStayMinutes,
    preservationRate: plannedStayMinutes ? round(preservedStayMinutes / plannedStayMinutes, 4) : 1,
    finishTime: items.at(-1)?.endTime || new Date(arrivalMs).toISOString()
  };
}

function normalizeActivity(activity, index) {
  if (!activity || typeof activity !== "object") throw new TypeError(`activities[${index}] 값이 필요합니다.`);
  return {
    id: String(activity.id || `activity-${index + 1}`),
    title: String(activity.title || `일정 ${index + 1}`),
    openingTime: activity.openingTime,
    closingTime: activity.closingTime,
    durationMinutes: positive(activity.durationMinutes, `activities[${index}].durationMinutes`),
    minimumDurationMinutes: positive(activity.minimumDurationMinutes ?? activity.durationMinutes, `activities[${index}].minimumDurationMinutes`),
    travelMinutes: Math.max(0, finiteOr(activity.travelMinutes, 0)),
    required: Boolean(activity.required),
    reservationTime: activity.reservationTime || null,
    reservationToleranceMinutes: Math.max(0, finiteOr(activity.reservationToleranceMinutes, 0))
  };
}

function compareCandidatePlans(left, right) {
  const leftObjective = left.objective;
  const rightObjective = right.objective;
  return (
    rightObjective.requiredPlansKept - leftObjective.requiredPlansKept ||
    rightObjective.reservationsKept - leftObjective.reservationsKept ||
    rightObjective.preservedStayMinutes - leftObjective.preservedStayMinutes ||
    leftObjective.destinationArrivalMs - rightObjective.destinationArrivalMs ||
    leftObjective.price - rightObjective.price ||
    leftObjective.transferCount - rightObjective.transferCount ||
    left.id.localeCompare(right.id)
  );
}

function compareFallbackCandidates(left, right) {
  return (
    left.rejectionReasons.length - right.rejectionReasons.length ||
    right.safetyProbability - left.safetyProbability ||
    right.p90BufferMinutes - left.p90BufferMinutes ||
    left.objective.destinationArrivalMs - right.objective.destinationArrivalMs
  );
}

function compareItineraries(left, right) {
  return (
    right.requiredPlansKept - left.requiredPlansKept ||
    right.reservationsKept - left.reservationsKept ||
    right.preservedStayMinutes - left.preservedStayMinutes ||
    Date.parse(left.finishTime) - Date.parse(right.finishTime)
  );
}

function buildExplanation(selected, preferences, activities) {
  if (!selected.feasible) {
    return {
      headline: "모든 조건을 만족하는 연결 여정을 찾지 못했습니다.",
      reasons: selected.rejectionReasons,
      officialConfirmationRequired: selected.reservationStatus === "OFFICIAL_CONFIRMATION_REQUIRED"
    };
  }
  const reasons = [
    `필수 일정 ${selected.objective.requiredPlansKept}개 유지`,
    `예약 일정 ${selected.objective.reservationsKept}개 유지`,
    `지역 체류 ${selected.objective.preservedStayMinutes}분 보존`,
    `환승 ${selected.transferCount}회`,
    `${selected.price.toLocaleString("ko-KR")}원 예상`
  ];
  if (preferences.maxPrice < Infinity) reasons.push(`예산 ${preferences.maxPrice.toLocaleString("ko-KR")}원 이내`);
  return {
    headline: activities.length ? "교통과 지역 일정을 함께 만족하는 여정을 골랐습니다." : "안전 조건을 만족하는 연결 여정을 골랐습니다.",
    reasons,
    officialConfirmationRequired: selected.reservationStatus === "OFFICIAL_CONFIRMATION_REQUIRED"
  };
}

function parseDate(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} 날짜가 올바르지 않습니다.`);
  return parsed;
}

function positive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${label} 값은 0보다 커야 합니다.`);
  return number;
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteOrInfinity(value) {
  return value == null ? Infinity : finiteOr(value, Infinity);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
