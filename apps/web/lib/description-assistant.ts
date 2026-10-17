import { SALON_DESCRIPTION_SUGGESTION_LIMITS, SalonDescriptionErrorCode } from "@barbercue/shared";

// AI shop-description helper (requirement #10, owner decision D9), on Codex PR #246:
//   POST dashboard/salons/:salonId/description/suggestions {language, tone, ownerAttestedHighlights}
//   -> { draft, language, persisted: false, requiresOwnerReview: true, notice }
//
// The draft is only text for the owner to read and edit. It is never saved by this page: the owner copies it into the
// description box and saves the profile through the ordinary form, which stays fully usable without any AI. The server's
// provider is deliberately not configured yet, so today the honest answer is "not available"; this file never makes up
// a draft and never treats a failure as a draft. The server allows 3 drafts per 10 minutes per shop.

export const LIMITS = SALON_DESCRIPTION_SUGGESTION_LIMITS;

export type DraftLanguage = "en" | "hi";
export type DraftTone = "professional" | "friendly" | "premium";

export const LANGUAGES: ReadonlyArray<{ value: DraftLanguage; label: string }> = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
];

export const TONES: ReadonlyArray<{ value: DraftTone; label: string }> = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "premium", label: "Premium" },
];

export function isLanguage(value: string): value is DraftLanguage {
  return LANGUAGES.some((l) => l.value === value);
}

export function isTone(value: string): value is DraftTone {
  return TONES.some((t) => t.value === value);
}

export interface Highlights {
  highlights: string[];
  error: string | null;
}

/** One fact per line. Blank lines are dropped; more than the server allows, or one that is too long, is an error (never cut off silently). */
export function parseHighlights(text: string): Highlights {
  const highlights = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (highlights.length > LIMITS.maxHighlights) return { highlights: [], error: `Add at most ${LIMITS.maxHighlights} facts, one per line.` };
  const tooLong = highlights.findIndex((h) => h.length > LIMITS.maxHighlightLength);
  if (tooLong >= 0) return { highlights: [], error: `Fact ${tooLong + 1} is too long. Use at most ${LIMITS.maxHighlightLength} characters each.` };
  return { highlights, error: null };
}

export interface SuggestionRequest {
  language: DraftLanguage;
  tone: DraftTone;
  ownerAttestedHighlights: string[];
}

export function buildRequest(language: DraftLanguage, tone: DraftTone, highlights: string[]): SuggestionRequest {
  return { language, tone, ownerAttestedHighlights: highlights };
}

export interface Suggestion {
  draft: string;
  notice: string | null;
}

/** Reads the server's answer. Anything without a usable draft is "no draft", never a guess. */
export function parseSuggestion(raw: unknown): Suggestion | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { draft, notice } = raw as { draft?: unknown; notice?: unknown };
  if (typeof draft !== "string" || !draft.trim()) return null;
  return { draft, notice: typeof notice === "string" && notice.trim() ? notice : null };
}

export type DraftLength = { state: "ok" | "short" | "long"; message: string };

/** How the text sits against the range the server uses for drafts (and the profile's own 2,000-character limit). */
export function describeLength(text: string): DraftLength {
  const length = text.trim().length;
  if (length === 0) return { state: "short", message: "Empty." };
  if (length < LIMITS.minDraftLength) return { state: "short", message: `${length} characters. Descriptions of ${LIMITS.minDraftLength} or more tell customers more.` };
  if (length > LIMITS.maxDraftLength) return { state: "long", message: `${length} characters. Shorter is easier to read; ${LIMITS.maxDraftLength} or fewer is best.` };
  return { state: "ok", message: `${length} characters.` };
}

export type FailureKind = "UNAVAILABLE" | "RATE_LIMITED" | "TRY_LATER" | "REJECTED";

export interface Failure {
  kind: FailureKind;
  message: string;
}

const WINDOW_MINUTES = Math.round(LIMITS.throttleWindowMs / 60_000);

/** Plain words for every way the server can say no. `UNAVAILABLE` is the expected answer while no provider is configured. */
export function describeFailure(status: number | undefined, code: string | undefined, serverMessage: string): Failure {
  if (code === SalonDescriptionErrorCode.PROVIDER_NOT_CONFIGURED || (status === 503 && code !== SalonDescriptionErrorCode.PROVIDER_TIMEOUT)) {
    return { kind: "UNAVAILABLE", message: "Writing a draft with AI is not available yet. Nothing was changed. You can write your description yourself in the box above." };
  }
  if (status === 429) {
    return { kind: "RATE_LIMITED", message: `You can ask for ${LIMITS.maxRequests} drafts every ${WINDOW_MINUTES} minutes. Wait a little, or write your description yourself.` };
  }
  if (code === SalonDescriptionErrorCode.PROVIDER_TIMEOUT || status === 504) {
    return { kind: "TRY_LATER", message: "The writing service took too long. Nothing was changed. Try again in a moment, or write your description yourself." };
  }
  if (code === SalonDescriptionErrorCode.GENERATION_FAILED || code === SalonDescriptionErrorCode.INVALID_PROVIDER_RESPONSE || status === 502) {
    return { kind: "TRY_LATER", message: "A draft could not be produced this time. Nothing was changed. Try again, or write your description yourself." };
  }
  if (code === SalonDescriptionErrorCode.INPUT_TOO_LARGE) {
    return { kind: "REJECTED", message: "Your shop has more details than a draft can use. Write your description yourself." };
  }
  return { kind: "REJECTED", message: serverMessage || "Could not get a draft. Nothing was changed." };
}
