import { z } from 'zod';

/**
 * HR permanent employee-ID register — shared contract (issue #283).
 *
 * Backend (apps/backend/src/hr-register) and web (apps/web/lib/hr-register) both import these. Calendar
 * dates are `YYYY-MM-DD`; instants are ISO-8601 UTC strings. Contacts are NEVER returned by list or
 * detail endpoints (masked strings only); raw contact values leave the server only through the audited
 * `letter-data` endpoint, for one saved offer version.
 */

export const HR_PATHS = {
  base: 'admin/hr',
  register: 'register',
  matches: 'identity/matches',
  offers: 'offers',
  persons: 'persons',
  episodes: 'episodes',
  reconciliation: 'reconciliation',
} as const;

export const EMPLOYEE_CODE_PATTERN = /^FQ-FE-\d{5}$/;
export const HR_EXPECTED_PERFORMANCE_INCENTIVE_MONTHLY_INR = 5000;
export const HR_REASON_MIN = 5;
export const HR_REASON_MAX = 500;

export const HR_OFFER_STATUSES = ['DRAFT', 'ISSUED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const;
export type HrOfferStatus = (typeof HR_OFFER_STATUSES)[number];
export const HR_EPISODE_STATUSES = ['PENDING_JOIN', 'NOT_JOINED', 'ACTIVE', 'EXITED'] as const;
export type HrEpisodeStatus = (typeof HR_EPISODE_STATUSES)[number];
export type HrOfferKind = 'FIRST' | 'REOFFER' | 'REHIRE';
export type HrOfferSource = 'REGISTER' | 'HISTORICAL_IMPORT';
export type HrPersonOrigin = 'OFFER' | 'EXISTING_PROFILE' | 'RECONCILIATION' | 'DIRECT_ACCOUNT';
export const HR_MATCH_REASONS = ['EXACT_CODE', 'EMAIL', 'PHONE', 'NAME_EXACT', 'NAME_SIMILAR', 'PRIOR_OFFER'] as const;
export type HrMatchReason = (typeof HR_MATCH_REASONS)[number];
export type HrLifecycle = 'OFFERED' | 'NOT_JOINED' | 'ACTIVE' | 'EXITED' | 'REOFFERED' | 'REJOINED';
export type HrLifecycleFilter = 'ALL' | HrLifecycle;

export interface HrActorRef {
  id: string;
  displayName: string;
}

export interface HrManagerRef {
  /** EmployeeProfile id of the manager. */
  id: string;
  fullName: string;
  employeeCode: string;
}

export interface HrOfferTerms {
  role: string;
  baseSalaryInr: number;
  salaryBasis: 'monthly' | 'annual';
  salesTarget: number | null;
  incentiveBeyondTargetInr: number | null;
  proposedJoiningDate: string | null;
  reportingManager: HrManagerRef | null;
  city: string | null;
  /** Snapshot of the standard incentive at issue time; never recalculated from a later default. */
  expectedPerformanceIncentiveMonthlyInr: number;
}

export interface HrPdfEvent {
  id: string;
  event: 'GENERATED' | 'REPRINTED';
  at: string;
  actor: HrActorRef;
  sha256: string;
  byteLength: number;
}

export interface HrOfferDelivery {
  saved: true;
  pdfCount: number;
  emailedRecordedAt: string | null;
  acceptanceProven: boolean;
}

export interface HrOfferVersion {
  id: string;
  personId: string;
  version: number;
  kind: HrOfferKind;
  source: HrOfferSource;
  status: HrOfferStatus;
  issuedAt: string;
  sentAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  expiredAt: string | null;
  createdBy: HrActorRef;
  terms: HrOfferTerms;
  delivery: HrOfferDelivery;
  pdfHistory: HrPdfEvent[];
  supersededByVersion: number | null;
  employmentEpisodeId: string | null;
  statusReason: string | null;
}

export interface HrEmploymentEpisode {
  id: string;
  episodeNumber: number;
  status: HrEpisodeStatus;
  originatingOfferVersion: number | null;
  joinedOn: string | null;
  exitedOn: string | null;
  notJoinedOn: string | null;
  statusReason: string | null;
}

export interface HrSalaryHistoryEntry {
  id: string;
  effectiveFrom: string;
  baseSalaryInr: number;
  salaryBasis: 'monthly' | 'annual';
  offerVersion: number | null;
  recordedAt: string;
  recordedBy: HrActorRef;
}

export interface HrManagerHistoryEntry {
  id: string;
  manager: HrManagerRef;
  from: string;
  to: string | null;
  offerVersion: number | null;
  recordedAt: string;
  recordedBy: HrActorRef;
}

export interface HrPersonSummary {
  id: string;
  employeeCode: string;
  fullName: string;
  maskedEmail: string | null;
  maskedPhone: string | null;
  city: string | null;
  reportingManager: HrManagerRef | null;
  /** Null for people hired before the register existed (no offer was ever recorded for them). */
  firstOfferIssuedAt: string | null;
  latestOfferVersion: number | null;
  latestOfferStatus: HrOfferStatus | null;
  latestOfferIssuedAt: string | null;
  offerCount: number;
  currentEpisode: Pick<HrEmploymentEpisode, 'id' | 'episodeNumber' | 'status' | 'joinedOn' | 'exitedOn'> | null;
  episodeCount: number;
  hasEmployeeAccount: boolean;
  employeeProfileId: string | null;
  origin: HrPersonOrigin;
  /** First ever joining date; each episode keeps its own `joinedOn`. */
  originalJoinedOn: string | null;
}

export interface HrPersonDetail extends HrPersonSummary {
  offers: HrOfferVersion[];
  episodes: HrEmploymentEpisode[];
  salaryHistory: HrSalaryHistoryEntry[];
  managerHistory: HrManagerHistoryEntry[];
}

export interface HrMatchCandidate {
  person: HrPersonSummary;
  reasons: HrMatchReason[];
  strength: 'STRONG' | 'WEAK';
}

export interface HrMatchResult {
  matches: HrMatchCandidate[];
  /** True when creating a NEW identity needs a written, audited override reason. */
  blocksNewIdentity: boolean;
  /** True when the match is a hard one (same contact and same name): only a senior admin may override. */
  overrideRequiresSenior: boolean;
  /** Signed, short-lived token that binds this review to the later create call. */
  decisionToken: string;
}

export interface HrRegisterPage {
  items: HrPersonSummary[];
  nextCursor: string | null;
  total: number;
}

export interface HrAuditEntry {
  id: string;
  at: string;
  actor: HrActorRef;
  action: string;
  subject: { kind: 'PERSON' | 'OFFER' | 'EPISODE' | 'RECONCILIATION'; label: string };
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
}

export interface HrAuditPage {
  items: HrAuditEntry[];
  nextCursor: string | null;
}

export type HrReconciliationStatus = 'UNVERIFIED' | 'LINKED' | 'IDENTITY_CREATED' | 'DUPLICATE';

export interface HrReconciliationItem {
  id: string;
  source: 'SENT_MAIL_AUDIT' | 'PDF_REVIEW' | 'MANUAL';
  sentOn: string;
  maskedRecipient: string;
  candidateLabel: string | null;
  printedEmployeeCode: string | null;
  possibleDuplicateOf: string | null;
  acceptanceEvidence: 'NONE' | 'NOTE';
  status: HrReconciliationStatus;
  linkedPerson: Pick<HrPersonSummary, 'id' | 'employeeCode' | 'fullName'> | null;
}

export interface HrReconciliationPage {
  items: HrReconciliationItem[];
  nextCursor: string | null;
}

export interface HrCreateOfferResult {
  person: HrPersonSummary;
  offer: HrOfferVersion;
}

export interface HrLetterData {
  candidateName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}

// ---------------------------------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------------------------------

const reason = z.string().trim().min(HR_REASON_MIN).max(HR_REASON_MAX);
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), 'Not a real date')
  .refine((value) => new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value, 'Not a real date');

export const hrEmployeeCodeSchema = z.string().regex(EMPLOYEE_CODE_PATTERN, 'Use the form FQ-FE-00123');

export const hrIdentityInputSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  phone: z.string().trim().min(7).max(20).optional(),
  address: z.string().trim().max(400).optional(),
});
export type HrIdentityInput = z.infer<typeof hrIdentityInputSchema>;

export const hrMatchQuerySchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    phone: z.string().trim().min(7).max(20).optional(),
    employeeCode: hrEmployeeCodeSchema.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), { message: 'Provide at least one field to match' });
export type HrMatchQuery = z.infer<typeof hrMatchQuerySchema>;

export const hrOfferTermsInputSchema = z
  .object({
    role: z.string().trim().min(2).max(120),
    baseSalaryInr: z.number().positive().max(100_000_000),
    salaryBasis: z.enum(['monthly', 'annual']),
    salesTarget: z.number().int().min(1).nullable(),
    incentiveBeyondTargetInr: z.number().int().min(1).max(1_000_000).nullable(),
    proposedJoiningDate: calendarDate.nullable(),
    reportingManagerId: z.string().min(1).max(64).nullable(),
    city: z.string().trim().max(120).nullable(),
  })
  .refine((value) => (value.salesTarget === null) === (value.incentiveBeyondTargetInr === null), {
    message: 'Sales target and incentive beyond target are set together or not at all',
    path: ['salesTarget'],
  });
export type HrOfferTermsInput = z.infer<typeof hrOfferTermsInputSchema>;

export const hrCreateOfferSchema = z.object({
  identity: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('NEW'),
      person: hrIdentityInputSchema,
      decisionToken: z.string().min(20).max(2000),
      overrideReason: reason.optional(),
    }),
    z.object({
      mode: z.literal('EXISTING'),
      personId: z.string().min(1).max(64),
      decisionToken: z.string().min(20).max(2000),
    }),
  ]),
  terms: hrOfferTermsInputSchema,
});
export type HrCreateOfferInput = z.infer<typeof hrCreateOfferSchema>;

export const HR_OFFER_TRANSITIONS = ['SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const;
export type HrOfferTransition = (typeof HR_OFFER_TRANSITIONS)[number];

export const hrOfferStatusSchema = z
  .object({
    to: z.enum(HR_OFFER_TRANSITIONS),
    reason: reason.nullable().optional(),
  })
  .refine((value) => (value.to === 'DECLINED' || value.to === 'EXPIRED' ? !!value.reason : true), {
    message: 'A reason is required to record a decline or expiry',
    path: ['reason'],
  });
export type HrOfferStatusInput = z.infer<typeof hrOfferStatusSchema>;

export const hrJoiningSchema = z.object({
  joinedOn: calendarDate,
  territory: z.string().trim().max(160).optional(),
  temporaryPassword: z.string().min(8, 'at least 8 characters').max(72, 'at most 72 characters'),
});
export type HrJoiningInput = z.infer<typeof hrJoiningSchema>;

export const hrNotJoinedSchema = z.object({ decidedOn: calendarDate, reason });
export type HrNotJoinedInput = z.infer<typeof hrNotJoinedSchema>;

export const hrExitSchema = z.object({ exitedOn: calendarDate, reason });
export type HrExitInput = z.infer<typeof hrExitSchema>;

export const hrPdfEventSchema = z.object({
  event: z.enum(['GENERATED', 'REPRINTED']),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lowercase hex characters'),
  byteLength: z.number().int().positive().max(50_000_000),
});
export type HrPdfEventInput = z.infer<typeof hrPdfEventSchema>;

export const hrContactUpdateSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
    phone: z.string().trim().min(7).max(20).nullable().optional(),
    address: z.string().trim().max(400).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    reason,
  })
  .refine((value) => ['email', 'phone', 'address', 'city'].some((key) => (value as Record<string, unknown>)[key] !== undefined), {
    message: 'Provide at least one contact field to change',
  });
export type HrContactUpdateInput = z.infer<typeof hrContactUpdateSchema>;

export const hrRegisterQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  employeeCode: hrEmployeeCodeSchema.optional(),
  lifecycle: z.enum(['OFFERED', 'NOT_JOINED', 'ACTIVE', 'EXITED', 'REOFFERED', 'REJOINED']).optional(),
  offerStatus: z.enum(HR_OFFER_STATUSES).optional(),
  city: z.string().trim().max(120).optional(),
  managerId: z.string().max(64).optional(),
  issuedFrom: calendarDate.optional(),
  issuedTo: calendarDate.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type HrRegisterQuery = z.infer<typeof hrRegisterQuerySchema>;

export const hrPageQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['UNVERIFIED', 'LINKED', 'IDENTITY_CREATED', 'DUPLICATE']).optional(),
});
export type HrPageQuery = z.infer<typeof hrPageQuerySchema>;

export const hrReconciliationImportSchema = z.object({
  items: z
    .array(
      z.object({
        source: z.enum(['SENT_MAIL_AUDIT', 'PDF_REVIEW', 'MANUAL']).default('SENT_MAIL_AUDIT'),
        sentOn: calendarDate,
        recipientEmail: z.string().trim().toLowerCase().email().max(254),
        candidateLabel: z.string().trim().max(120).optional(),
        printedEmployeeCode: hrEmployeeCodeSchema.optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type HrReconciliationImportInput = z.infer<typeof hrReconciliationImportSchema>;

export const hrReconciliationLinkSchema = z.object({ personId: z.string().min(1).max(64) });
export const hrReconciliationDuplicateSchema = z.object({ duplicateOfItemId: z.string().min(1).max(64) });
export const hrReconciliationCreateIdentitySchema = z.object({ historyChecked: z.literal(true) });
