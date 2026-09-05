import { rebaseRailPlan } from "./live-journey.js";

const minute = 60_000;
const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });

export function railInstant(value) {
  const text = String(value || "");
  const iso = /^\d{14}$/.test(text)
    ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}+09:00`
    : text;
  return /^\d{4}-\d{2}-\d{2}T/.test(iso) && Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString() : null;
}

function station(value) { return String(value || "").replace(/\s|역/g, ""); }
function connectionId(arex, ktx) {
  return `C-${Date.parse(arex.departure).toString(36)}-${Date.parse(ktx.departure).toString(36)}-${String(ktx.service).replace(/\D/g, "").slice(0, 6)}`;
}
function validLeg(departure, arrival, date) {
  return departure && arrival && Date.parse(arrival) > Date.parse(departure)
    && dateFormatter.format(new Date(departure)) === date;
}

/** Pair identified airport departures with Seoul arrivals; ambiguous observations stay observations. */
function airportLegs(rows, terminal, date) {
  const origin = terminal === "T1" ? "인천공항1터미널" : "인천공항2터미널";
  return rows.flatMap((row) => {
    const rowOrigin = station(row.departureStation || row.stationName);
    if (rowOrigin !== origin) return [];
    const destination = station(row.arrivalStation);
    const arrivalRow = destination === "서울" ? row : rows.find(other => other.trainNo === row.trainNo && station(other.stationName) === "서울");
    if (!arrivalRow) return [];
    const departure = railInstant(row.actualDeparture || row.plannedDeparture);
    const arrival = railInstant(arrivalRow.actualArrival || arrivalRow.plannedArrival);
    if (!validLeg(departure, arrival, date)) return [];
    return [{ id: `AREX-${row.trainNo}-${Date.parse(departure)}`, service: row.service || "공항철도", departure, arrival, source: "official" }];
  });
}

export function buildRailPlan(trip, scheduledArrival, fusion, terminal = "T2", now = new Date()) {
  const date = dateFormatter.format(new Date(scheduledArrival));
  const template = rebaseRailPlan(trip, scheduledArrival);
  const airportSource = fusion?.sources?.find(s => s.id === "airport-rail");
  const ktxSource = fusion?.sources?.find(s => s.id === "tago-train");
  const observedAirport = airportSource?.mode === "live" ? airportLegs(airportSource.data || [], terminal, date) : [];
  const airport = observedAirport.length ? observedAirport : template.airportRail.map(t => ({ ...t, source: "demo" }));
  // An explicit empty official response means no service, not permission to invent one.
  const officialKtx = ktxSource && ["live", "unavailable"].includes(ktxSource.mode);
  const trains = officialKtx ? (ktxSource.data || []).flatMap(row => {
    const departure = railInstant(row.departureTime);
    const arrival = railInstant(row.arrivalTime);
    if (!validLeg(departure, arrival, date)) return [];
    if (row.departureStation && station(row.departureStation) !== "서울") return [];
    if (row.arrivalStation && station(row.arrivalStation) !== "전주") return [];
    return [{ id: `KTX-${row.trainNo}-${Date.parse(departure)}`, service: `KTX ${row.trainNo}`, origin: "서울역", destination: "전주역", departure, arrival,
      price: Number(row.adultFare) || 0, fareKnown: Number(row.adultFare) > 0, source: "official", transferMinutes: 18,
      accessibilityReady: row.accessibilityReady }];
  }) : template.trains.map(t => ({ ...t, source: "demo", fareKnown: true }));
  const cutoff = Math.max(Date.parse(scheduledArrival), now.getTime());
  const pairs = airport.flatMap(arex => trains.filter(ktx =>
    Date.parse(arex.departure) > cutoff && Date.parse(ktx.departure) >= Date.parse(arex.arrival) + ktx.transferMinutes * minute
  ).map(ktx => ({ arex, ktx }))).sort((a, b) => Date.parse(a.ktx.arrival) - Date.parse(b.ktx.arrival) || Date.parse(b.arex.departure) - Date.parse(a.arex.departure));
  // Keep the latest valid airport connection per KTX to avoid filling all slots with one train.
  const seen = new Set();
  const selected = pairs.filter(pair => { if (seen.has(pair.ktx.id)) return false; seen.add(pair.ktx.id); return true; }).slice(0, 12);
  const allOfficial = observedAirport.length > 0 && officialKtx;
  return {
    timetable: trains.filter(train => Date.parse(train.departure) > now.getTime()).sort((a, b) => Date.parse(a.departure) - Date.parse(b.departure)),
    airportRail: selected.map(({ arex, ktx }) => ({ ...arex, id: connectionId(arex, ktx) })),
    trains: selected.map(({ arex, ktx }) => ({ ...ktx, recommendedArexId: connectionId(arex, ktx) })),
    sourceLabel: allOfficial ? "공식 운행시간표" : officialKtx ? "KTX 공식 시간표 · 공항철도 체험 시간표" : "체험 시간표 · 실제 운행 확인 필요",
    authoritative: allOfficial,
    unavailable: selected.length === 0,
    reason: selected.length ? null : "도착 이후 환승 가능한 열차가 없습니다."
  };
}
