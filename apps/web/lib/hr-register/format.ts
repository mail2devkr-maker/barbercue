import { EMPLOYEE_CODE_PATTERN } from "./types";

/**
 * HR screens always show Indian Standard Time with an explicit zone label, so the audit trail reads
 * the same on every machine and never shifts with the viewer's browser time zone.
 */
const INSTANT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata",
});

const CALENDAR_DATE = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return "—";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "—";
  return `${INSTANT.format(new Date(time))} IST`;
}

/** Accepts `YYYY-MM-DD` (rendered as that calendar day) or a full instant (rendered in IST). */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  if (DATE_ONLY.test(value)) {
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isNaN(time) ? "—" : CALENDAR_DATE.format(new Date(time));
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(time));
}

export function isEmployeeCode(value: string): boolean {
  return EMPLOYEE_CODE_PATTERN.test(value);
}

/** Normalises HR search input that may look like a code (`fq-fe-101`, `101`) into canonical form. */
export function normalizeEmployeeCodeInput(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return null;
  if (EMPLOYEE_CODE_PATTERN.test(trimmed)) return trimmed;
  const match = /^(?:FQ-?FE-?)?(\d{1,5})$/.exec(trimmed);
  if (!match) return null;
  return `FQ-FE-${match[1].padStart(5, "0")}`;
}

export const REASON_MIN = 5;
export const REASON_MAX = 500;

export function validateReason(value: string): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (trimmed.length < REASON_MIN) return { ok: false, message: `Enter a reason of at least ${REASON_MIN} characters.` };
  if (trimmed.length > REASON_MAX) return { ok: false, message: `Keep the reason within ${REASON_MAX} characters.` };
  return { ok: true, value: trimmed };
}

/** Parses a whole-rupee amount typed with optional Indian grouping commas. */
export function parseRupees(value: string): number | null {
  const cleaned = value.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Today's calendar date in India, so "date must not be in the future" checks match HR's clock. */
export function todayInIndia(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata" }).format(now);
  return parts;
}
