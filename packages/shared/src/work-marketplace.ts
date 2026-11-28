import { z } from "zod";

/*
 * FastQue Work — the student and gig workforce marketplace (docs/work-marketplace/).
 *
 * This file holds only shapes and pure rules shared by the backend and the web app. The backend
 * re-checks every rule; nothing here is trusted because a client computed it. All money is integer
 * paise. No function in this file performs I/O.
 */

export const WORK_PATHS = {
  root: "work",
  categories: "categories",
  jobs: "jobs",
  me: "me",
  profile: "profile",
  dashboard: "dashboard",
  applications: "applications",
  assignments: "assignments",
  evidence: "evidence",
  orgs: "orgs",
  mine: "mine",
  draft: "draft",
  payments: "payments",
  webhook: "webhook",
  sandbox: "sandbox",
  admin: "admin",
} as const;

/** Error codes the API returns in `{ error: { code } }`. Clients branch on these, never on text. */
export const WorkErrorCode = {
  MARKETPLACE_DISABLED: "WORK_MARKETPLACE_DISABLED",
  NOT_FOUND: "WORK_NOT_FOUND",
  FORBIDDEN: "WORK_FORBIDDEN",
  INVALID_STATE: "WORK_INVALID_STATE",
  VALIDATION_FAILED: "WORK_VALIDATION_FAILED",
  ORG_NOT_VERIFIED: "WORK_ORG_NOT_VERIFIED",
  PROFILE_REQUIRED: "WORK_PROFILE_REQUIRED",
  NOT_ELIGIBLE: "WORK_NOT_ELIGIBLE",
  JOB_FULL: "WORK_JOB_FULL",
  ALREADY_ASSIGNED: "WORK_ALREADY_ASSIGNED",
  ALREADY_APPLIED: "WORK_ALREADY_APPLIED",
  SCHEDULE_CONFLICT: "WORK_SCHEDULE_CONFLICT",
  JOB_NOT_EDITABLE: "WORK_JOB_NOT_EDITABLE",
  CHECKLIST_INCOMPLETE: "WORK_CHECKLIST_INCOMPLETE",
  INVALID_CHECK_IN_CODE: "WORK_INVALID_CHECK_IN_CODE",
  EVIDENCE_INVALID: "WORK_EVIDENCE_INVALID",
  PAYMENTS_NOT_CONFIGURED: "WORK_PAYMENTS_NOT_CONFIGURED",
  SANDBOX_DISABLED: "WORK_SANDBOX_DISABLED",
  MANUAL_SETTLEMENT_DISABLED: "WORK_MANUAL_SETTLEMENT_DISABLED",
  UTR_ALREADY_USED: "WORK_UTR_ALREADY_USED",
  WEBHOOK_SIGNATURE_INVALID: "WORK_WEBHOOK_SIGNATURE_INVALID",
  AMOUNT_INVALID: "WORK_AMOUNT_INVALID",
} as const;
export type WorkErrorCode = (typeof WorkErrorCode)[keyof typeof WorkErrorCode];

// ---------------------------------------------------------------------------------------------
// Enums (mirrored 1:1 by Prisma enums in apps/backend/prisma/schema.prisma)
// ---------------------------------------------------------------------------------------------

export const WorkOrgStatus = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
  SUSPENDED: "SUSPENDED",
} as const;
export type WorkOrgStatus = (typeof WorkOrgStatus)[keyof typeof WorkOrgStatus];

export const WorkOrgMemberRole = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  BILLING: "BILLING",
} as const;
export type WorkOrgMemberRole = (typeof WorkOrgMemberRole)[keyof typeof WorkOrgMemberRole];

export const WorkOrgType = {
  INDIVIDUAL: "INDIVIDUAL",
  MSME: "MSME",
  STARTUP: "STARTUP",
  RETAIL: "RETAIL",
  RESTAURANT: "RESTAURANT",
  SALON: "SALON",
  EVENT_ORGANIZER: "EVENT_ORGANIZER",
  MARKETING_AGENCY: "MARKETING_AGENCY",
  ENTERPRISE: "ENTERPRISE",
  WORKFORCE_AGENCY: "WORKFORCE_AGENCY",
} as const;
export type WorkOrgType = (typeof WorkOrgType)[keyof typeof WorkOrgType];

export const WorkerType = {
  COLLEGE_STUDENT: "COLLEGE_STUDENT",
  GRADUATE: "GRADUATE",
  PART_TIME: "PART_TIME",
  FREELANCER: "FREELANCER",
  SKILLED_PROFESSIONAL: "SKILLED_PROFESSIONAL",
  FIELD_SALES: "FIELD_SALES",
  SHIFT_WORKER: "SHIFT_WORKER",
  DIGITAL_TASK: "DIGITAL_TASK",
} as const;
export type WorkerType = (typeof WorkerType)[keyof typeof WorkerType];

export const WORKER_TYPE_LABELS: Record<WorkerType, string> = {
  COLLEGE_STUDENT: "College student",
  GRADUATE: "Graduate",
  PART_TIME: "Part-time worker",
  FREELANCER: "Freelancer",
  SKILLED_PROFESSIONAL: "Skilled professional",
  FIELD_SALES: "Field sales executive",
  SHIFT_WORKER: "Temporary shift worker",
  DIGITAL_TASK: "Digital task worker",
};

/**
 * Progressive worker verification. Level 1 comes from the existing verified-phone login; level 2
 * is set by a platform reviewer after an eligibility check. Levels 3–4 (skills/certifications and
 * job-specific checks) are reserved — no flow grants them yet (see the backlog).
 */
export const WorkerVerificationLevel = {
  PHONE: 1,
  BASIC_ELIGIBILITY: 2,
  SKILLS: 3,
  JOB_SPECIFIC: 4,
} as const;

export const WorkJobStatus = {
  DRAFT: "DRAFT",
  PENDING_VERIFICATION: "PENDING_VERIFICATION",
  FUNDING_REQUIRED: "FUNDING_REQUIRED",
  OPEN: "OPEN",
  PARTIALLY_FILLED: "PARTIALLY_FILLED",
  FILLED: "FILLED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CLOSED: "CLOSED",
  PAUSED: "PAUSED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  REJECTED: "REJECTED",
} as const;
export type WorkJobStatus = (typeof WorkJobStatus)[keyof typeof WorkJobStatus];

export const WorkHiringMode = {
  INSTANT_ACCEPT: "INSTANT_ACCEPT",
  APPLY_AND_SELECT: "APPLY_AND_SELECT",
} as const;
export type WorkHiringMode = (typeof WorkHiringMode)[keyof typeof WorkHiringMode];

export const WorkPayType = {
  FIXED: "FIXED",
  PER_TASK: "PER_TASK",
  HOURLY: "HOURLY",
  DAILY: "DAILY",
} as const;
export type WorkPayType = (typeof WorkPayType)[keyof typeof WorkPayType];

export const WorkLocationType = {
  ON_SITE: "ON_SITE",
  REMOTE: "REMOTE",
  HYBRID: "HYBRID",
} as const;
export type WorkLocationType = (typeof WorkLocationType)[keyof typeof WorkLocationType];

export const WorkCheckInMethod = {
  QR_CODE: "QR_CODE",
  GPS: "GPS",
  EMPLOYER_CONFIRMED: "EMPLOYER_CONFIRMED",
  SELF_REPORTED: "SELF_REPORTED",
} as const;
export type WorkCheckInMethod = (typeof WorkCheckInMethod)[keyof typeof WorkCheckInMethod];

export const WorkApplicationStatus = {
  APPLIED: "APPLIED",
  OFFERED: "OFFERED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  DECLINED: "DECLINED",
  WITHDRAWN: "WITHDRAWN",
} as const;
export type WorkApplicationStatus = (typeof WorkApplicationStatus)[keyof typeof WorkApplicationStatus];

export const WorkAssignmentStatus = {
  ACCEPTED: "ACCEPTED",
  CHECKED_IN: "CHECKED_IN",
  SUBMITTED: "SUBMITTED",
  REWORK_REQUESTED: "REWORK_REQUESTED",
  DISPUTED: "DISPUTED",
  PAYABLE: "PAYABLE",
  PAID: "PAID",
  NO_SHOW_REVIEW: "NO_SHOW_REVIEW",
  WITHDRAWN: "WITHDRAWN",
  CANCELLED: "CANCELLED",
  CLOSED_UNPAID: "CLOSED_UNPAID",
} as const;
export type WorkAssignmentStatus = (typeof WorkAssignmentStatus)[keyof typeof WorkAssignmentStatus];

export const WorkFundingStatus = {
  CREATED: "CREATED",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
} as const;
export type WorkFundingStatus = (typeof WorkFundingStatus)[keyof typeof WorkFundingStatus];

export const WorkPayoutStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
} as const;
export type WorkPayoutStatus = (typeof WorkPayoutStatus)[keyof typeof WorkPayoutStatus];

export const WorkDisputeStatus = {
  OPEN: "OPEN",
  RESOLVED: "RESOLVED",
  WITHDRAWN: "WITHDRAWN",
} as const;
export type WorkDisputeStatus = (typeof WorkDisputeStatus)[keyof typeof WorkDisputeStatus];

export const WorkDisputeReason = {
  UNFAIR_REJECTION: "UNFAIR_REJECTION",
  PARTIAL_PAYMENT: "PARTIAL_PAYMENT",
  QUALITY_ISSUE: "QUALITY_ISSUE",
  NO_WORK_AVAILABLE: "NO_WORK_AVAILABLE",
  NO_SHOW: "NO_SHOW",
  UNSAFE_CONDITIONS: "UNSAFE_CONDITIONS",
  PAYMENT_PROBLEM: "PAYMENT_PROBLEM",
  OTHER: "OTHER",
} as const;
export type WorkDisputeReason = (typeof WorkDisputeReason)[keyof typeof WorkDisputeReason];

export const WORK_DISPUTE_REASON_LABELS: Record<WorkDisputeReason, string> = {
  UNFAIR_REJECTION: "Work was rejected unfairly",
  PARTIAL_PAYMENT: "Less pay was approved than agreed",
  QUALITY_ISSUE: "Work quality does not meet the job's conditions",
  NO_WORK_AVAILABLE: "I arrived but no work was available",
  NO_SHOW: "The worker did not arrive",
  UNSAFE_CONDITIONS: "Unsafe working conditions",
  PAYMENT_PROBLEM: "Payment problem",
  OTHER: "Something else",
};

/** Who an audit event or dispute party is acting as. */
export const WorkParty = {
  WORKER: "WORKER",
  EMPLOYER: "EMPLOYER",
  PLATFORM: "PLATFORM",
  SYSTEM: "SYSTEM",
} as const;
export type WorkParty = (typeof WorkParty)[keyof typeof WorkParty];

// ---------------------------------------------------------------------------------------------
// State machines. The backend applies every transition as a conditional UPDATE whose WHERE clause
// lists exactly these `from` states, so a stale or concurrent request cannot skip a step.
// ---------------------------------------------------------------------------------------------

export const WORK_JOB_TRANSITIONS: Record<WorkJobStatus, readonly WorkJobStatus[]> = {
  DRAFT: ["PENDING_VERIFICATION", "FUNDING_REQUIRED", "CANCELLED"],
  PENDING_VERIFICATION: ["FUNDING_REQUIRED", "REJECTED", "CANCELLED"],
  FUNDING_REQUIRED: ["OPEN", "CANCELLED", "EXPIRED"],
  OPEN: ["PARTIALLY_FILLED", "FILLED", "IN_PROGRESS", "PAUSED", "CANCELLED", "EXPIRED"],
  PARTIALLY_FILLED: ["OPEN", "FILLED", "IN_PROGRESS", "PAUSED", "CANCELLED", "COMPLETED"],
  FILLED: ["PARTIALLY_FILLED", "IN_PROGRESS", "CANCELLED", "COMPLETED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  PAUSED: ["OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELLED"],
  COMPLETED: ["CLOSED"],
  CANCELLED: ["CLOSED"],
  EXPIRED: ["CLOSED"],
  REJECTED: [],
  CLOSED: [],
};

export const WORK_ASSIGNMENT_TRANSITIONS: Record<WorkAssignmentStatus, readonly WorkAssignmentStatus[]> = {
  ACCEPTED: ["CHECKED_IN", "SUBMITTED", "WITHDRAWN", "CANCELLED", "NO_SHOW_REVIEW", "PAYABLE"],
  CHECKED_IN: ["SUBMITTED", "CANCELLED", "PAYABLE", "DISPUTED"],
  SUBMITTED: ["PAYABLE", "REWORK_REQUESTED", "DISPUTED"],
  REWORK_REQUESTED: ["SUBMITTED", "DISPUTED"],
  DISPUTED: ["PAYABLE", "CLOSED_UNPAID"],
  NO_SHOW_REVIEW: ["CHECKED_IN", "DISPUTED", "CLOSED_UNPAID", "CANCELLED"],
  PAYABLE: ["PAID"],
  PAID: [],
  WITHDRAWN: [],
  CANCELLED: [],
  CLOSED_UNPAID: [],
};

/** Assignment states that still hold one of the job's capacity slots. */
export const WORK_ASSIGNMENT_ACTIVE_STATUSES: readonly WorkAssignmentStatus[] = [
  "ACCEPTED",
  "CHECKED_IN",
  "SUBMITTED",
  "REWORK_REQUESTED",
  "DISPUTED",
  "NO_SHOW_REVIEW",
  "PAYABLE",
  "PAID",
];

/** States in which the worker's part is finished one way or another. */
export const WORK_ASSIGNMENT_TERMINAL_STATUSES: readonly WorkAssignmentStatus[] = [
  "PAID",
  "WITHDRAWN",
  "CANCELLED",
  "CLOSED_UNPAID",
];

/** Job states in which a worker can still take or apply for a slot. */
export const WORK_JOB_ACCEPTING_STATUSES: readonly WorkJobStatus[] = ["OPEN", "PARTIALLY_FILLED"];

/** Job states shown in the public marketplace. */
export const WORK_JOB_PUBLIC_STATUSES: readonly WorkJobStatus[] = ["OPEN", "PARTIALLY_FILLED", "FILLED", "IN_PROGRESS"];

export function canTransitionWorkJob(from: WorkJobStatus, to: WorkJobStatus): boolean {
  return WORK_JOB_TRANSITIONS[from].includes(to);
}

export function canTransitionWorkAssignment(from: WorkAssignmentStatus, to: WorkAssignmentStatus): boolean {
  return WORK_ASSIGNMENT_TRANSITIONS[from].includes(to);
}

/** Every state that may legally move to `to` — used to build race-safe conditional updates. */
export function workAssignmentSourcesFor(to: WorkAssignmentStatus): WorkAssignmentStatus[] {
  return (Object.keys(WORK_ASSIGNMENT_TRANSITIONS) as WorkAssignmentStatus[]).filter((from) =>
    WORK_ASSIGNMENT_TRANSITIONS[from].includes(to),
  );
}

export function workJobSourcesFor(to: WorkJobStatus): WorkJobStatus[] {
  return (Object.keys(WORK_JOB_TRANSITIONS) as WorkJobStatus[]).filter((from) => WORK_JOB_TRANSITIONS[from].includes(to));
}

/** Capacity status after the number of slot-holding assignments changes. */
export function workJobCapacityStatus(filled: number, positions: number): "OPEN" | "PARTIALLY_FILLED" | "FILLED" {
  if (filled <= 0) return "OPEN";
  if (filled >= positions) return "FILLED";
  return "PARTIALLY_FILLED";
}

// ---------------------------------------------------------------------------------------------
// Limits, fees and money
// ---------------------------------------------------------------------------------------------

export const WORK_LIMITS = {
  maxPositions: 200,
  minPayPerWorkerPaise: 100_00, // ₹100
  maxPayPerWorkerPaise: 50_000_00, // ₹50,000
  maxChecklistItems: 25,
  maxEvidenceBytes: 3 * 1024 * 1024,
  minAge: 18,
  maxFeeBps: 3_000,
  defaultFeeBps: 1_000,
  defaultReviewWindowHours: 72,
  minReviewWindowHours: 24,
  maxReviewWindowHours: 168,
  defaultWorkerLateCancelHours: 12,
  maxReworkRounds: 2,
  /** Check-in opens this long before the start time. */
  checkInEarlyMinutes: 60,
  /** An employer can flag a no-show only this long after the start time. */
  noShowGraceMinutes: 30,
  /** A no-show flag the worker does not dispute within this window is upheld. */
  noShowDisputeHours: 72,
  disputeSlaHours: 72,
} as const;

/** Platform fee on an amount of worker pay, rounded half up to the paisa. Charged to the employer. */
export function workPlatformFee(amountPaise: number, feeBps: number): number {
  if (!Number.isInteger(amountPaise) || amountPaise < 0) throw new Error("amount must be a non-negative integer");
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > WORK_LIMITS.maxFeeBps) throw new Error("fee out of range");
  return Math.floor((amountPaise * feeBps + 5_000) / 10_000);
}

export interface WorkJobQuote {
  positions: number;
  payPerWorkerPaise: number;
  feeBps: number;
  workerPayTotalPaise: number;
  platformFeeTotalPaise: number;
  /** What the employer funds before the job opens. Workers are never charged. */
  employerTotalPaise: number;
}

export function quoteWorkJob(positions: number, payPerWorkerPaise: number, feeBps: number): WorkJobQuote {
  if (!Number.isInteger(positions) || positions < 1 || positions > WORK_LIMITS.maxPositions) throw new Error("positions out of range");
  const perFee = workPlatformFee(payPerWorkerPaise, feeBps);
  return {
    positions,
    payPerWorkerPaise,
    feeBps,
    workerPayTotalPaise: positions * payPerWorkerPaise,
    platformFeeTotalPaise: positions * perFee,
    employerTotalPaise: positions * (payPerWorkerPaise + perFee),
  };
}

export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: paise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------------------------
// Checklist, cancellation terms
// ---------------------------------------------------------------------------------------------

export const workChecklistItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  label: z.string().trim().min(2).max(160),
  kind: z.enum(["CONFIRM", "TEXT", "PHOTO"]),
  required: z.boolean().default(true),
  /** A TEXT answer must not repeat another worker's answer on the same job (e.g. a shop phone). */
  uniqueAcrossJob: z.boolean().default(false),
});
export type WorkChecklistItem = z.infer<typeof workChecklistItemSchema>;

export const workCancellationTermsSchema = z.object({
  /** Worker may withdraw without it counting as a late cancellation up to this many hours before start. */
  workerLateCancelHours: z.number().int().min(0).max(72).default(WORK_LIMITS.defaultWorkerLateCancelHours),
  /** Paid to a worker who checked in when the employer then cancels. */
  employerCancelAfterArrivalPaise: z.number().int().min(0),
  /** Paid when the employer cancels inside the worker's late-cancel window but before arrival. */
  employerLateCancelPaise: z.number().int().min(0).default(0),
});
export type WorkCancellationTerms = z.infer<typeof workCancellationTermsSchema>;

// ---------------------------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------------------------

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const INDIAN_PHONE_RE = /^\+91[6-9][0-9]{9}$/;

export const workOrgUpsertSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  displayName: z.string().trim().min(2).max(80),
  orgType: z.nativeEnum(WorkOrgType),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_RE, "GSTIN must be 15 characters in the official format")
    .optional()
    .nullable(),
  registeredAddress: z.string().trim().min(8).max(300),
  city: z.string().trim().min(2).max(80),
  contactName: z.string().trim().min(2).max(120),
  contactPhone: z.string().trim().regex(INDIAN_PHONE_RE, "Use +91 followed by a 10-digit mobile number"),
  contactEmail: z.string().trim().email().max(160),
});
export type WorkOrgUpsertInput = z.infer<typeof workOrgUpsertSchema>;

export const workerPayoutBankSchema = z.object({
  accountNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, ""))
    .pipe(z.string().regex(/^\d{9,18}$/, "Enter the 9 to 18 digit bank account number")),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid 11-character IFSC, like SBIN0001234"),
  accountName: z.string().trim().min(2, "Enter the name on the bank account").max(120),
});
export type WorkerPayoutBankInput = z.infer<typeof workerPayoutBankSchema>;

/** Bank UTR / reference number: letters and digits only, as printed on the bank statement. */
const utrSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6,30}$/, "Enter the UTR exactly as on the bank statement (6 to 30 letters and digits)");

/** Platform admin confirms (or rejects) an employer's manual bank transfer. */
export const workManualFundingConfirmSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("RECEIVED"), utr: utrSchema, amountPaise: z.number().int().positive() }),
  z.object({ outcome: z.literal("NOT_RECEIVED"), reason: z.string().trim().min(5).max(200) }),
]);
export type WorkManualFundingConfirmInput = z.infer<typeof workManualFundingConfirmSchema>;

/** Platform admin records the result of a NEFT payout sent from the company account. */
export const workManualPayoutConfirmSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("PAID"), utr: utrSchema }),
  z.object({ outcome: z.literal("FAILED"), reason: z.string().trim().min(5).max(200) }),
]);
export type WorkManualPayoutConfirmInput = z.infer<typeof workManualPayoutConfirmSchema>;

export const workerProfileUpsertSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  workerType: z.nativeEnum(WorkerType),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  city: z.string().trim().min(2).max(80),
  locality: z.string().trim().max(80).optional().nullable(),
  workRadiusKm: z.number().int().min(1).max(100).default(10),
  languages: z.array(z.string().trim().min(2).max(30)).max(8).default([]),
  skills: z.array(z.string().trim().toLowerCase().min(2).max(40)).max(25).default([]),
  preferredCategories: z.array(z.string().trim().max(60)).max(20).default([]),
  collegeName: z.string().trim().max(160).optional().nullable(),
  bio: z.string().trim().max(600).optional().nullable(),
  /** UPI VPA used by the payout provider. Shown to employers never; masked everywhere else. */
  payoutUpiVpa: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.\-_]{2,64}@[a-z][a-z0-9]{1,32}$/, "Enter a UPI ID like name@bank")
    .optional()
    .nullable(),
  /**
   * Bank account for NEFT payouts. Leaving it out keeps the saved one; null removes it. The
   * account number is encrypted at rest and never returned in full to anyone but finance exports.
   */
  payoutBank: workerPayoutBankSchema.optional().nullable(),
});
export type WorkerProfileUpsertInput = z.infer<typeof workerProfileUpsertSchema>;

const isoDateTime = z.string().datetime({ offset: true });

export const workJobUpsertSchema = z
  .object({
    categorySlug: z.string().trim().min(2).max(60),
    title: z.string().trim().min(6).max(120),
    description: z.string().trim().min(30).max(4000),
    locationType: z.nativeEnum(WorkLocationType),
    addressLine: z.string().trim().max(300).optional().nullable(),
    city: z.string().trim().min(2).max(80),
    locality: z.string().trim().max(80).optional().nullable(),
    positions: z.number().int().min(1).max(WORK_LIMITS.maxPositions),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    applicationDeadline: isoDateTime.optional().nullable(),
    payType: z.nativeEnum(WorkPayType),
    /** Guaranteed pay per worker for the whole assignment. Bonuses are described separately and never included. */
    payPerWorkerPaise: z.number().int().min(WORK_LIMITS.minPayPerWorkerPaise).max(WORK_LIMITS.maxPayPerWorkerPaise),
    bonusDescription: z.string().trim().max(300).optional().nullable(),
    minAge: z.number().int().min(WORK_LIMITS.minAge).max(70).default(WORK_LIMITS.minAge),
    minVerificationLevel: z.number().int().min(1).max(2).default(1),
    requiredSkills: z.array(z.string().trim().toLowerCase().min(2).max(40)).max(15).default([]),
    languages: z.array(z.string().trim().min(2).max(30)).max(8).default([]),
    hiringMode: z.nativeEnum(WorkHiringMode),
    requiresCheckIn: z.boolean().default(true),
    checklist: z.array(workChecklistItemSchema).min(1).max(WORK_LIMITS.maxChecklistItems),
    completionCriteria: z.string().trim().min(10).max(1000),
    cancellationTerms: workCancellationTermsSchema,
    reviewWindowHours: z
      .number()
      .int()
      .min(WORK_LIMITS.minReviewWindowHours)
      .max(WORK_LIMITS.maxReviewWindowHours)
      .default(WORK_LIMITS.defaultReviewWindowHours),
  })
  .superRefine((job, ctx) => {
    if (new Date(job.endsAt).getTime() <= new Date(job.startsAt).getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "End time must be after start time" });
    }
    if (job.applicationDeadline && new Date(job.applicationDeadline).getTime() > new Date(job.startsAt).getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["applicationDeadline"], message: "Applications must close before the work starts" });
    }
    if (job.locationType !== "REMOTE" && !job.addressLine) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["addressLine"], message: "On-site and hybrid work needs an address or service area" });
    }
    const ids = new Set<string>();
    for (const item of job.checklist) {
      if (ids.has(item.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checklist"], message: `Duplicate checklist item id ${item.id}` });
      ids.add(item.id);
    }
    if (job.cancellationTerms.employerCancelAfterArrivalPaise > job.payPerWorkerPaise) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cancellationTerms"], message: "Arrival compensation cannot exceed the worker pay" });
    }
    if (job.cancellationTerms.employerLateCancelPaise > job.payPerWorkerPaise) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cancellationTerms"], message: "Late-cancel compensation cannot exceed the worker pay" });
    }
  });
export type WorkJobUpsertInput = z.infer<typeof workJobUpsertSchema>;

export const workCheckInSchema = z.object({
  method: z.enum(["QR_CODE", "GPS", "SELF_REPORTED"]),
  code: z.string().trim().max(32).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  /** Explicit consent to record this one location reading. Never collected in the background. */
  locationConsent: z.boolean().optional(),
});
export type WorkCheckInInput = z.infer<typeof workCheckInSchema>;

export const workTaskResponseSchema = z.object({
  confirmed: z.boolean().optional(),
  text: z.string().trim().max(2000).optional(),
});

/**
 * An employer approves the full agreed pay or asks for rework (at most WORK_LIMITS.maxReworkRounds
 * times). Paying less than agreed is never a unilateral employer decision: it goes through a
 * dispute that a platform reviewer resolves.
 */
export const workReviewSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("APPROVE"), note: z.string().trim().max(1000).optional() }),
  z.object({ decision: z.literal("REQUEST_REWORK"), note: z.string().trim().min(5).max(1000) }),
]);
export type WorkReviewInput = z.infer<typeof workReviewSchema>;

export const workDisputeOpenSchema = z.object({
  reasonCode: z.nativeEnum(WorkDisputeReason),
  description: z.string().trim().min(10).max(2000),
});

export const workDisputeResolveSchema = z.object({
  awardPaise: z.number().int().min(0),
  note: z.string().trim().min(5).max(2000),
});

export const workCancelSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const workOrgReviewSchema = z.object({
  decision: z.enum(["MARK_UNDER_REVIEW", "VERIFY", "REJECT", "SUSPEND"]),
  reason: z.string().trim().max(1000).optional(),
});

export const workJobModerationSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().max(1000).optional(),
});

export const workSandboxPayoutSettleSchema = z.object({ outcome: z.enum(["SUCCEEDED", "FAILED"]), failureReason: z.string().max(200).optional() });

export const workJobSearchSchema = z.object({
  q: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  category: z.string().trim().max(60).optional(),
  minPayPaise: z.coerce.number().int().min(0).optional(),
  locationType: z.nativeEnum(WorkLocationType).optional(),
  instantOnly: z.enum(["true", "false"]).optional(),
  cursor: z.string().uuid().optional(),
});

export const workDraftRequestSchema = z.object({ text: z.string().trim().min(10).max(2000) });

// ---------------------------------------------------------------------------------------------
// Eligibility (explainable: every failed rule is returned, never a hidden score)
// ---------------------------------------------------------------------------------------------

export interface WorkEligibilityInput {
  now: Date;
  job: {
    status: WorkJobStatus;
    startsAt: Date;
    applicationDeadline: Date | null;
    minAge: number;
    minVerificationLevel: number;
    requiredSkills: string[];
  };
  worker: {
    dateOfBirth: Date;
    verificationLevel: number;
    skills: string[];
    isOrgMember: boolean;
    suspended: boolean;
  };
}

export type WorkIneligibleReason =
  | "JOB_NOT_ACCEPTING"
  | "DEADLINE_PASSED"
  | "UNDER_MIN_AGE"
  | "VERIFICATION_LEVEL"
  | "MISSING_SKILLS"
  | "OWN_ORGANIZATION"
  | "WORKER_SUSPENDED";

export const WORK_INELIGIBLE_LABELS: Record<WorkIneligibleReason, string> = {
  JOB_NOT_ACCEPTING: "This job is not taking workers right now.",
  DEADLINE_PASSED: "Applications for this job have closed.",
  UNDER_MIN_AGE: "You don't meet this job's minimum age.",
  VERIFICATION_LEVEL: "This job needs a verified eligibility check on your profile.",
  MISSING_SKILLS: "Your profile is missing a skill this job requires.",
  OWN_ORGANIZATION: "You can't take work posted by your own business.",
  WORKER_SUSPENDED: "Your worker account is on hold. Contact support.",
};

export function ageOn(dateOfBirth: Date, on: Date): number {
  let age = on.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const m = on.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < dateOfBirth.getUTCDate())) age -= 1;
  return age;
}

export function evaluateWorkEligibility(input: WorkEligibilityInput): { eligible: boolean; reasons: WorkIneligibleReason[]; missingSkills: string[] } {
  const reasons: WorkIneligibleReason[] = [];
  const { job, worker, now } = input;
  if (!WORK_JOB_ACCEPTING_STATUSES.includes(job.status)) reasons.push("JOB_NOT_ACCEPTING");
  const closesAt = job.applicationDeadline ?? job.startsAt;
  if (now.getTime() >= closesAt.getTime()) reasons.push("DEADLINE_PASSED");
  if (ageOn(worker.dateOfBirth, now) < Math.max(job.minAge, WORK_LIMITS.minAge)) reasons.push("UNDER_MIN_AGE");
  if (worker.verificationLevel < job.minVerificationLevel) reasons.push("VERIFICATION_LEVEL");
  const have = new Set(worker.skills.map((s) => s.toLowerCase()));
  const missingSkills = job.requiredSkills.filter((s) => !have.has(s.toLowerCase()));
  if (missingSkills.length) reasons.push("MISSING_SKILLS");
  if (worker.isOrgMember) reasons.push("OWN_ORGANIZATION");
  if (worker.suspended) reasons.push("WORKER_SUSPENDED");
  return { eligible: reasons.length === 0, reasons, missingSkills };
}

// ---------------------------------------------------------------------------------------------
// Anti-scam screening. Deterministic rules; a match sends the job to human review, it never
// silently publishes or silently deletes. Workers must never pay to work.
// ---------------------------------------------------------------------------------------------

const SCREENING_RULES: { code: string; label: string; pattern: RegExp }[] = [
  { code: "WORKER_DEPOSIT", label: "Asks workers for a deposit or fee", pattern: /\b(security|refundable)?\s*deposit\b|\bregistration\s+(fee|charge)s?\b|\b(joining|training|kit|application)\s+(fee|charge)s?\b|\bpay\s+(to|before)\s+(apply|join|start)\b/i },
  { code: "MONEY_TRANSFER", label: "Asks workers to move money for others", pattern: /\b(transfer|send|receive|deposit)\s+(money|funds|cash)\s+(for|to|from)\s+(others|clients|third|customers)\b|\bmoney\s+mule\b|\b(use|lend|share)\s+your\s+(bank|upi)\s+account\b/i },
  { code: "INVESTMENT_SCHEME", label: "Investment, crypto or trading scheme", pattern: /\b(crypto|bitcoin|forex|trading\s+tasks?|investment\s+plan|double\s+your\s+money|ponzi|mlm|chain\s+marketing)\b/i },
  { code: "PERSONAL_DATA", label: "Collects identity documents or credentials", pattern: /\b(aadhaar|aadhar|pan\s+card|otp|password|atm\s+pin|cvv)\b.{0,40}\b(collect|share|send|give|submit)\b|\b(collect|share|send|give|submit)\b.{0,40}\b(aadhaar|aadhar|pan\s+card|otp|password|atm\s+pin|cvv)\b/i },
  { code: "FAKE_ENGAGEMENT", label: "Fake reviews, likes or accounts", pattern: /\b(fake|paid)\s+(reviews?|ratings?|likes|followers|accounts?)\b|\bwrite\s+\d*\s*(five|5)[-\s]?star\s+reviews?\b/i },
  { code: "GUARANTEED_RICHES", label: "Unrealistic earnings promise", pattern: /\b(earn|make)\s+(₹|rs\.?|inr)?\s?\d[\d,]*\s*(lakh|lakhs|crore)\b|\bguaranteed\s+(income|returns?)\b|\bunlimited\s+earnings?\b/i },
];

export interface WorkScreeningResult {
  flagged: boolean;
  flags: { code: string; label: string }[];
}

export function screenWorkJob(text: { title: string; description: string; completionCriteria?: string; bonusDescription?: string | null; checklistLabels?: string[] }): WorkScreeningResult {
  const haystack = [text.title, text.description, text.completionCriteria ?? "", text.bonusDescription ?? "", ...(text.checklistLabels ?? [])].join("\n");
  const flags = SCREENING_RULES.filter((r) => r.pattern.test(haystack)).map(({ code, label }) => ({ code, label }));
  return { flagged: flags.length > 0, flags };
}

// ---------------------------------------------------------------------------------------------
// Smart draft: a deterministic parser that turns a sentence into a partial job draft and lists
// what is still missing. It never invents pay, locations, eligibility or acceptance criteria — a
// field it cannot read from the text is reported missing, not guessed.
// ---------------------------------------------------------------------------------------------

export interface WorkJobDraft {
  fields: Partial<{
    positions: number;
    payPerWorkerPaise: number;
    payType: WorkPayType;
    city: string;
    startTime: string;
    endTime: string;
    dateHint: "today" | "tomorrow" | string;
    title: string;
    checklist: { id: string; label: string; kind: "CONFIRM" }[];
  }>;
  missing: string[];
  source: "rules";
}

const KNOWN_CITIES = [
  "Greater Noida", "Noida", "Delhi", "New Delhi", "Gurugram", "Gurgaon", "Ghaziabad", "Faridabad", "Mumbai", "Pune", "Bengaluru", "Bangalore",
  "Hyderabad", "Chennai", "Kolkata", "Ahmedabad", "Jaipur", "Lucknow", "Chandigarh", "Indore", "Kochi", "Surat", "Nagpur", "Bhubaneswar",
];

function to24h(h: number, m: number, mer: string | undefined): string | null {
  let hour = h;
  if (mer) {
    const pm = mer.toLowerCase().startsWith("p");
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  if (hour > 23 || m > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function draftWorkJobFromText(text: string): WorkJobDraft {
  const fields: WorkJobDraft["fields"] = {};
  const t = text.replace(/\s+/g, " ");

  const count = /\b(\d{1,3})\s+(students?|workers?|people|persons|candidates|promoters|executives|helpers|staff)\b/i.exec(t);
  if (count) fields.positions = Number(count[1]);

  const pay = /(?:₹|rs\.?|inr)\s?(\d[\d,]*)(?:\s*(per|\/|a|each)\s*(completed\s+)?(assignment|task|day|hour|hr|shift|visit|worker|person))?/i.exec(t);
  if (pay) {
    fields.payPerWorkerPaise = Number(pay[1].replace(/,/g, "")) * 100;
    const unit = (pay[4] ?? "").toLowerCase();
    if (unit === "hour" || unit === "hr") fields.payType = "HOURLY";
    else if (unit === "day" || unit === "shift") fields.payType = "DAILY";
    else if (unit === "task" || unit === "assignment" || unit === "visit") fields.payType = "PER_TASK";
    else if (unit) fields.payType = "FIXED";
  }

  const city = KNOWN_CITIES.find((c) => new RegExp(`\\b${c.replace(" ", "\\s+")}\\b`, "i").test(t));
  if (city) fields.city = city === "Bangalore" ? "Bengaluru" : city === "Gurgaon" ? "Gurugram" : city;

  // "between 10 AM and 4 PM" is read first; "and" is only a range separator after "between".
  const range =
    /\bbetween\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*and\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(t) ??
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|till|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(t);
  if (range) {
    const endMer = range[6];
    const startMer = range[3] ?? (Number(range[1]) > Number(range[4]) ? "am" : endMer);
    const s = to24h(Number(range[1]), Number(range[2] ?? 0), startMer);
    const e = to24h(Number(range[4]), Number(range[5] ?? 0), endMer);
    if (s) fields.startTime = s;
    if (e) fields.endTime = e;
  }

  if (/\btomorrow\b/i.test(t)) fields.dateHint = "tomorrow";
  else if (/\btoday\b/i.test(t)) fields.dateHint = "today";
  else {
    const dated = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.exec(t);
    if (dated) fields.dateHint = `${dated[1]} ${dated[2]}`;
  }

  const toClause = /\bto\s+(.+?)(?:\.\s|\.$|\bpay\b|$)/i.exec(t.replace(/\d{1,2}(:\d{2})?\s*(am|pm)\s*(to|-)\s*\d{1,2}(:\d{2})?\s*(am|pm)/gi, ""));
  if (toClause) {
    const steps = toClause[1]
      .split(/,\s*(?:and\s+)?|\s+and\s+/i)
      .map((s) => s.trim().replace(/[.]+$/, ""))
      .filter((s) => s.length >= 4 && s.length <= 120);
    if (steps.length) {
      fields.checklist = steps.slice(0, 12).map((label, i) => ({
        id: `step-${i + 1}`,
        label: label.charAt(0).toUpperCase() + label.slice(1),
        kind: "CONFIRM" as const,
      }));
      const lead = steps[0];
      if (lead) fields.title = (lead.charAt(0).toUpperCase() + lead.slice(1)).slice(0, 80);
    }
  }

  const missing: string[] = [];
  if (!fields.positions) missing.push("Number of workers");
  if (!fields.payPerWorkerPaise) missing.push("Guaranteed pay per worker");
  if (!fields.city) missing.push("City / work location");
  if (!fields.startTime || !fields.endTime) missing.push("Start and end time");
  if (!fields.dateHint) missing.push("Work date");
  if (!fields.checklist?.length) missing.push("Task checklist");
  missing.push("Exact address or service area", "Completion criteria", "Cancellation compensation");
  return { fields, missing, source: "rules" };
}

// ---------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------

export interface WorkCategoryDto {
  slug: string;
  name: string;
  description: string | null;
}

export interface WorkEmployerTrustDto {
  orgId: string;
  displayName: string;
  verified: boolean;
  completedAssignments: number;
  /** Share of approved work paid within the review window — null until there is history. */
  onTimeReviewRate: number | null;
  employerCancellations: number;
}

export interface WorkJobCardDto {
  id: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  employer: WorkEmployerTrustDto;
  city: string;
  locality: string | null;
  locationType: WorkLocationType;
  startsAt: string;
  endsAt: string;
  payType: WorkPayType;
  payPerWorkerPaise: number;
  bonusDescription: string | null;
  positions: number;
  slotsLeft: number;
  hiringMode: WorkHiringMode;
  status: WorkJobStatus;
  /** True only when the employer's funding for every slot has been confirmed by the payment provider. */
  funded: boolean;
  minAge: number;
  minVerificationLevel: number;
  requiredSkills: string[];
}

export interface WorkJobDetailDto extends WorkJobCardDto {
  description: string;
  addressLine: string | null;
  applicationDeadline: string | null;
  languages: string[];
  requiresCheckIn: boolean;
  checklist: WorkChecklistItem[];
  completionCriteria: string;
  cancellationTerms: WorkCancellationTerms;
  reviewWindowHours: number;
  /** Present when the caller is a signed-in worker with a profile. */
  viewer?: {
    hasProfile: boolean;
    eligible: boolean;
    reasons: WorkIneligibleReason[];
    missingSkills: string[];
    assignmentId: string | null;
    applicationId: string | null;
    applicationStatus: WorkApplicationStatus | null;
  };
}

export interface WorkerProfileDto {
  userId: string;
  fullName: string;
  workerType: WorkerType;
  dateOfBirth: string;
  city: string;
  locality: string | null;
  workRadiusKm: number;
  languages: string[];
  skills: string[];
  preferredCategories: string[];
  collegeName: string | null;
  bio: string | null;
  verificationLevel: number;
  payoutUpiVpaMasked: string | null;
  /** Saved NEFT payout account, masked (only the last 4 digits of the account number). */
  payoutBankMasked: { accountName: string; ifsc: string; last4: string } | null;
  /** What FastQue pays out with right now: a UPI ID, or a bank account (NEFT). */
  payoutMethod: "UPI" | "BANK";
  /** True when the saved details are enough for the active payout method. */
  canBePaid: boolean;
  phoneVerified: boolean;
}

export interface WorkAssignmentSummaryDto {
  id: string;
  jobId: string;
  jobTitle: string;
  employerName: string;
  city: string;
  startsAt: string;
  endsAt: string;
  status: WorkAssignmentStatus;
  agreedPayPaise: number;
  approvedAmountPaise: number | null;
  payoutStatus: WorkPayoutStatus | null;
}

export interface WorkTaskResponseDto {
  itemId: string;
  confirmed: boolean;
  text: string | null;
  evidenceFileId: string | null;
  /** Set when the same photo or unique answer was already submitted on another assignment. Shown to reviewers; never auto-rejects. */
  duplicateFlag: boolean;
  updatedAt: string;
}

export interface WorkAuditEventDto {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorParty: WorkParty;
  note: string | null;
  createdAt: string;
}

export interface WorkDisputeDto {
  id: string;
  assignmentId: string;
  openedBy: WorkParty;
  reasonCode: WorkDisputeReason;
  description: string;
  status: WorkDisputeStatus;
  awardPaise: number | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface WorkAssignmentDetailDto extends WorkAssignmentSummaryDto {
  slotNumber: number;
  job: WorkJobDetailDto;
  worker: { userId: string; fullName: string; verificationLevel: number; completedAssignments: number };
  checkedInAt: string | null;
  checkInMethod: WorkCheckInMethod | null;
  submittedAt: string | null;
  reviewDueAt: string | null;
  reviewNote: string | null;
  responses: WorkTaskResponseDto[];
  disputes: WorkDisputeDto[];
  timeline: WorkAuditEventDto[];
  /** Only returned to the employer: today's check-in code to show workers on site. */
  checkInCode?: string;
}

export interface WorkerEarningsDto {
  /** Sum of approved amounts still owed to the worker (ledger: worker payable balance). */
  payablePaise: number;
  /** Sum of payouts the provider confirmed. */
  paidPaise: number;
  /** Agreed pay on accepted work not yet reviewed. Not money owed yet. */
  pendingReviewPaise: number;
  transactions: { id: string; kind: string; amountPaise: number; createdAt: string; assignmentId: string | null; jobTitle: string | null }[];
}

export interface WorkerReliabilityDto {
  completed: number;
  lateCancellations: number;
  noShows: number;
  /** Explainable: completed / (completed + late cancellations + upheld no-shows). Null with no history. */
  reliabilityRate: number | null;
}

export interface WorkerDashboardDto {
  profile: WorkerProfileDto | null;
  today: WorkAssignmentSummaryDto[];
  upcoming: WorkAssignmentSummaryDto[];
  awaitingReview: WorkAssignmentSummaryDto[];
  completed: WorkAssignmentSummaryDto[];
  applications: { id: string; jobId: string; jobTitle: string; status: WorkApplicationStatus; createdAt: string }[];
  earnings: WorkerEarningsDto;
  reliability: WorkerReliabilityDto;
}

export interface WorkOrgDto {
  id: string;
  legalName: string;
  displayName: string;
  orgType: WorkOrgType;
  gstin: string | null;
  registeredAddress: string;
  city: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  status: WorkOrgStatus;
  rejectionReason: string | null;
  myRole: WorkOrgMemberRole | null;
  createdAt: string;
}

export interface WorkFundingDto {
  id: string;
  status: WorkFundingStatus;
  amountPaise: number;
  provider: string;
  providerOrderId: string;
  sandbox: boolean;
  /**
   * Manual bank transfer only: where to send the money and the reference to quote. The job opens
   * once FastQue finance confirms the transfer on the bank statement.
   */
  manualBank: { accountName: string; accountNumber: string; ifsc: string; bankName: string; reference: string } | null;
  createdAt: string;
}

export interface WorkEmployerJobDto extends WorkJobDetailDto {
  /** Echo this back when publishing or funding, so the employer approves exactly what they saw. */
  version: number;
  quote: WorkJobQuote;
  screeningFlags: { code: string; label: string }[];
  moderationNote: string | null;
  funding: WorkFundingDto | null;
  applications: { id: string; workerUserId: string; workerName: string; verificationLevel: number; completedAssignments: number; status: WorkApplicationStatus; note: string | null; createdAt: string }[];
  assignments: (WorkAssignmentSummaryDto & { workerName: string; slotNumber: number; duplicateFlags: number })[];
  checkInCode: string | null;
}

export interface WorkOrgReportDto {
  orgId: string;
  fundedPaise: number;
  workerPayApprovedPaise: number;
  platformFeesPaise: number;
  releasedToEmployerPaise: number;
  /** Funded money still committed to open work (provider-held, not yet paid or released). */
  committedPaise: number;
  paidOutPaise: number;
  owedToWorkersPaise: number;
  jobs: { id: string; title: string; status: WorkJobStatus; positions: number; filled: number; approved: number; paid: number }[];
}

export interface WorkAdminOverviewDto {
  workers: number;
  verifiedWorkers: number;
  orgs: Record<WorkOrgStatus, number>;
  jobs: Partial<Record<WorkJobStatus, number>>;
  assignments: Partial<Record<WorkAssignmentStatus, number>>;
  grossFundedPaise: number;
  platformFeesPaise: number;
  workerPayoutLiabilityPaise: number;
  paidOutPaise: number;
  payoutSuccessRate: number | null;
  openDisputes: number;
  pendingKyc: number;
  jobsAwaitingModeration: number;
  ledgerBalanced: boolean;
}

export interface WorkLedgerTrialBalanceDto {
  balanced: boolean;
  unbalancedJournals: string[];
  accounts: { accountCode: string; balancePaise: number }[];
  providerHeldPaise: number;
  sumOfObligationsPaise: number;
}
