import type {
  BookingAttributionCampaignDto,
  BookingAttributionSource,
  CreateBookingAttributionCampaignInput,
} from "@barbercue/shared";

// Booking sources and campaign codes (owner dashboard, requirement #3), on Codex PR #230:
//   GET  dashboard/salons/:id/booking-attribution/summary?from&to[&source]   bookings by source and campaign
//   GET  .../booking-attribution/campaigns?cursor&limit                      safe campaign list, no tokens
//   POST .../booking-attribution/campaigns {source,label,startsAt?,endsAt?}  returns the clear token ONCE
//   POST .../booking-attribution/campaigns/:id/revoke
//
// A campaign code is evidence that a booking was made through a link the owner created; it does not prove the
// customer was on Facebook, Instagram or ChatGPT. The page words it that way and never claims platform identity.

export type CampaignSource = CreateBookingAttributionCampaignInput["source"];

/** Owner-facing words for every source the server can report. Unknown values are shown as sent, never hidden. */
const SOURCE_LABEL: Record<BookingAttributionSource, string> = {
  FASTQUE_APP: "FastQue app",
  FASTQUE_WEB: "FastQue website",
  WALK_IN: "Live Queue",
  IN_SHOP: "In-shop appointment",
  FACEBOOK: "Facebook campaign",
  INSTAGRAM: "Instagram campaign",
  CHATGPT: "ChatGPT campaign",
  OTHER: "Other campaign",
  UNKNOWN: "Not recorded",
};

export function sourceLabel(source: string): string {
  return (SOURCE_LABEL as Record<string, string>)[source] ?? source;
}

export const CAMPAIGN_SOURCES: ReadonlyArray<{ value: CampaignSource; label: string }> = [
  { value: "FACEBOOK", label: "Facebook" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "CHATGPT", label: "ChatGPT" },
  { value: "OTHER", label: "Other" },
];

export function isCampaignSource(value: string): value is CampaignSource {
  return CAMPAIGN_SOURCES.some((s) => s.value === value);
}

export const MAX_LABEL_LENGTH = 120;

export interface CampaignForm {
  source: string;
  label: string;
  /** Shop-local dates (YYYY-MM-DD), both optional. The last day is included. */
  firstDay: string;
  lastDay: string;
}

export type CampaignFormErrors = Partial<Record<"source" | "label" | "firstDay" | "lastDay", string>>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function realDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function validateCampaignForm(form: CampaignForm): CampaignFormErrors {
  const errors: CampaignFormErrors = {};
  if (!isCampaignSource(form.source)) errors.source = "Choose where this link will be shared.";
  const label = form.label.trim();
  if (!label) errors.label = "Give the campaign a name you will recognise.";
  else if (label.length > MAX_LABEL_LENGTH) errors.label = `Use at most ${MAX_LABEL_LENGTH} characters.`;
  if (form.firstDay && !realDate(form.firstDay)) errors.firstDay = "Enter a real date.";
  if (form.lastDay && !realDate(form.lastDay)) errors.lastDay = "Enter a real date.";
  if (!errors.firstDay && !errors.lastDay && form.firstDay && form.lastDay && form.lastDay < form.firstDay) {
    errors.lastDay = "The last day must be on or after the first day.";
  }
  return errors;
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - utcMs;
}

/** The UTC instant at which the shop-local calendar day `date` begins. */
export function startOfZonedDay(date: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let utc = guess - zoneOffsetMs(guess, timeZone);
  utc = guess - zoneOffsetMs(utc, timeZone); // second pass settles days that contain a clock change
  return new Date(utc).toISOString();
}

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Request body for a validated form. The last day is included, so the window ends when the next shop day begins. */
export function toCreateBody(form: CampaignForm, timeZone: string): CreateBookingAttributionCampaignInput {
  const body: CreateBookingAttributionCampaignInput = { source: form.source as CampaignSource, label: form.label.trim() };
  if (form.firstDay) body.startsAt = startOfZonedDay(form.firstDay, timeZone);
  if (form.lastDay) body.endsAt = startOfZonedDay(nextDay(form.lastDay), timeZone);
  return body;
}

export type CampaignStatus = "ACTIVE" | "SCHEDULED" | "ENDED" | "REVOKED";

export function campaignStatus(
  campaign: Pick<BookingAttributionCampaignDto, "revokedAt" | "startsAt" | "endsAt">,
  now: Date = new Date(),
): CampaignStatus {
  if (campaign.revokedAt) return "REVOKED";
  const t = now.getTime();
  if (campaign.startsAt && Date.parse(campaign.startsAt) > t) return "SCHEDULED";
  if (campaign.endsAt && Date.parse(campaign.endsAt) <= t) return "ENDED";
  return "ACTIVE";
}

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  ACTIVE: "Active",
  SCHEDULED: "Not started",
  ENDED: "Ended",
  REVOKED: "Turned off",
};

/** "12 Oct 2026" in the shop's calendar, or an em dash. */
export function formatShopDate(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
  } catch {
    return "—";
  }
}

/** The last shop day a campaign still counts, given its exclusive end instant ("31 Oct" for a window ending as 1 Nov begins). */
export function formatLastDay(endsAt: string | null, timeZone: string): string {
  if (!endsAt) return "—";
  const ms = Date.parse(endsAt);
  if (!Number.isFinite(ms)) return "—";
  return formatShopDate(new Date(ms - 1).toISOString(), timeZone);
}

export function summaryQueryString(range: { from: string; to: string }): string {
  return new URLSearchParams({ from: range.from, to: range.to }).toString();
}

/** Sources listed in the summary: the server's counts, biggest first, nothing dropped. */
export function sortByBookings<T extends { bookingCount: number }>(rows: ReadonlyArray<T>): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.bookingCount - a.row.bookingCount || a.index - b.index)
    .map((x) => x.row);
}
