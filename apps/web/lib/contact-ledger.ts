import { DASHBOARD_PATHS } from "@barbercue/shared";
import type {
  ContactLedgerSummaryDto,
  EraseContactResultDto,
  RecordContactConsentsResultDto,
  WithdrawContactConsentResultDto,
} from "@barbercue/shared";

// Contact consent ledger (requirement 13), owner side. Saves WHO agreed to be contacted and honours "stop" and "erase"
// requests. It never sends anything: every answer says so and the server refuses the routes unless the ledger is switched on.
// FastQue keeps only a scrambled fingerprint of each number, never the number itself, so this screen never receives numbers back.

export const ledgerPath = (salonId: string, tail = "") =>
  `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.contacts}/consents${tail}`;

const OUTCOME_TEXT: Record<string, { label: string; ok: boolean }> = {
  RECORDED: { label: "Saved", ok: true },
  ALREADY_RECORDED: { label: "Already saved", ok: true },
  SUPPRESSED: { label: "On the do-not-contact list", ok: false },
  WITHDRAWN_BY_CONTACT: { label: "Asked to stop", ok: false },
  INVALID_PHONE: { label: "Not a valid number", ok: false },
  CONSENT_REQUIRED: { label: "No agreement stated", ok: false },
  CONSENT_EVIDENCE_INCOMPLETE: { label: "Agreement details missing", ok: false },
  CONSENT_TIMESTAMP_INVALID: { label: "Date not accepted", ok: false },
  DUPLICATE_IN_BATCH: { label: "Repeated number", ok: false },
};

/** Words for a server outcome; one this screen does not know yet is shown as sent. */
export function outcomeText(outcome: string): { label: string; ok: boolean } {
  return OUTCOME_TEXT[outcome] ?? { label: outcome, ok: false };
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * Accepts the server's answer only if it is exactly what this page asked for: one outcome per submitted line, and an answer that
 * says nothing was sent. Anything else is treated as "could not tell", so the page never claims numbers were saved.
 */
export function parseRecordResult(raw: unknown, lines: number): RecordContactConsentsResultDto | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<RecordContactConsentsResultDto>;
  if (r.dispatchEnabled !== false) return null;
  if (!Array.isArray(r.items) || r.items.length !== lines) return null;
  if (!r.items.every((item, index) => item && item.index === index && typeof item.outcome === "string")) return null;
  const s = r.summary;
  if (!s || !isCount(s.total) || !isCount(s.recorded) || !isCount(s.alreadyRecorded) || !isCount(s.suppressed) || !isCount(s.withdrawnByContact) || !isCount(s.rejected)) return null;
  return r as RecordContactConsentsResultDto;
}

export function parseSummary(raw: unknown): ContactLedgerSummaryDto | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ContactLedgerSummaryDto>;
  if (r.dispatchEnabled !== false) return null;
  if (!isCount(r.active) || !isCount(r.withdrawn) || !isCount(r.expired) || !isCount(r.expiringWithin30Days) || !isCount(r.retentionDays)) return null;
  return r as ContactLedgerSummaryDto;
}

export function parseWithdraw(raw: unknown): WithdrawContactConsentResultDto | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<WithdrawContactConsentResultDto>;
  return typeof r.withdrawn === "boolean" && typeof r.suppressedEverywhere === "boolean" ? (r as WithdrawContactConsentResultDto) : null;
}

export function parseErase(raw: unknown): EraseContactResultDto | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<EraseContactResultDto>;
  return isCount(r.erased) && typeof r.suppressionKept === "boolean" ? (r as EraseContactResultDto) : null;
}

export function savedSentence(result: RecordContactConsentsResultDto): string {
  const { recorded, alreadyRecorded, suppressed, withdrawnByContact, rejected } = result.summary;
  const parts = [
    `${recorded} saved`,
    alreadyRecorded > 0 ? `${alreadyRecorded} already saved` : null,
    suppressed > 0 ? `${suppressed} on the do-not-contact list` : null,
    withdrawnByContact > 0 ? `${withdrawnByContact} asked to stop` : null,
    rejected > 0 ? `${rejected} not accepted` : null,
  ].filter((part): part is string => part !== null);
  return `${parts.join(", ")}. Nobody was contacted.`;
}
