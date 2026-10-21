import { CUSTOMER_ASSISTANT_SEARCH_LIMITS, customerAssistantSearchSchema } from "@barbercue/shared";
import type { CustomerAssistantSearchResultDto } from "@barbercue/shared";
import { cityToSlug } from "./public-offers";

// Customer "Find a time" (requirement #15, customer side) on docs/contracts/FASTQUE_CUSTOMER_ASSISTANT_SEARCH_V1.md (Codex PR #278):
//   POST assistant/search { serviceQuery, date, city | lat+lng(+radiusKm), maxPrice?, limit? }   (public; 5 requests per IP per minute)
//   -> { mode: "DETERMINISTIC_CATALOG_AVAILABILITY", generated: false, bookingConfirmationRequired: true, date, candidates[] }
//
// What comes back is a search of real shops, prices and open times, not a conversation and not a booking. Nothing is held for the
// customer: the times are a snapshot, and the booking page decides again when they confirm. This file never makes up a shop, a time or a
// price, and a reply without the documented shape is shown as "could not search", never as an empty result.

export const SEARCH_LIMITS = CUSTOMER_ASSISTANT_SEARCH_LIMITS;
export const DEFAULT_RADIUS_KM = 25;
export const MAX_RADIUS_KM = 500;
export const SEARCHES_PER_MINUTE = 5;

export interface SearchForm {
  serviceQuery: string;
  /** YYYY-MM-DD in the customer's own calendar; the server reads it in each shop's time zone. */
  date: string;
  /** What was typed in the city box. Ignored when `coords` is set. */
  city: string;
  coords: { lat: number; lng: number } | null;
  /** Empty means no price limit. */
  maxPrice: string;
  limit: number;
}

export type FormField = "serviceQuery" | "date" | "city" | "maxPrice";
export type FormErrors = Partial<Record<FormField, string>>;

export type Built = { ok: true; body: Record<string, unknown> } | { ok: false; errors: FormErrors };

/** Today's date as YYYY-MM-DD in the browser's calendar (not UTC), so "today" is the customer's today. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Checks the form like the server does (same shared schema) and builds the request, or says exactly what to fix. */
export function buildSearchRequest(form: SearchForm, today: string = localToday()): Built {
  const errors: FormErrors = {};
  const serviceQuery = form.serviceQuery.trim();
  if (serviceQuery.length < 2) errors.serviceQuery = "Type the service you want, for example haircut.";
  else if (serviceQuery.length > SEARCH_LIMITS.maxQueryLength) errors.serviceQuery = `Use at most ${SEARCH_LIMITS.maxQueryLength} characters.`;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) errors.date = "Pick a day.";
  else if (form.date < today) errors.date = "Pick today or a later day.";

  const body: Record<string, unknown> = { serviceQuery, date: form.date, limit: form.limit };
  if (form.coords) {
    body.lat = form.coords.lat;
    body.lng = form.coords.lng;
    body.radiusKm = DEFAULT_RADIUS_KM;
  } else {
    const slug = cityToSlug(form.city);
    if (!form.city.trim()) errors.city = "Enter your city, or use your location.";
    else if (!slug) errors.city = "That does not look like a city name. Use letters, numbers and hyphens.";
    else body.city = slug;
  }

  const budget = form.maxPrice.trim();
  if (budget) {
    const n = Number(budget);
    if (!Number.isFinite(n) || n < 0) errors.maxPrice = "Enter the most you want to pay as a number, or leave it empty.";
    else body.maxPrice = n;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  // The shared schema is what the server runs; if it disagrees, that is a bug to see here, not something to send.
  const parsed = customerAssistantSearchSchema.safeParse(body);
  if (!parsed.success) return { ok: false, errors: { serviceQuery: "Check the details and try again." } };
  return { ok: true, body: parsed.data as Record<string, unknown> };
}

type Candidate = CustomerAssistantSearchResultDto["candidates"][number];

function isCandidate(value: unknown): value is Candidate {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  const salon = c.salon as Record<string, unknown> | undefined;
  const service = c.service as Record<string, unknown> | undefined;
  return (
    !!salon &&
    typeof salon.slug === "string" &&
    typeof salon.name === "string" &&
    typeof salon.citySlug === "string" &&
    typeof salon.countryCode === "string" &&
    (salon.distanceKm === null || typeof salon.distanceKm === "number") &&
    !!service &&
    typeof service.id === "string" &&
    typeof service.name === "string" &&
    typeof service.price === "number" &&
    Number.isFinite(service.price) &&
    typeof service.durationMinutes === "number" &&
    (c.currency === null || typeof c.currency === "string") &&
    typeof c.timeZone === "string" &&
    Array.isArray(c.availableSlots) &&
    c.availableSlots.every((s) => !!s && typeof (s as Record<string, unknown>).slotStart === "string" && typeof (s as Record<string, unknown>).slotEnd === "string")
  );
}

/** The result, only when it has exactly the documented shape. */
export function parseSearch(raw: unknown): CustomerAssistantSearchResultDto | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.mode !== "DETERMINISTIC_CATALOG_AVAILABILITY" || r.generated !== false || r.bookingConfirmationRequired !== true) return null;
  if (typeof r.date !== "string" || !Array.isArray(r.candidates) || !r.candidates.every(isCandidate)) return null;
  return r as unknown as CustomerAssistantSearchResultDto;
}

/** A slot's start as a clock time in the SHOP's time zone (the customer may be elsewhere); falls back to UTC rather than hide a time. */
export function formatSlot(slotStart: string, timeZone: string): string {
  const when = new Date(slotStart);
  if (Number.isNaN(when.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).format(when);
  } catch {
    return `${new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(when)} UTC`;
  }
}

/**
 * Opens the shop's booking page with the service already chosen. The time is NOT carried over: the booking page shows live times and the
 * customer confirms there, so a stale snapshot can never book anything.
 */
export function bookHref(candidate: Candidate): string {
  const q = new URLSearchParams({ country: candidate.salon.countryCode.toLowerCase(), city: candidate.salon.citySlug, serviceId: candidate.service.id });
  return `/book/${encodeURIComponent(candidate.salon.slug)}?${q.toString()}`;
}

export type SearchFailure = { kind: "FIX_FORM" | "TOO_FAST" | "TRY_LATER"; message: string };

export function describeFailure(status: number | undefined, code?: string): SearchFailure {
  if (status === 429) return { kind: "TOO_FAST", message: `You have searched a lot in a short time (the limit is ${SEARCHES_PER_MINUTE} a minute). Wait a minute and try again.` };
  if (status === 400 || code === "VALIDATION_ERROR") return { kind: "FIX_FORM", message: "Some details were not accepted. Check the service, day and place and try again." };
  if (status === 0) return { kind: "TRY_LATER", message: "You appear to be offline. Check your connection and try again." };
  return { kind: "TRY_LATER", message: "The search could not be completed right now. Nothing was booked. Try again in a moment." };
}
