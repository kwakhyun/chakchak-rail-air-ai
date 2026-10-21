export const MAX_JOURNEY_CANDIDATES = 12;
export const MAX_JOURNEY_ACTIVITIES = 4;
export const MAX_OPTIMIZATION_NODES = 1_000;
export const MAX_OPTIMIZATION_MS = 200;

export function assertJourneyWorkload(candidates, activities = []) {
  if (!Array.isArray(candidates) || candidates.length > MAX_JOURNEY_CANDIDATES
    || !Array.isArray(activities) || activities.length > MAX_JOURNEY_ACTIVITIES) {
    throw new RangeError("TOO_MANY_CANDIDATES_OR_ACTIVITIES");
  }
}
