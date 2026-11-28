import { z } from "zod";
import { CrmLeadSource, CrmLeadStatus } from "./enums";

// FastQue Employee CRM 2.0 — field sales CRM shared by the employee portal (/employee) and the
// manager/admin views. Every module hangs off ONE lead record (employee_crm_leads). All numbers
// shown anywhere come from persisted rows; KPI formulas are defined once, here (CRM_KPI_DEFINITIONS).

export const CRM_PATHS = {
  /** All CRM 2.0 routes live under crm/ (scope is decided server-side from the caller's role). */
  root: "crm",
  me: "me",
  dashboard: "dashboard",
  leads: "leads",
  assign: "assign",
  bulkAssign: "leads/bulk-assign",
  timeline: "timeline",
  notes: "notes",
  importPreview: "leads/import/preview",
  importCommit: "commit",
  imports: "leads/imports",
  importTemplate: "leads/import/template.csv",
  employees: "employees",
  tasks: "tasks",
  meetings: "meetings",
  calls: "calls",
  callQueue: "calls/queue",
  recordings: "recordings",
  audio: "audio",
  analyze: "analyze",
  review: "review",
  aiStatus: "ai/status",
  tickets: "tickets",
  comments: "comments",
  attachments: "attachments",
  analytics: "analytics",
  notifications: "notifications",
  announcements: "announcements",
  video: "video",
} as const;

// ---------- Lead statuses (configurable labels + order; values are the shared enum) ----------

/** Label + pipeline group for every lead status. Existing values keep working; CRM 2.0 relabels a few. */
export const CRM_LEAD_STATUS_META: Record<CrmLeadStatus, { label: string; group: "OPEN" | "WORKING" | "PIPELINE" | "WON" | "CLOSED"; order: number }> = {
  NEW: { label: "New", group: "OPEN", order: 1 },
  ASSIGNED: { label: "Assigned", group: "OPEN", order: 2 },
  CALL_PENDING: { label: "Call pending", group: "OPEN", order: 3 },
  CONTACT_ATTEMPTED: { label: "Contact attempted", group: "WORKING", order: 4 },
  NO_ANSWER: { label: "No answer", group: "WORKING", order: 5 },
  CALLBACK_REQUESTED: { label: "Callback requested", group: "WORKING", order: 6 },
  CONTACTED: { label: "Contacted", group: "WORKING", order: 7 },
  INTERESTED: { label: "Interested", group: "PIPELINE", order: 8 },
  DEMO_SCHEDULED: { label: "Meeting scheduled", group: "PIPELINE", order: 9 },
  MEETING_COMPLETED: { label: "Meeting completed", group: "PIPELINE", order: 10 },
  FOLLOW_UP: { label: "Follow-up required", group: "PIPELINE", order: 11 },
  ONBOARDING_STARTED: { label: "Onboarding started", group: "PIPELINE", order: 12 },
  PENDING_APPROVAL: { label: "Pending approval", group: "PIPELINE", order: 13 },
  APPROVED: { label: "Approved", group: "WON", order: 14 },
  ONBOARDED: { label: "Activated", group: "WON", order: 15 },
  LOST: { label: "Not interested", group: "CLOSED", order: 16 },
  REJECTED: { label: "Rejected", group: "CLOSED", order: 17 },
  DUPLICATE: { label: "Duplicate", group: "CLOSED", order: 18 },
  INVALID_CONTACT: { label: "Invalid contact", group: "CLOSED", order: 19 },
};
export const CRM_LEAD_STATUSES = (Object.keys(CRM_LEAD_STATUS_META) as CrmLeadStatus[]).sort((a, b) => CRM_LEAD_STATUS_META[a].order - CRM_LEAD_STATUS_META[b].order);

/**
 * Statuses an employee may set by hand. Onboarding/approval/activation statuses are driven by the
 * onboarding workflow (and admins), never typed in by the salesperson. Any manual status may move
 * to any other manual status — follow-up work is not a straight line.
 */
export const CRM_MANUAL_LEAD_STATUSES: readonly CrmLeadStatus[] = [
  "NEW", "ASSIGNED", "CALL_PENDING", "CONTACT_ATTEMPTED", "NO_ANSWER", "CALLBACK_REQUESTED", "CONTACTED",
  "INTERESTED", "DEMO_SCHEDULED", "MEETING_COMPLETED", "FOLLOW_UP", "LOST", "DUPLICATE", "INVALID_CONTACT",
];
/** Once submitted, only managers/admins may move the lead by hand. */
export const CRM_WORKFLOW_LOCKED_STATUSES: readonly CrmLeadStatus[] = ["PENDING_APPROVAL", "APPROVED", "ONBOARDED"];
/** Statuses that are milestones of the onboarding workflow (set by the system or an admin). */
export const CRM_WORKFLOW_LEAD_STATUSES: readonly CrmLeadStatus[] = ["ONBOARDING_STARTED", "PENDING_APPROVAL", "APPROVED", "ONBOARDED", "REJECTED"];

export const CrmLeadPriority = { LOW: "LOW", NORMAL: "NORMAL", HIGH: "HIGH", URGENT: "URGENT" } as const;
export type CrmLeadPriority = (typeof CrmLeadPriority)[keyof typeof CrmLeadPriority];

export const CRM_BUSINESS_TYPES = ["BARBER", "SALON", "UNISEX_SALON", "SPA", "BEAUTY_PARLOUR", "NAIL_STUDIO", "OTHER"] as const;
export const CRM_BUSINESS_TYPE_LABEL: Record<(typeof CRM_BUSINESS_TYPES)[number], string> = {
  BARBER: "Barber shop", SALON: "Salon", UNISEX_SALON: "Unisex salon", SPA: "Spa", BEAUTY_PARLOUR: "Beauty parlour", NAIL_STUDIO: "Nail studio", OTHER: "Other",
};

// ---------- Activity ----------

export const CrmTaskType = {
  CALL_OWNER: "CALL_OWNER", SCHEDULE_MEETING: "SCHEDULE_MEETING", COMPLETE_MEETING: "COMPLETE_MEETING", REVISIT_SALON: "REVISIT_SALON",
  COMPLETE_ONBOARDING: "COMPLETE_ONBOARDING", CAPTURE_PHOTOS: "CAPTURE_PHOTOS", UPLOAD_MENU: "UPLOAD_MENU", VERIFY_GPS: "VERIFY_GPS",
  PRICING_FOLLOW_UP: "PRICING_FOLLOW_UP", INSTALL_QR: "INSTALL_QR", TRAIN_OWNER: "TRAIN_OWNER", ACTIVATE_SALON: "ACTIVATE_SALON",
  RESOLVE_SUPPORT: "RESOLVE_SUPPORT", OTHER: "OTHER",
} as const;
export type CrmTaskType = (typeof CrmTaskType)[keyof typeof CrmTaskType];
export const CRM_TASK_TYPE_LABEL: Record<CrmTaskType, string> = {
  CALL_OWNER: "Call salon owner", SCHEDULE_MEETING: "Schedule meeting", COMPLETE_MEETING: "Complete meeting", REVISIT_SALON: "Revisit salon",
  COMPLETE_ONBOARDING: "Complete onboarding", CAPTURE_PHOTOS: "Capture missing photos", UPLOAD_MENU: "Upload service menu", VERIFY_GPS: "Verify GPS",
  PRICING_FOLLOW_UP: "Follow up on pricing", INSTALL_QR: "Install FastQue QR", TRAIN_OWNER: "Train salon owner", ACTIVATE_SALON: "Activate salon",
  RESOLVE_SUPPORT: "Resolve support issue", OTHER: "Other",
};
export const CrmTaskStatus = { NOT_STARTED: "NOT_STARTED", IN_PROGRESS: "IN_PROGRESS", COMPLETED: "COMPLETED", BLOCKED: "BLOCKED", CANCELLED: "CANCELLED" } as const;
export type CrmTaskStatus = (typeof CrmTaskStatus)[keyof typeof CrmTaskStatus];
export const CRM_TASK_STATUS_LABEL: Record<CrmTaskStatus, string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETED: "Completed", BLOCKED: "Blocked", CANCELLED: "Cancelled" };

export const CrmMeetingMode = { PHYSICAL: "PHYSICAL", ONLINE: "ONLINE", PHONE: "PHONE" } as const;
export type CrmMeetingMode = (typeof CrmMeetingMode)[keyof typeof CrmMeetingMode];
export const CrmMeetingStatus = { SCHEDULED: "SCHEDULED", CONFIRMED: "CONFIRMED", COMPLETED: "COMPLETED", RESCHEDULED: "RESCHEDULED", CANCELLED: "CANCELLED", NO_SHOW: "NO_SHOW" } as const;
export type CrmMeetingStatus = (typeof CrmMeetingStatus)[keyof typeof CrmMeetingStatus];
export const CRM_MEETING_STATUS_LABEL: Record<CrmMeetingStatus, string> = { SCHEDULED: "Scheduled", CONFIRMED: "Confirmed", COMPLETED: "Completed", RESCHEDULED: "Rescheduled", CANCELLED: "Cancelled", NO_SHOW: "No show" };

export const CrmCallOutcome = {
  CONNECTED: "CONNECTED", NO_ANSWER: "NO_ANSWER", BUSY: "BUSY", SWITCHED_OFF: "SWITCHED_OFF", INVALID_NUMBER: "INVALID_NUMBER",
  CALLBACK_REQUESTED: "CALLBACK_REQUESTED", INTERESTED: "INTERESTED", NOT_INTERESTED: "NOT_INTERESTED", MEETING_SCHEDULED: "MEETING_SCHEDULED", OTHER: "OTHER",
} as const;
export type CrmCallOutcome = (typeof CrmCallOutcome)[keyof typeof CrmCallOutcome];
export const CRM_CALL_OUTCOME_LABEL: Record<CrmCallOutcome, string> = {
  CONNECTED: "Connected", NO_ANSWER: "No answer", BUSY: "Busy", SWITCHED_OFF: "Switched off", INVALID_NUMBER: "Invalid number",
  CALLBACK_REQUESTED: "Callback requested", INTERESTED: "Interested", NOT_INTERESTED: "Not interested", MEETING_SCHEDULED: "Meeting scheduled", OTHER: "Other",
};
/** Outcomes that count as "connected" (the owner was actually reached). */
export const CRM_CONNECTED_OUTCOMES: readonly CrmCallOutcome[] = ["CONNECTED", "CALLBACK_REQUESTED", "INTERESTED", "NOT_INTERESTED", "MEETING_SCHEDULED"];

/** How a logged call outcome moves the lead (only from early statuses; never backwards out of onboarding). */
export function leadStatusAfterCall(current: CrmLeadStatus, outcome: CrmCallOutcome): CrmLeadStatus | null {
  if (CRM_WORKFLOW_LEAD_STATUSES.includes(current) || current === "DUPLICATE") return null;
  switch (outcome) {
    case "NO_ANSWER":
    case "BUSY":
    case "SWITCHED_OFF":
      return ["NEW", "ASSIGNED", "CALL_PENDING", "CONTACT_ATTEMPTED"].includes(current) ? "NO_ANSWER" : null;
    case "INVALID_NUMBER":
      return "INVALID_CONTACT";
    case "CALLBACK_REQUESTED":
      return "CALLBACK_REQUESTED";
    case "INTERESTED":
      return "INTERESTED";
    case "NOT_INTERESTED":
      return "LOST";
    case "MEETING_SCHEDULED":
      return "DEMO_SCHEDULED";
    case "CONNECTED":
      return ["NEW", "ASSIGNED", "CALL_PENDING", "CONTACT_ATTEMPTED", "NO_ANSWER", "CALLBACK_REQUESTED"].includes(current) ? "CONTACTED" : null;
    default:
      return null;
  }
}

// ---------- Support ----------

export const SupportTicketCategory = {
  APP_PROBLEM: "APP_PROBLEM", CRM_ISSUE: "CRM_ISSUE", ONBOARDING_ISSUE: "ONBOARDING_ISSUE", CAMERA_GPS: "CAMERA_GPS", LEAD_ASSIGNMENT: "LEAD_ASSIGNMENT",
  OWNER_DASHBOARD: "OWNER_DASHBOARD", LOGIN_PASSWORD: "LOGIN_PASSWORD", INCORRECT_SALON_INFO: "INCORRECT_SALON_INFO", OWNER_COMPLAINT: "OWNER_COMPLAINT",
  PRICING_DISPUTE: "PRICING_DISPUTE", FIELD_OPERATIONS: "FIELD_OPERATIONS", QR_CODE: "QR_CODE", PAYMENT_SUBSCRIPTION: "PAYMENT_SUBSCRIPTION", OTHER: "OTHER",
} as const;
export type SupportTicketCategory = (typeof SupportTicketCategory)[keyof typeof SupportTicketCategory];
export const SUPPORT_CATEGORY_LABEL: Record<SupportTicketCategory, string> = {
  APP_PROBLEM: "FastQue application problem", CRM_ISSUE: "Employee CRM issue", ONBOARDING_ISSUE: "Salon onboarding issue", CAMERA_GPS: "Camera/GPS problem",
  LEAD_ASSIGNMENT: "Lead assignment problem", OWNER_DASHBOARD: "Owner dashboard issue", LOGIN_PASSWORD: "Login/password issue", INCORRECT_SALON_INFO: "Incorrect salon information",
  OWNER_COMPLAINT: "Salon owner complaint", PRICING_DISPUTE: "Service/pricing dispute", FIELD_OPERATIONS: "Field operations issue", QR_CODE: "QR code issue",
  PAYMENT_SUBSCRIPTION: "Payment/subscription question", OTHER: "Other",
};
export const SupportTicketStatus = {
  OPEN: "OPEN", ASSIGNED: "ASSIGNED", IN_PROGRESS: "IN_PROGRESS", WAITING_EMPLOYEE: "WAITING_EMPLOYEE", WAITING_SALON: "WAITING_SALON",
  RESOLVED: "RESOLVED", CLOSED: "CLOSED", REOPENED: "REOPENED",
} as const;
export type SupportTicketStatus = (typeof SupportTicketStatus)[keyof typeof SupportTicketStatus];
export const SUPPORT_STATUS_LABEL: Record<SupportTicketStatus, string> = {
  OPEN: "Open", ASSIGNED: "Assigned", IN_PROGRESS: "In progress", WAITING_EMPLOYEE: "Waiting for employee", WAITING_SALON: "Waiting for salon",
  RESOLVED: "Resolved", CLOSED: "Closed", REOPENED: "Reopened",
};
/** Ticket response SLA by priority (hours to resolution target). */
export const SUPPORT_SLA_HOURS: Record<CrmLeadPriority, number> = { URGENT: 4, HIGH: 24, NORMAL: 48, LOW: 96 };
export const SUPPORT_OPEN_STATUSES: readonly SupportTicketStatus[] = ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_EMPLOYEE", "WAITING_SALON", "REOPENED"];

// ---------- Sales conversations ----------

export const SalesAnalysisStatus = { NOT_CONFIGURED: "NOT_CONFIGURED", DISABLED: "DISABLED", QUEUED: "QUEUED", PROCESSING: "PROCESSING", COMPLETED: "COMPLETED", FAILED: "FAILED" } as const;
export type SalesAnalysisStatus = (typeof SalesAnalysisStatus)[keyof typeof SalesAnalysisStatus];
export const SALES_RECORDING_MAX_BYTES = 40 * 1024 * 1024;
export const SALES_RECORDING_MAX_SECONDS = 2 * 60 * 60;
export const SALES_RECORDING_MIME = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a", "audio/aac"] as const;
export const SALES_CONSENT_METHODS = ["VERBAL_ON_RECORDING", "WRITTEN_SIGNED", "WHATSAPP_CONFIRMATION"] as const;
export const SALES_CONSENT_STATEMENT =
  "I explained to everyone present that this conversation will be recorded for FastQue sales coaching and quality review, " +
  "they agreed to the recording, and I will stop recording if anyone withdraws consent.";

/** The evaluation rubric (13 criteria); an AI report scores only criteria that were relevant. */
export const SALES_COACH_CRITERIA = [
  ["introduction", "Introduction and professionalism"],
  ["needs", "Understanding the salon owner's needs"],
  ["concept", "Explanation of FastQue's concept"],
  ["liveQueue", "Explanation of the live queue system"],
  ["booking", "Explanation of appointment booking"],
  ["discovery", "Explanation of customer discovery"],
  ["dashboard", "Explanation of salon dashboard and analytics"],
  ["pricing", "Explanation of relevant approved pricing"],
  ["customerBenefits", "Explanation of customer benefits"],
  ["questions", "Handling owner questions"],
  ["objections", "Objection handling"],
  ["closing", "Closing the conversation"],
  ["nextSteps", "Securing next steps"],
] as const;
export type SalesCoachCriterion = (typeof SALES_COACH_CRITERIA)[number][0];

export interface SalesCoachReport {
  overallScore: number;
  summary: string;
  criteria: Array<{ key: SalesCoachCriterion; score: number | null; relevant: boolean; evidence: Array<{ quote: string; atSeconds: number | null }>; note: string }>;
  strengths: string[];
  missedPoints: string[];
  ownerQuestions: string[];
  objections: Array<{ objection: string; response: string; betterAnswer: string }>;
  unansweredQuestions: string[];
  nextSteps: string[];
  coaching: string[];
}

// ---------- KPI definitions (one place; every dashboard uses these) ----------

export const CRM_KPI_DEFINITIONS = {
  leadsAssigned: "Leads whose assigned employee is in scope and were assigned (or created) in the period.",
  newLeads: "Leads in scope currently in status New or Assigned.",
  leadsContacted: "Distinct leads with at least one logged call (any outcome) in the period.",
  callsCompleted: "Calls with a logged outcome (calledAt) in the period.",
  callsConnected: "Logged calls in the period whose outcome reached the owner (CRM_CONNECTED_OUTCOMES).",
  callsPending: "Scheduled calls without an outcome that are due by the end of the period.",
  meetingsScheduled: "Meetings starting in the period that are Scheduled, Confirmed or Rescheduled.",
  meetingsCompleted: "Meetings starting in the period marked Completed.",
  visitsCompleted: "Field visits logged in the period.",
  onboardingInProgress: "Onboarding applications in scope in Draft or Changes requested.",
  onboardingSubmitted: "Onboarding applications first submitted in the period.",
  approved: "Onboarding applications approved in the period.",
  activated: "Leads whose salon went live (lead status Activated) in the period.",
  rejected: "Onboarding applications rejected in the period.",
  pendingFollowUps: "Open follow-ups plus leads whose next follow-up date has passed.",
  overdueTasks: "Tasks not Completed/Cancelled whose due time has passed.",
  openTickets: "Support tickets in an open status.",
  leadToOnboarding: "Leads in scope that reached Onboarding started or later ÷ leads in scope.",
  onboardingToActivation: "Applications activated ÷ applications submitted (all time, in scope).",
} as const;
export type CrmKpiKey = keyof typeof CRM_KPI_DEFINITIONS;

// ---------- Schemas ----------

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const phone = z.string().trim().regex(/^\+?[0-9][0-9\s-]{6,18}$/, "Enter a valid phone number").optional().nullable();
const isoDate = z.string().datetime({ offset: true }).optional().nullable();

export const crmLeadInputSchema = z
  .object({
    shopName: text(160),
    businessType: z.enum(CRM_BUSINESS_TYPES).optional().nullable(),
    ownerName: optText(120),
    managerName: optText(120),
    contactName: optText(120),
    phone,
    alternatePhone: phone,
    whatsappPhone: phone,
    email: z.string().trim().email().max(254).optional().nullable(),
    addressLine: optText(300),
    locality: optText(120),
    city: optText(80),
    state: optText(80),
    postalCode: z.string().trim().regex(/^\d{6}$/, "PIN codes have 6 digits").optional().nullable(),
    mapsUrl: z.string().trim().url().max(500).optional().nullable(),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    source: z.nativeEnum(CrmLeadSource).optional(),
    salonSize: optText(40),
    chairCount: z.number().int().min(0).max(500).optional().nullable(),
    existingSoftware: optText(120),
    territory: optText(80),
    priority: z.nativeEnum(CrmLeadPriority).optional(),
    interestLevel: z.number().int().min(1).max(5).optional().nullable(),
    nextAction: optText(200),
    nextFollowUpAt: isoDate,
    notes: optText(2000),
    objections: optText(1000),
    assignToEmployeeId: z.string().uuid().optional(),
  })
  .strict();
export type CrmLeadInput = z.infer<typeof crmLeadInputSchema>;

export const crmLeadUpdateSchema = crmLeadInputSchema
  .partial()
  .extend({ status: z.nativeEnum(CrmLeadStatus).optional(), lostReason: optText(300) })
  .strict();
export type CrmLeadUpdateInput = z.infer<typeof crmLeadUpdateSchema>;

export const crmLeadListQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.string().trim().max(400).optional(),
    employeeId: z.string().uuid().optional(),
    territory: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    source: z.nativeEnum(CrmLeadSource).optional(),
    priority: z.nativeEnum(CrmLeadPriority).optional(),
    followUpDue: z.enum(["true", "false"]).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(["updated", "created", "followUp", "name", "priority"]).default("updated"),
  })
  .strict();
export type CrmLeadListQuery = z.infer<typeof crmLeadListQuerySchema>;

export const crmAssignSchema = z.object({ employeeId: z.string().uuid(), note: optText(300) }).strict();
export const crmBulkAssignSchema = z.object({ leadIds: z.array(z.string().uuid()).min(1).max(500), employeeId: z.string().uuid() }).strict();
export const crmNoteSchema = z.object({ body: text(2000) }).strict();

export const crmImportPreviewSchema = z
  .object({
    mapping: z.string().max(10000).optional(),
    defaultEmployeeId: z.string().uuid().optional(),
  })
  .strict();

export const crmTaskInputSchema = z
  .object({
    subject: text(200),
    description: optText(2000),
    type: z.nativeEnum(CrmTaskType).default("OTHER"),
    priority: z.nativeEnum(CrmLeadPriority).default("NORMAL"),
    leadId: z.string().uuid().optional().nullable(),
    onboardingApplicationId: z.string().uuid().optional().nullable(),
    assigneeEmployeeId: z.string().uuid().optional(),
    dueAt: isoDate,
  })
  .strict();
export type CrmTaskInput = z.infer<typeof crmTaskInputSchema>;
export const crmTaskUpdateSchema = crmTaskInputSchema
  .partial()
  .extend({ status: z.nativeEnum(CrmTaskStatus).optional(), blockedReason: optText(300) })
  .strict();
export type CrmTaskUpdateInput = z.infer<typeof crmTaskUpdateSchema>;
export const crmTaskListQuerySchema = z
  .object({
    status: z.string().trim().max(200).optional(),
    type: z.nativeEnum(CrmTaskType).optional(),
    priority: z.nativeEnum(CrmLeadPriority).optional(),
    employeeId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    overdue: z.enum(["true", "false"]).optional(),
    q: z.string().trim().max(120).optional(),
    from: isoDate,
    to: isoDate,
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type CrmTaskListQuery = z.infer<typeof crmTaskListQuerySchema>;
export const crmBulkTaskSchema = z
  .object({ taskIds: z.array(z.string().uuid()).min(1).max(200), status: z.nativeEnum(CrmTaskStatus).optional(), assigneeEmployeeId: z.string().uuid().optional() })
  .strict()
  .refine((v) => !!v.status || !!v.assigneeEmployeeId, { message: "Choose a status or an assignee." });

export const crmMeetingInputSchema = z
  .object({
    leadId: z.string().uuid(),
    contactName: optText(120),
    contactPhone: phone,
    startsAt: z.string().datetime({ offset: true }),
    endsAt: isoDate,
    mode: z.nativeEnum(CrmMeetingMode).default("PHYSICAL"),
    location: optText(300),
    purpose: optText(200),
    agenda: optText(1000),
    employeeId: z.string().uuid().optional(),
  })
  .strict();
export type CrmMeetingInput = z.infer<typeof crmMeetingInputSchema>;
export const crmMeetingUpdateSchema = crmMeetingInputSchema
  .omit({ leadId: true })
  .partial()
  .extend({
    status: z.nativeEnum(CrmMeetingStatus).optional(),
    outcome: optText(1000),
    notes: optText(2000),
    nextAction: optText(200),
    followUpAt: isoDate,
    createFollowUpTask: z.boolean().optional(),
  })
  .strict();
export type CrmMeetingUpdateInput = z.infer<typeof crmMeetingUpdateSchema>;
export const crmRangeQuerySchema = z
  .object({ from: isoDate, to: isoDate, employeeId: z.string().uuid().optional(), leadId: z.string().uuid().optional(), status: z.string().trim().max(200).optional() })
  .strict();
export type CrmRangeQuery = z.infer<typeof crmRangeQuerySchema>;

export const crmCallInputSchema = z
  .object({
    leadId: z.string().uuid(),
    scheduledAt: isoDate,
    outcome: z.nativeEnum(CrmCallOutcome).optional().nullable(),
    calledAt: isoDate,
    durationSeconds: z.number().int().min(0).max(36000).optional().nullable(),
    notes: optText(2000),
    nextCallbackAt: isoDate,
    interestLevel: z.number().int().min(1).max(5).optional().nullable(),
    nextAction: optText(200),
    employeeId: z.string().uuid().optional(),
  })
  .strict();
export type CrmCallInput = z.infer<typeof crmCallInputSchema>;
export const crmCallLogSchema = z
  .object({
    outcome: z.nativeEnum(CrmCallOutcome),
    calledAt: isoDate,
    durationSeconds: z.number().int().min(0).max(36000).optional().nullable(),
    notes: optText(2000),
    nextCallbackAt: isoDate,
    interestLevel: z.number().int().min(1).max(5).optional().nullable(),
    nextAction: optText(200),
    meetingAt: isoDate,
  })
  .strict();
export type CrmCallLogInput = z.infer<typeof crmCallLogSchema>;

export const salesRecordingMetaSchema = z
  .object({
    leadId: z.string().uuid(),
    meetingId: z.string().uuid().optional(),
    durationSeconds: z.coerce.number().int().min(1).max(SALES_RECORDING_MAX_SECONDS),
    language: z.enum(["hi-IN", "en-IN", "hinglish"]).default("hi-IN"),
    consentGiven: z.literal("true"),
    consentMethod: z.enum(SALES_CONSENT_METHODS),
    consentAt: z.string().datetime({ offset: true }),
    participants: z.string().trim().max(300).optional(),
    submissionKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  })
  .strict();
export type SalesRecordingMeta = z.infer<typeof salesRecordingMetaSchema>;
export const salesReviewSchema = z
  .object({ reviewerNotes: optText(2000), correctedScore: z.number().int().min(0).max(100).optional().nullable() })
  .strict();

export const supportTicketInputSchema = z
  .object({
    category: z.nativeEnum(SupportTicketCategory),
    subject: text(200),
    description: text(5000),
    priority: z.nativeEnum(CrmLeadPriority).default("NORMAL"),
    leadId: z.string().uuid().optional().nullable(),
    salonId: z.string().uuid().optional().nullable(),
  })
  .strict();
export type SupportTicketInput = z.infer<typeof supportTicketInputSchema>;
export const supportTicketUpdateSchema = z
  .object({
    status: z.nativeEnum(SupportTicketStatus).optional(),
    priority: z.nativeEnum(CrmLeadPriority).optional(),
    assignedToUserId: z.string().optional().nullable(),
    resolutionNotes: optText(2000),
    escalate: z.boolean().optional(),
  })
  .strict();
export type SupportTicketUpdateInput = z.infer<typeof supportTicketUpdateSchema>;
export const supportCommentSchema = z.object({ body: text(5000), internal: z.boolean().default(false) }).strict();
export const supportTicketListQuerySchema = z
  .object({
    status: z.string().trim().max(200).optional(),
    category: z.nativeEnum(SupportTicketCategory).optional(),
    mine: z.enum(["true", "false"]).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type SupportTicketListQuery = z.infer<typeof supportTicketListQuerySchema>;

export const crmAnalyticsQuerySchema = z
  .object({
    preset: z.enum(["today", "yesterday", "7d", "30d", "month", "custom"]).default("30d"),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    employeeId: z.string().uuid().optional(),
    territory: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    source: z.nativeEnum(CrmLeadSource).optional(),
  })
  .strict();
export type CrmAnalyticsQuery = z.infer<typeof crmAnalyticsQuerySchema>;

/** IST calendar range for a preset → [start, end) instants. */
export function crmRange(query: Pick<CrmAnalyticsQuery, "preset" | "from" | "to">, now = new Date()): { from: string; to: string; start: Date; end: Date } {
  const IST = 330 * 60_000;
  const istToday = new Date(now.getTime() + IST).toISOString().slice(0, 10);
  const day = (d: string, add: number) => new Date(Date.parse(`${d}T00:00:00Z`) + add * 864e5).toISOString().slice(0, 10);
  let from = istToday;
  let to = istToday;
  if (query.preset === "yesterday") from = to = day(istToday, -1);
  else if (query.preset === "7d") from = day(istToday, -6);
  else if (query.preset === "30d") from = day(istToday, -29);
  else if (query.preset === "month") from = `${istToday.slice(0, 8)}01`;
  else if (query.preset === "custom") {
    from = query.from ?? day(istToday, -29);
    to = query.to ?? istToday;
  }
  if (from > to) [from, to] = [to, from];
  return { from, to, start: new Date(Date.parse(`${from}T00:00:00Z`) - IST), end: new Date(Date.parse(`${to}T00:00:00Z`) + 864e5 - IST) };
}

// ---------- CEO message ----------

export const CRM_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const crmAnnouncementSchema = z
  .object({
    title: text(160),
    body: optText(4000),
    videoUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === "" || /^https:\/\/\S+$/i.test(v), "Use a full https:// link")
      .optional()
      .nullable(),
  })
  .strict();
export type CrmAnnouncementInput = z.infer<typeof crmAnnouncementSchema>;
export const crmAnnouncementUpdateSchema = crmAnnouncementSchema.partial().extend({ isActive: z.boolean().optional() }).strict();
export type CrmAnnouncementUpdateInput = z.infer<typeof crmAnnouncementUpdateSchema>;
export interface CrmAnnouncementDto {
  id: string;
  title: string;
  body: string | null;
  videoUrl: string | null;
  hasVideo: boolean;
  isActive: boolean;
  createdAt: string;
}

// ---------- DTOs ----------

export interface CrmEmployeeRefDto {
  id: string;
  employeeCode: string;
  fullName: string;
  territory: string | null;
}

export interface CrmMeDto {
  role: "FIELD_EMPLOYEE" | "SALES_MANAGER" | "ADMIN" | "VIEWER";
  employee: CrmEmployeeRefDto | null;
  can: { importLeads: boolean; assignLeads: boolean; reviewRecordings: boolean; manageTickets: boolean; viewTeam: boolean; approveOnboarding: boolean };
  ai: { configured: boolean; enabled: boolean; provider: string };
}

export interface CrmLeadDto {
  id: string;
  shopName: string;
  businessType: string | null;
  ownerName: string | null;
  managerName: string | null;
  contactName: string | null;
  phone: string | null;
  alternatePhone: string | null;
  whatsappPhone: string | null;
  email: string | null;
  addressLine: string | null;
  locality: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  mapsUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  source: CrmLeadSource;
  salonSize: string | null;
  chairCount: number | null;
  existingSoftware: string | null;
  territory: string | null;
  status: CrmLeadStatus;
  statusLabel: string;
  priority: CrmLeadPriority;
  interestLevel: number | null;
  nextAction: string | null;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  contactAttempts: number;
  meetingAt: string | null;
  notes: string | null;
  objections: string | null;
  lostReason: string | null;
  assignedEmployee: CrmEmployeeRefDto;
  assignedAt: string | null;
  onboarding: { id: string; reference: string; status: string } | null;
  onboardedSalonId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmPageDto<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CrmActivityDto {
  id: string;
  type: string;
  summary: string;
  actor: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface CrmTaskDto {
  id: string;
  number: number;
  code: string;
  subject: string;
  description: string | null;
  type: CrmTaskType;
  priority: CrmLeadPriority;
  status: CrmTaskStatus;
  lead: { id: string; shopName: string } | null;
  onboardingApplicationId: string | null;
  assignee: CrmEmployeeRefDto;
  createdBy: string | null;
  dueAt: string | null;
  overdue: boolean;
  completedAt: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmMeetingDto {
  id: string;
  lead: { id: string; shopName: string };
  employee: CrmEmployeeRefDto;
  contactName: string | null;
  contactPhone: string | null;
  startsAt: string;
  endsAt: string | null;
  mode: CrmMeetingMode;
  location: string | null;
  purpose: string | null;
  agenda: string | null;
  status: CrmMeetingStatus;
  outcome: string | null;
  notes: string | null;
  nextAction: string | null;
  followUpAt: string | null;
  recordingIds: string[];
}

export interface CrmCallDto {
  id: string;
  lead: { id: string; shopName: string; phone: string | null; contactName: string | null; status: CrmLeadStatus; contactAttempts: number };
  employee: CrmEmployeeRefDto;
  scheduledAt: string | null;
  calledAt: string | null;
  outcome: CrmCallOutcome | null;
  durationSeconds: number | null;
  notes: string | null;
  nextCallbackAt: string | null;
  interestLevel: number | null;
  nextAction: string | null;
  overdue: boolean;
}

export interface CrmCallQueueDto {
  due: CrmCallDto[];
  overdue: CrmCallDto[];
  /** Leads that need a first call but have no scheduled call yet. */
  uncalledLeads: Array<{ id: string; shopName: string; phone: string | null; contactName: string | null; status: CrmLeadStatus }>;
}

export interface SalesRecordingDto {
  id: string;
  lead: { id: string; shopName: string };
  meetingId: string | null;
  employee: CrmEmployeeRefDto;
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string;
  language: string;
  consentMethod: string;
  consentAt: string;
  participants: string | null;
  analysisStatus: SalesAnalysisStatus;
  analysis: { id: string; provider: string; overallScore: number | null; correctedScore: number | null; report: SalesCoachReport | null; transcript: string | null; errorMessage: string | null; reviewerNotes: string | null; completedAt: string | null } | null;
  createdAt: string;
  deleted: boolean;
}

export interface SupportTicketDto {
  id: string;
  number: number;
  code: string;
  category: SupportTicketCategory;
  subject: string;
  description: string;
  priority: CrmLeadPriority;
  status: SupportTicketStatus;
  createdBy: { id: string; name: string | null };
  assignedTo: { id: string; name: string | null } | null;
  lead: { id: string; shopName: string } | null;
  salonId: string | null;
  slaDueAt: string;
  slaBreached: boolean;
  escalatedAt: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  comments: Array<{ id: string; author: string | null; body: string; internal: boolean; createdAt: string }>;
  attachments: Array<{ id: string; mimeType: string; sizeBytes: number; createdAt: string }>;
}

export type CrmKpis = Record<CrmKpiKey, number>;

export interface CrmDashboardDto {
  range: { from: string; to: string };
  kpis: CrmKpis;
  upcomingMeetings: CrmMeetingDto[];
  pendingCallbacks: CrmCallDto[];
  overdueTasks: CrmTaskDto[];
  recentActivity: Array<CrmActivityDto & { lead: { id: string; shopName: string } }>;
  onboarding: Array<{ id: string; reference: string; salonName: string; status: string; updatedAt: string }>;
}

export interface CrmAnalyticsDto {
  range: { from: string; to: string };
  kpis: CrmKpis & { leadsGenerated: number; meetingConversion: number; approvalRate: number; activationRate: number; leadConversion: number };
  funnel: Array<{ stage: string; leads: number }>;
  employees: Array<{
    employee: CrmEmployeeRefDto;
    leadsAssigned: number;
    callsCompleted: number;
    callsConnected: number;
    meetingsCompleted: number;
    visits: number;
    onboardingsSubmitted: number;
    approved: number;
    activated: number;
    conversion: number;
    aiPitchScore: number | null;
  }>;
  trend: Array<{ day: string; calls: number; meetings: number; visits: number; onboardings: number; approvals: number; activations: number }>;
  sources: Array<{ source: string; leads: number; onboarded: number }>;
  territories: Array<{ territory: string; leads: number; onboarded: number; activated: number }>;
  onboardingQuality: { missingPhotos: number; missingMenu: number; gpsUnverified: number; incomplete: number; averageApprovalHours: number | null; rejectionReasons: Array<{ reason: string; count: number }> };
  ai: { configured: boolean; analysed: number; averageScore: number | null };
  support: { open: number; overdue: number; averageResolutionHours: number | null; byCategory: Array<{ category: string; count: number }> };
  definitions: typeof CRM_KPI_DEFINITIONS;
}

export interface CrmNotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface CrmImportPreviewDto {
  jobId: string;
  headers: string[];
  mapping: Array<string | null>;
  fieldLabels: Record<string, string>;
  totalRows: number;
  valid: number;
  duplicates: number;
  errors: number;
  rows: Array<{ rowNumber: number; shopName: string | null; phone: string | null; city: string | null; assignTo: string | null; status: "NEW" | "DUPLICATE" | "ERROR"; issues: string[] }>;
}
