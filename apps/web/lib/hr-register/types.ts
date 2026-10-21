/**
 * HR Offer Register — web-side data contract.
 *
 * CONTRACT STATUS: PROPOSED (web needs, derived from GitHub issue #283). Codex owns the backend,
 * Prisma schema and shared DTOs and has not yet published the final contract. Every shape below
 * is therefore local to apps/web and is replaced by the `@barbercue/shared` types when Codex
 * publishes them. Nothing in this file is consumed by a deployed backend today.
 *
 * Invariants the UI relies on (issue #283):
 *  - one permanent `FQ-FE-xxxxx` employee code per person, allocated by the server on the first
 *    persisted offer, never typed by HR, never reused for a second person;
 *  - offer versions and employment episodes are append-only; the UI never edits history;
 *  - offer status and employment status are separate axes;
 *  - all timestamps are ISO-8601 UTC strings, calendar dates are `YYYY-MM-DD`.
 */

export const EMPLOYEE_CODE_PATTERN = /^FQ-FE-\d{5}$/;

/** Offer document axis. SUPERSEDED is not a status: see `HrOfferVersion.supersededByVersion`. */
export const OFFER_STATUSES = ["DRAFT", "ISSUED", "SENT", "ACCEPTED", "DECLINED", "EXPIRED"] as const;
export type HrOfferStatus = (typeof OFFER_STATUSES)[number];

/** Employment axis of one employment episode. */
export const EPISODE_STATUSES = ["PENDING_JOIN", "NOT_JOINED", "ACTIVE", "EXITED"] as const;
export type HrEpisodeStatus = (typeof EPISODE_STATUSES)[number];

export type HrOfferKind = "FIRST" | "REOFFER" | "REHIRE";

export type HrActorRef = {
  id: string;
  displayName: string;
};

export type HrManagerRef = {
  /** EmployeeProfile id of the manager. */
  id: string;
  fullName: string;
  employeeCode: string;
};

/** Immutable commercial terms of one offer version. Calendar dates are `YYYY-MM-DD`. */
export type HrOfferTerms = {
  role: string;
  baseSalaryInr: number;
  salaryBasis: "monthly" | "annual";
  /** Both set together or both null: custom target + per-shop incentive beyond target. */
  salesTarget: number | null;
  incentiveBeyondTargetInr: number | null;
  proposedJoiningDate: string | null;
  reportingManager: HrManagerRef | null;
  city: string | null;
};

export type HrPdfEvent = {
  id: string;
  event: "GENERATED" | "REPRINTED";
  at: string;
  actor: HrActorRef;
  /** SHA-256 (hex) of the PDF bytes the browser produced; ties a download to exact content. */
  sha256: string;
  byteLength: number;
};

export type HrOfferDelivery = {
  /** Saved on the server (always true for a persisted version). */
  saved: true;
  /** Number of PDFs generated from this version, from the PDF history. */
  pdfCount: number;
  /** HR recorded that the letter was emailed. FastQue itself never sends the email. */
  emailedRecordedAt: string | null;
  /** True only when acceptance evidence is on record; a sent mail alone never implies this. */
  acceptanceProven: boolean;
};

export type HrOfferVersion = {
  id: string;
  personId: string;
  /** 1-based, contiguous per person. */
  version: number;
  kind: HrOfferKind;
  /**
   * REGISTER = created and stored by the register. HISTORICAL_IMPORT = a letter emailed before the
   * register existed: its original PDF and exact terms are not stored, so it can be listed but not reprinted.
   */
  source: "REGISTER" | "HISTORICAL_IMPORT";
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
  /** Version number of the later offer that replaced this one, or null while current. */
  supersededByVersion: number | null;
  employmentEpisodeId: string | null;
  statusReason: string | null;
};

export type HrEmploymentEpisode = {
  id: string;
  /** 1-based; >1 means a rehire. */
  episodeNumber: number;
  status: HrEpisodeStatus;
  originatingOfferVersion: number;
  joinedOn: string | null;
  exitedOn: string | null;
  notJoinedOn: string | null;
  statusReason: string | null;
};

export type HrSalaryHistoryEntry = {
  id: string;
  effectiveFrom: string;
  baseSalaryInr: number;
  salaryBasis: "monthly" | "annual";
  offerVersion: number | null;
  recordedAt: string;
  recordedBy: HrActorRef;
};

export type HrManagerHistoryEntry = {
  id: string;
  manager: HrManagerRef;
  from: string;
  to: string | null;
  offerVersion: number | null;
  recordedAt: string;
  recordedBy: HrActorRef;
};

/** Contact values are masked by the server; the web app never receives raw contacts in lists. */
export type HrPersonSummary = {
  id: string;
  employeeCode: string;
  fullName: string;
  maskedEmail: string | null;
  maskedPhone: string | null;
  city: string | null;
  reportingManager: HrManagerRef | null;
  firstOfferIssuedAt: string;
  latestOfferVersion: number;
  latestOfferStatus: HrOfferStatus;
  latestOfferIssuedAt: string;
  offerCount: number;
  currentEpisode: Pick<HrEmploymentEpisode, "id" | "episodeNumber" | "status" | "joinedOn" | "exitedOn"> | null;
  episodeCount: number;
  /** True when an EmployeeProfile + login exists for this code (set only by an approved joining). */
  hasEmployeeAccount: boolean;
  employeeProfileId: string | null;
  /** Where the identity came from: created by an offer, or linked from an existing profile. */
  origin: "OFFER" | "EXISTING_PROFILE" | "RECONCILIATION";
};

export type HrPersonDetail = HrPersonSummary & {
  offers: HrOfferVersion[];
  episodes: HrEmploymentEpisode[];
  salaryHistory: HrSalaryHistoryEntry[];
  managerHistory: HrManagerHistoryEntry[];
};

export const MATCH_REASONS = ["EXACT_CODE", "EMAIL", "PHONE", "NAME_EXACT", "NAME_SIMILAR", "PRIOR_OFFER"] as const;
export type HrMatchReason = (typeof MATCH_REASONS)[number];

export type HrMatchCandidate = {
  person: HrPersonSummary;
  reasons: HrMatchReason[];
  /** STRONG = exact code, or a shared contact plus a name signal. Never an authority to merge. */
  strength: "STRONG" | "WEAK";
};

export type HrMatchResult = {
  matches: HrMatchCandidate[];
  /** When true, creating a NEW identity is refused until HR records a reasoned override. */
  blocksNewIdentity: boolean;
  /** Opaque token binding this match review to the later create call. */
  decisionToken: string;
};

export type HrIdentityInput = {
  fullName: string;
  email?: string;
  phone?: string;
  address?: string;
};

export type HrMatchQuery = {
  fullName?: string;
  email?: string;
  phone?: string;
  employeeCode?: string;
};

export type HrOfferTermsInput = Omit<HrOfferTerms, "reportingManager" | "role"> & {
  role: string;
  reportingManagerId: string | null;
};

export type HrCreateOfferInput =
  | {
      identity: { mode: "NEW"; person: HrIdentityInput; decisionToken: string; overrideReason?: string };
      terms: HrOfferTermsInput;
    }
  | {
      identity: { mode: "EXISTING"; personId: string; decisionToken: string };
      terms: HrOfferTermsInput;
    };

export type HrCreateOfferResult = {
  person: HrPersonSummary;
  offer: HrOfferVersion;
  /** The server returns the contact values the PDF needs exactly once, for this saved version. */
  letter: { candidateName: string; email: string | null; phone: string | null; address: string | null };
};

export type HrOfferTransition = "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED";

export type HrRegisterFilters = {
  q: string;
  employeeCode: string;
  lifecycle: HrLifecycleFilter;
  offerStatus: HrOfferStatus | "ALL";
  city: string;
  managerId: string;
  issuedFrom: string;
  issuedTo: string;
};

export type HrLifecycleFilter =
  | "ALL"
  | "OFFERED"
  | "NOT_JOINED"
  | "ACTIVE"
  | "EXITED"
  | "REOFFERED"
  | "REJOINED";

export type HrRegisterPage = {
  items: HrPersonSummary[];
  nextCursor: string | null;
  total: number;
};

export type HrAuditEntry = {
  id: string;
  at: string;
  actor: HrActorRef;
  action: string;
  subject: { kind: "PERSON" | "OFFER" | "EPISODE" | "RECONCILIATION"; label: string };
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
};

export type HrAuditPage = {
  items: HrAuditEntry[];
  nextCursor: string | null;
};

export type HrReconciliationStatus = "UNVERIFIED" | "LINKED" | "IDENTITY_CREATED" | "DUPLICATE";

export type HrReconciliationItem = {
  id: string;
  source: "SENT_MAIL_AUDIT" | "PDF_REVIEW" | "MANUAL";
  sentOn: string;
  /** Masked by the server. Raw recipient addresses are never shown or stored in this app. */
  maskedRecipient: string;
  /** Candidate display name as read from the original letter, when available. */
  candidateLabel: string | null;
  /** Employee code printed on the original letter, if any. Unverified until HR links it. */
  printedEmployeeCode: string | null;
  /** True for the sent copy that was a forward/resend of another item. */
  possibleDuplicateOf: string | null;
  acceptanceEvidence: "NONE" | "NOTE";
  status: HrReconciliationStatus;
  linkedPerson: Pick<HrPersonSummary, "id" | "employeeCode" | "fullName"> | null;
};

export type HrReconciliationPage = {
  items: HrReconciliationItem[];
  nextCursor: string | null;
};

export type HrEmployeeOption = {
  id: string;
  fullName: string;
  employeeCode: string;
};
