const text = (value, length = 80) => String(value || "").slice(0, length);
const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));

/** Shared request contract for local Node and the deployment Worker. */
export function compactModelInput(body = {}) {
  const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
  const activities = Array.isArray(body?.activities) ? body.activities : [];
  if (candidates.length > 12 || activities.length > 8) throw new RangeError("TOO_MANY_CANDIDATES_OR_ACTIVITIES");
  return {
    scheduledArrival: text(body?.scheduledArrival, 40),
    context: pick(body?.context, ["flightDelayMinutes", "weatherSeverity", "immigrationSeverity", "baggageDelayMinutes", "checkedBaggage", "accessibilityNeeds", "largeLuggage", "boardingBufferMinutes", "terminal", "arrivalHourLocal", "flightMode", "immigrationMode", "weatherMode"]),
    candidates: candidates.map(candidate => ({
      ...pick(candidate, ["accessibilityReady", "price", "transferCount", "reservationAvailable"]),
      id: text(candidate?.id, 120),
      departureTime: text(candidate?.departureTime, 40),
      destinationArrivalTime: candidate?.destinationArrivalTime ? text(candidate.destinationArrivalTime, 40) : undefined
    })),
    preferences: pick(body?.preferences, ["maxPrice", "maxTransfers", "arrivalToFirstMinutes", "requireReservationAvailability"]),
    activities: activities.map(activity => ({
      ...pick(activity, ["durationMinutes", "minimumDurationMinutes", "travelMinutes", "required", "reservationToleranceMinutes"]),
      id: text(activity?.id), title: text(activity?.title),
      openingTime: text(activity?.openingTime, 40), closingTime: text(activity?.closingTime, 40),
      reservationTime: activity?.reservationTime ? text(activity.reservationTime, 40) : undefined
    }))
  };
}
