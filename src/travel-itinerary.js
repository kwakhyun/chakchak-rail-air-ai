import { tourismPlan } from "./data.js";

const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });
const timeFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function buildTravelActivities(scheduledArrival, places = []) {
  const nextDate = dateFormatter.format(new Date(Date.parse(scheduledArrival) + 86_400_000));
  const live = places.length > 0;
  const selected = live ? places.slice(0, 3) : [tourismPlan.recovered[1], tourismPlan.original[1], tourismPlan.original[2]];
  return selected.map((place, index) => ({
    ...place,
    id: String(place.contentId || `place-${index}`),
    title: place.title,
    detail: place.address || "방문 전 위치와 영업시간을 확인해 주세요.",
    contentType: place.contentType || place.type,
    // When opening hours are absent, these are explicitly labelled planning assumptions.
    openingTime: place.openingTime || `${nextDate}T09:00:00+09:00`,
    closingTime: place.closingTime || `${nextDate}T18:00:00+09:00`,
    hoursVerified: Boolean(place.openingTime && place.closingTime),
    source: live ? "한국관광공사 장소 정보 · 이동시간은 예상" : "착착 체험 장소 · 이동시간은 예상",
    durationMinutes: 60,
    minimumDurationMinutes: 30,
    travelMinutes: 20,
    required: false
  }));
}

export function plannedTravelItems(view, scheduledArrival) {
  if (view.noSafeCandidate) return [];
  const plan = view.chakchakAi.optimization.candidates.find(c => c.id === view.activeCandidate.id);
  if (!plan?.feasible) return [];
  const date = dateFormatter.format(new Date(scheduledArrival));
  return plan.itinerary.items.map(item => {
    const activity = view.activities.find(a => a.id === item.id);
    const itemDate = dateFormatter.format(new Date(item.startTime));
    return { ...activity, ...item, time: timeFormatter.format(new Date(item.startTime)),
      day: itemDate === date ? "arrival" : "next", dayLabel: itemDate === date ? "도착한 날" : `${itemDate} 방문`,
      status: activity.hoursVerified ? "영업시간 반영" : "영업시간 확인 필요",
      changed: view.isRecovered,
      reason: activity.hoursVerified ? "열차 도착, 예상 이동시간과 영업시간을 반영했습니다." : "열차 도착 이후의 예상 일정입니다. 방문 전 영업시간과 이동시간을 확인해 주세요." };
  });
}
