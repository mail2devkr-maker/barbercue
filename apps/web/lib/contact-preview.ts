import { ContactConsentSource, ContactImportValidationStatus } from "@barbercue/shared";
import type { SalonContactImportPreviewInput } from "@barbercue/shared";

// Contact list check (requirement #13, owner decision D13), on Codex PR #245:
//   POST dashboard/salons/:salonId/contacts/preview {contacts: [{phone, consent?: {granted, source?, capturedAt?}}]}
//
// This is a CHECK, not an import and not an invitation. The server validates phone numbers, spots repeats in the list
// and checks that the consent details are complete, then answers with one status per line (by position). It saves
// nothing, does not look anyone up, does not decide who may be invited, and sends nothing. The consent the owner states
// here is the owner's own statement, not proof. Nothing typed here is kept by this page after the owner clears it or
// leaves.

/** The server accepts at most this many contacts per check. */
export const MAX_CONTACTS = 250;
export const MAX_PHONE_LENGTH = 40;

export type ConsentSource = (typeof ContactConsentSource)[keyof typeof ContactConsentSource];

export const CONSENT_SOURCES: ReadonlyArray<{ value: ConsentSource; label: string }> = [
  { value: ContactConsentSource.OWNER_ATTESTED, label: "I confirm they agreed" },
  { value: ContactConsentSource.IN_PERSON, label: "They agreed in person" },
  { value: ContactConsentSource.VERBAL, label: "They agreed by phone or voice" },
  { value: ContactConsentSource.WRITTEN, label: "They agreed in writing" },
  { value: ContactConsentSource.WEBSITE_FORM, label: "They agreed on a web form" },
];

export function isConsentSource(value: string): value is ConsentSource {
  return CONSENT_SOURCES.some((s) => s.value === value);
}

export interface ContactRow {
  /** 1-based line number in what the owner typed, so a result can be matched back to the line. */
  line: number;
  phone: string;
  /** A source or date written on the line itself; it overrides the batch statement for that line only. */
  source: ConsentSource | null;
  date: string | null;
}

export interface ParsedList {
  rows: ContactRow[];
  /** Lines that could not be used, with the reason in plain words. */
  problems: Array<{ line: number; message: string }>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function realDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * Reads the pasted list, one contact per line: `phone`, optionally followed by `, source` and `, YYYY-MM-DD` (separated
 * by commas, semicolons or tabs). Blank lines are skipped. A line is never guessed at: an unknown source word or a date
 * that is not real is reported against its line and left out.
 */
export function parseContactList(text: string): ParsedList {
  const rows: ContactRow[] = [];
  const problems: ParsedList["problems"] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    const [phoneRaw, sourceRaw, dateRaw, ...extra] = raw.split(/[,;\t]/).map((p) => p.trim());
    if (extra.some((e) => e !== "")) {
      problems.push({ line, message: "Too many columns. Use: phone, source, date." });
      return;
    }
    if (!phoneRaw) {
      problems.push({ line, message: "No phone number on this line." });
      return;
    }
    if (phoneRaw.length > MAX_PHONE_LENGTH) {
      problems.push({ line, message: `A phone number can be at most ${MAX_PHONE_LENGTH} characters.` });
      return;
    }
    let source: ConsentSource | null = null;
    if (sourceRaw) {
      const normalized = sourceRaw.toUpperCase().replace(/[\s-]+/g, "_");
      if (!isConsentSource(normalized)) {
        problems.push({ line, message: `“${sourceRaw}” is not a known way of agreeing. Use ${CONSENT_SOURCES.map((s) => s.value).join(", ")}.` });
        return;
      }
      source = normalized;
    }
    let date: string | null = null;
    if (dateRaw) {
      if (!realDate(dateRaw)) {
        problems.push({ line, message: `“${dateRaw}” is not a real date. Use YYYY-MM-DD.` });
        return;
      }
      date = dateRaw;
    }
    rows.push({ line, phone: phoneRaw, source, date });
  });
  return { rows, problems };
}

export interface BatchConsent {
  /** The owner states that every person on the list agreed to be contacted. */
  attested: boolean;
  source: ConsentSource;
  /** YYYY-MM-DD the agreement was given. */
  date: string;
}

/** Today's date (UTC) as YYYY-MM-DD, the latest a consent date can be. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function validateBatch(batch: BatchConsent, today: string = todayIso()): string | null {
  if (!batch.attested) return null;
  if (!realDate(batch.date)) return "Enter the date they agreed.";
  if (batch.date > today) return "The date they agreed cannot be in the future.";
  return null;
}

/** The request body for one check. Consent is sent only when the owner states it; nothing is assumed. */
export function buildRequest(rows: ReadonlyArray<ContactRow>, batch: BatchConsent): SalonContactImportPreviewInput {
  return {
    contacts: rows.map((row) => {
      const source = row.source ?? (batch.attested ? batch.source : null);
      const date = row.date ?? (batch.attested ? batch.date : null);
      if (!source && !date && !batch.attested) return { phone: row.phone };
      return {
        phone: row.phone,
        consent: {
          granted: true,
          ...(source ? { source } : {}),
          ...(date ? { capturedAt: `${date}T00:00:00.000Z` } : {}),
        },
      };
    }),
  };
}

export type RowStatus = (typeof ContactImportValidationStatus)[keyof typeof ContactImportValidationStatus];

const STATUS_TEXT: Record<string, { label: string; help: string; ok: boolean }> = {
  VALIDATED_FOR_REVIEW: { label: "Looks complete", help: "A valid number with a stated way and date of agreeing. This is not a decision to invite them.", ok: true },
  INVALID_PHONE: { label: "Not a valid number", help: "Check the number. Without a +country code, only Indian mobile numbers are recognised.", ok: false },
  CONSENT_REQUIRED: { label: "No agreement stated", help: "Say that this person agreed to be contacted.", ok: false },
  CONSENT_EVIDENCE_INCOMPLETE: { label: "Agreement details missing", help: "Add how and when they agreed.", ok: false },
  CONSENT_TIMESTAMP_INVALID: { label: "Date not accepted", help: "The date they agreed cannot be in the future.", ok: false },
  DUPLICATE_IN_BATCH: { label: "Repeated number", help: "This number appears earlier in your list.", ok: false },
};

/** Words for a server status; one this screen does not know yet is shown as sent. */
export function statusText(status: string): { label: string; help: string; ok: boolean } {
  return STATUS_TEXT[status] ?? { label: status, help: "", ok: false };
}

/** Last four digits only, so results on screen do not display whole numbers again. */
export function maskedPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 4 ? `••••${digits.slice(-4)}` : "••••";
}
