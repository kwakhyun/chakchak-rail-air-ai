import { demoTrip } from "./data.js";

const KST_OFFSET = "+09:00";
const DAY_MS = 86_400_000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function datePart(value) {
  return /^\d{4}-\d{2}-\d{2}/.test(String(value || ""))
    ? String(value).slice(0, 10)
    : new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
}

function timePart(value, fallback = "17:05") {
  const match = String(value || "").match(/T(\d{2}:\d{2})/);
  return match?.[1] || fallback;
}

function clockParts(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 4) return null;
  const hour = Number(digits.slice(-4, -2));
  const minute = Number(digits.slice(-2));
  if (hour > 23 || minute > 59) return null;
  return { hour, minute, text: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

function combineDateAndClock(targetDateTime, clockValue) {
  const clock = clockParts(clockValue);
  if (!clock) return null;
  return `${datePart(targetDateTime)}T${clock.text}:00${KST_OFFSET}`;
}

function clockDifferenceMinutes(startValue, endValue) {
  const start = clockParts(startValue);
  const end = clockParts(endValue);
  if (!start || !end) return 0;
  let difference = end.hour * 60 + end.minute - (start.hour * 60 + start.minute);
  if (difference < -720) difference += 1440;
  if (difference > 720) difference -= 1440;
  return difference;
}

function compactDateTime(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 12) return null;
  const normalized = digits.length >= 14 ? digits.slice(0, 14) : `${digits.slice(0, 12)}00`;
  const iso = `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}T${normalized.slice(8, 10)}:${normalized.slice(10, 12)}:${normalized.slice(12, 14)}${KST_OFFSET}`;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

function source(fusion, id) {
  return fusion?.sources?.find((item) => item.id === id) || null;
}

function hasData(item) {
  if (!item || item.mode !== "live") return false;
  if (Array.isArray(item.data)) return item.data.length > 0;
  return Boolean(item.data);
}

function terminalLabel(value) {
  return ({ P01: "T1", P02: "탑승동", P03: "T2" })[value] || value || "T2";
}

function railDelayMinutes(rows) {
  const delays = (rows || [])
    .map((row) => {
      const planned = compactDateTime(row.plannedDeparture || row.plannedArrival);
      const actual = compactDateTime(row.actualDeparture || row.actualArrival);
      return planned !== null && actual !== null ? (actual - planned) / 60_000 : null;
    })
    .filter((value) => value !== null && Number.isFinite(value) && Math.abs(value) <= 60);
  if (!delays.length) return null;
  return Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length);
}

export function withExampleFlight(fusion, arrivalAt) {
  const clock = timePart(arrivalAt).replace(":", "");
  const sources = (fusion.sources || []).filter(item => item.id !== "incheon-flight");
  sources.unshift({ id: "incheon-flight", mode: "example", data: {
    flightId: demoTrip.flight.flightId, origin: demoTrip.flight.originCity,
    airline: "대한항공", scheduledTime: clock, estimatedTime: clock,
    terminal: "P03", gate: demoTrip.flight.gate, carousel: demoTrip.flight.carousel, status: "예시"
  } });
  const live = sources.filter(item => item.mode === "live").length;
  return { ...fusion, sources, overallMode: "hybrid", sourceSummary: { ...fusion.sourceSummary, live } };
}

export function deriveJourneySignals(fusion, fallbackArrival) {
  const flightSource = source(fusion, "incheon-flight");
  const immigrationSource = source(fusion, "incheon-immigration");
  const railSource = source(fusion, "airport-rail");
  const trainSource = source(fusion, "tago-train");
  const tourismSource = source(fusion, "tour-api");
  const weatherSource = source(fusion, "open-weather");

  const flight = hasData(flightSource) || flightSource?.mode === "example" ? flightSource.data : null;
  const immigrationRows = hasData(immigrationSource) ? immigrationSource.data : [];
  const railRows = hasData(railSource) ? railSource.data : [];
  const tourismPlaces = hasData(tourismSource) ? tourismSource.data : [];
  const weather = hasData(weatherSource) ? weatherSource.data : null;

  const scheduledArrival = flight
    ? combineDateAndClock(fallbackArrival, flight.scheduledTime) || fallbackArrival
    : fallbackArrival;
  const estimatedArrival = flight
    ? combineDateAndClock(fallbackArrival, flight.estimatedTime || flight.scheduledTime) || scheduledArrival
    : fallbackArrival;
  const flightDelayMinutes = flight
    ? Math.max(0, clockDifferenceMinutes(flight.scheduledTime, flight.estimatedTime || flight.scheduledTime))
    : 0;

  const immigrationTotal = immigrationRows.reduce(
    (sum, row) => sum + Number(row.koreanWaiting || 0) + Number(row.foreignWaiting || 0),
    0
  );
  const busiestHall = immigrationRows.reduce((best, row) => {
    const waiting = Number(row.koreanWaiting || 0) + Number(row.foreignWaiting || 0);
    return waiting > best.waiting ? { hall: row.hall || "-", waiting } : best;
  }, { hall: "-", waiting: 0 });
  const immigrationSeverity = immigrationRows.length
    ? clamp(immigrationTotal / Math.max(420, immigrationRows.length * 55), 0, 2)
    : 0;

  const precipitationProbability = Number(weather?.precipitationProbability || 0);
  const windSpeedKmh = Number(weather?.windSpeedKmh || 0);
  const weatherSeverity = weather
    ? clamp(precipitationProbability / 85 + Math.max(0, windSpeedKmh - 22) / 28, 0, 2)
    : 0;
  const averageRailDelayMinutes = railDelayMinutes(railRows);

  // These four sources are the operational signals shown in the journey radar.
  // Tourism content is fused separately for the regional itinerary and must not
  // be counted as an input to the connection-risk decision.
  const decisionSources = [flightSource, immigrationSource, railSource, weatherSource];
  const liveInputCount = decisionSources.filter(hasData).length;

  return {
    scheduledArrival,
    estimatedArrival,
    terminal: terminalLabel(flight?.terminal),
    gate: flight?.gate || "-",
    carousel: flight?.carousel || "-",
    origin: flight?.origin || "도쿄/나리타",
    airline: flight?.airline || "대한항공",
    flightDelayMinutes,
    immigrationTotal,
    busiestHall,
    immigrationSeverity,
    precipitationProbability,
    precipitationMm: Number(weather?.precipitationMm || 0),
    windSpeedKmh,
    weatherSeverity,
    averageRailDelayMinutes,
    railObservationCount: railRows.length,
    tourismPlaces,
    liveInputCount,
    inputSourceCount: decisionSources.length,
    ktxMode: hasData(trainSource) ? "live" : trainSource?.mode || "demo",
    inputModes: {
      flight: hasData(flightSource) ? "live" : flightSource?.mode || "demo",
      immigration: hasData(immigrationSource) ? "live" : immigrationSource?.mode || "demo",
      rail: hasData(railSource) ? "live" : railSource?.mode || "demo",
      weather: hasData(weatherSource) ? "live" : weatherSource?.mode || "demo",
      tourism: hasData(tourismSource) ? "live" : tourismSource?.mode || "demo"
    }
  };
}

function addDays(dateText, amount) {
  const instant = Date.parse(`${dateText}T00:00:00${KST_OFFSET}`) + amount * DAY_MS;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(instant));
}

function rebaseTime(templateValue, targetDate, baseDate) {
  const templateDate = datePart(templateValue);
  const dayOffset = Math.round(
    (Date.parse(`${templateDate}T00:00:00${KST_OFFSET}`) - Date.parse(`${baseDate}T00:00:00${KST_OFFSET}`)) / DAY_MS
  );
  return `${addDays(targetDate, dayOffset)}T${timePart(templateValue)}:00${KST_OFFSET}`;
}

export function rebaseRailPlan(trip, targetArrival) {
  const targetDate = datePart(targetArrival);
  const baseDate = datePart(trip.flight.scheduledArrival);
  return {
    airportRail: trip.rail.airportRail.map((item) => ({
      ...item,
      departure: rebaseTime(item.departure, targetDate, baseDate),
      arrival: rebaseTime(item.arrival, targetDate, baseDate)
    })),
    trains: trip.rail.trains.map((item) => ({
      ...item,
      departure: rebaseTime(item.departure, targetDate, baseDate),
      arrival: rebaseTime(item.arrival, targetDate, baseDate)
    }))
  };
}

export function todayArrival(hourMinute = "17:05", now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  return `${date}T${hourMinute}:00${KST_OFFSET}`;
}

// Advance from the Korean calendar date, independently of the browser timezone.
export function nextDayArrival(hourMinute = "17:05", now = new Date()) {
  return todayArrival(hourMinute, new Date(now.getTime() + DAY_MS));
}

export function toDateTimeLocalValue(value) {
  return `${datePart(value)}T${timePart(value)}`;
}

export function fromDateTimeLocalValue(value, fallback) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ""))) return fallback;
  return `${value}:00${KST_OFFSET}`;
}
