import { z } from "zod";
import { ContactConsentSource } from "./enums";

// Contact consent ledger (requirement 13). Provider-free: it records WHO may be contacted and honours opt-outs and erasure,
// but it never sends anything. Dispatch stays blocked until a delivery provider, an approved retention/invitation policy
// and an explicit owner decision exist; every response says so.
//
//   POST dashboard/salons/:salonId/contacts/consents            record the consent evidence the owner states (idempotent)
//   GET  dashboard/salons/:salonId/contacts/consents/summary    counts only
//   POST dashboard/salons/:salonId/contacts/consents/withdraw   the contact asked to stop (optionally everywhere)
//   POST dashboard/salons/:salonId/contacts/consents/erase      delete this shop's record of the number
//   POST admin/contact-ledger/purge-expired                     platform admin: delete records past their retention
//
// No phone number is ever returned or stored in plaintext. Records are matched by a keyed hash.

export const CONTACT_LEDGER_MAX_BATCH = 250;
export const CONTACT_LEDGER_PURPOSE = "BOOKING_INVITATION" as const;
/** Provisional policy text version: retention and wording are an OWNER decision and are not yet approved. */
export const CONTACT_LEDGER_POLICY_VERSION = "2026-10-provisional-1";
export const CONTACT_LEDGER_DEFAULT_RETENTION_DAYS = 365;
export const CONTACT_LEDGER_MIN_RETENTION_DAYS = 30;
export const CONTACT_LEDGER_MAX_RETENTION_DAYS = 1095;

export const ContactLedgerOutcome = {
  RECORDED: "RECORDED",
  ALREADY_RECORDED: "ALREADY_RECORDED",
  /** On the platform-wide do-not-contact list: never recorded. */
  SUPPRESSED: "SUPPRESSED",
  /** The contact withdrew from this shop; only a LATER consent can be recorded again. */
  WITHDRAWN_BY_CONTACT: "WITHDRAWN_BY_CONTACT",
  INVALID_PHONE: "INVALID_PHONE",
  CONSENT_REQUIRED: "CONSENT_REQUIRED",
  CONSENT_EVIDENCE_INCOMPLETE: "CONSENT_EVIDENCE_INCOMPLETE",
  CONSENT_TIMESTAMP_INVALID: "CONSENT_TIMESTAMP_INVALID",
  DUPLICATE_IN_BATCH: "DUPLICATE_IN_BATCH",
} as const;
export type ContactLedgerOutcome =
  (typeof ContactLedgerOutcome)[keyof typeof ContactLedgerOutcome];

export const ContactLedgerErrorCode = {
  NOT_CONFIGURED: "CONTACT_LEDGER_NOT_CONFIGURED",
  INVALID_PHONE: "CONTACT_LEDGER_INVALID_PHONE",
} as const;

const phoneField = z.string().trim().min(1).max(40);

export const recordContactConsentsSchema = z
  .object({
    contacts: z
      .array(
        z
          .object({
            phone: phoneField,
            consent: z
              .object({
                granted: z.boolean(),
                source: z.nativeEnum(ContactConsentSource).optional(),
                capturedAt: z.string().datetime({ offset: true }).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(CONTACT_LEDGER_MAX_BATCH),
  })
  .strict();
export type RecordContactConsentsInput = z.infer<
  typeof recordContactConsentsSchema
>;

export const withdrawContactConsentSchema = z
  .object({
    phone: phoneField,
    /** Also add the number to the platform-wide do-not-contact list (every shop). */
    suppressEverywhere: z.boolean().default(false),
  })
  .strict();
export type WithdrawContactConsentInput = z.infer<
  typeof withdrawContactConsentSchema
>;

export const eraseContactSchema = z
  .object({
    phone: phoneField,
    /**
     * Keep only the do-not-contact hash after erasing (default). Set false ONLY when the contact must be forgotten
     * entirely and may be recorded again later.
     */
    keepSuppression: z.boolean().default(true),
  })
  .strict();
export type EraseContactInput = z.infer<typeof eraseContactSchema>;

interface LedgerGate {
  dispatchEnabled: false;
  dispatchBlockedReason: "PROVIDER_AND_APPROVAL_GATES_REQUIRED";
  policyVersion: string;
  retentionDays: number;
}

export interface RecordContactConsentsResultDto extends LedgerGate {
  summary: {
    total: number;
    recorded: number;
    alreadyRecorded: number;
    suppressed: number;
    withdrawnByContact: number;
    rejected: number;
  };
  items: Array<{ index: number; outcome: ContactLedgerOutcome }>;
}

export interface ContactLedgerSummaryDto extends LedgerGate {
  active: number;
  withdrawn: number;
  /** ACTIVE but past retention: awaiting purge, never usable. */
  expired: number;
  expiringWithin30Days: number;
}

export interface WithdrawContactConsentResultDto {
  withdrawn: boolean;
  suppressedEverywhere: boolean;
}

export interface EraseContactResultDto {
  erased: number;
  suppressionKept: boolean;
}

export interface PurgeExpiredContactConsentsResultDto {
  purged: number;
}
