import { normalizeBookedLeg } from "./ticket-protection.js";
import { disruptionPresets } from "./data.js";

export const JOURNEY_SESSION_STORAGE_KEY = "chakchak-journey-session-v1";

function normalizeSession(value) {
  const journey = value?.journey;
  if (value?.schemaVersion !== 1 || !journey || !/^[A-Z0-9]{2,8}$/.test(journey.flightId)
    || typeof journey.arrivalAt !== "string" || !Number.isFinite(Date.parse(journey.arrivalAt))
    || !journey.arrivalAt.endsWith("+09:00") || journey.destination !== "전주"
    || ![0, 1, 2].includes(journey.checkedBags) || !["standard", "assisted"].includes(journey.mobility)
    || typeof journey.useExampleFlight !== "boolean" || !Object.hasOwn(disruptionPresets, value.scenarioId)
    || !Number.isFinite(value.previewDelayMinutes) || value.previewDelayMinutes < 0 || value.previewDelayMinutes > 90) return null;
  const ticket = journey.ticket || {};
  return {
    schemaVersion: 1,
    journey: {
      flightId: journey.flightId, arrivalAt: journey.arrivalAt, destination: journey.destination,
      useExampleFlight: journey.useExampleFlight, checkedBags: journey.checkedBags, mobility: journey.mobility,
      largeLuggage: journey.largeLuggage === true, stayNights: 2,
      interests: Array.isArray(journey.interests) ? journey.interests.filter(v => typeof v === "string").slice(0, 4).map(v => v.slice(0, 40)) : [],
      ticket: {
        hasBookedTicket: ticket.hasBookedTicket === true, korail: ticket.korail === true, arex: ticket.arex === true,
        ticketType: ["standard", "discount", "pass", "group"].includes(ticket.ticketType) ? ticket.ticketType : "standard",
        arexType: ticket.arexType === "general" ? "general" : "direct",
        bookings: { korail: normalizeBookedLeg(ticket.bookings?.korail), arex: normalizeBookedLeg(ticket.bookings?.arex) }
      }
    },
    scenarioId: value.scenarioId, previewDelayMinutes: value.previewDelayMinutes, customDelayActive: value.customDelayActive === true
  };
}

export function loadJourneySession(storage) {
  try { return normalizeSession(JSON.parse(storage?.getItem(JOURNEY_SESSION_STORAGE_KEY) || "null")); }
  catch { return null; }
}

export function saveJourneySession(storage, state) {
  const value = normalizeSession({ schemaVersion: 1, journey: state.journey, scenarioId: state.scenarioId, previewDelayMinutes: state.previewDelayMinutes, customDelayActive: state.customDelayActive });
  if (!value || !storage) return false;
  try { storage.setItem(JOURNEY_SESSION_STORAGE_KEY, JSON.stringify(value)); return true; }
  catch { return false; }
}
