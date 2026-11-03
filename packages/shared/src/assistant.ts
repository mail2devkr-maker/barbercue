import { z } from "zod";

// FastQue Action Assistant (issue #362). The assistant never calls an API on its own: every turn is
// interpreted on the server into one allowlisted, typed action, authorized for the CALLER's session at
// execution time, and either answered (reads), previewed for confirmation (writes) or refused. The
// client only renders these DTOs and refreshes the screens named in `refresh`.

export const ASSISTANT_PATHS = {
  assistant: "assistant",
  turns: "turns",
  confirmations: "confirmations",
  capabilities: "capabilities",
} as const;

export const ASSISTANT_LIMITS = {
  maxTextLength: 500,
  confirmationTtlSeconds: 120,
} as const;

export const assistantTurnSchema = z.object({
  text: z.string().trim().min(1).max(ASSISTANT_LIMITS.maxTextLength),
  // The screen the user is on. Only a hint: access is re-checked against the session for every action.
  salonId: z.string().trim().min(1).max(64).optional(),
  // How the text arrived, for the audit trail and the transcript bubble. Never changes what is allowed.
  inputMode: z.enum(["text", "voice"]).default("text"),
});
export type AssistantTurnInput = z.infer<typeof assistantTurnSchema>;

export const assistantConfirmationSchema = z.object({
  token: z.string().min(16).max(4096),
  decision: z.enum(["confirm", "cancel"]),
});
export type AssistantConfirmationInput = z.infer<typeof assistantConfirmationSchema>;

export const AssistantActionId = {
  STAFF_LIST: "staff.list",
  STAFF_ADD: "staff.add",
  STAFF_SET_STATUS: "staff.setStatus",
  SERVICE_LIST: "services.list",
  SERVICE_ADD: "services.add",
  SERVICE_SET_PRICE: "services.setPrice",
  SERVICE_ARCHIVE: "services.archive",
  SERVICE_RESTORE: "services.restore",
  QUEUE_STATUS: "queue.status",
  TODAY_INSIGHTS: "insights.today",
  SALON_SEARCH: "salons.search",
} as const;
export type AssistantActionId = (typeof AssistantActionId)[keyof typeof AssistantActionId];

export type AssistantTurnStatus =
  | "DONE" // read answered, or confirmed write applied by the server
  | "NEEDS_CONFIRMATION" // write previewed; nothing changed yet
  | "NEEDS_INPUT" // ambiguous or missing detail; options offered
  | "CANCELLED"
  | "DENIED" // the caller's role/shop may not do this
  | "UNAVAILABLE" // the feature exists in FastQue but is not released or switched on yet
  | "UNSUPPORTED" // not understood / not an assistant action yet
  | "FAILED"; // the server refused or errored; nothing was changed by the assistant

export interface AssistantPreviewRow {
  label: string;
  before: string | null;
  after: string | null;
}

export interface AssistantTurnDto {
  requestId: string;
  status: AssistantTurnStatus;
  action: { id: AssistantActionId; title: string; kind: "READ" | "WRITE" } | null;
  message: string;
  preview?: { rows: AssistantPreviewRow[]; warning?: string };
  confirmation?: { token: string; expiresAt: string };
  // Suggested follow-up texts (e.g. "which service?" choices), sent back as a new turn when tapped.
  options?: Array<{ label: string; text: string }>;
  result?: {
    summary: string;
    items?: Array<{ id?: string; title: string; detail?: string }>;
    changed?: Array<{ resource: AssistantResource; id: string }>;
  };
  // Screens whose data the server just changed; the client reloads them from the API.
  refresh?: AssistantResource[];
  navigateTo?: string;
  completedAt: string;
}

export type AssistantResource = "staff" | "services" | "queue" | "overview";

export type AssistantCapabilityState = "SUPPORTED" | "DENIED" | "UNAVAILABLE";

export interface AssistantCapabilityDto {
  id: AssistantActionId;
  title: string;
  kind: "READ" | "WRITE";
  confirmation: boolean;
  state: AssistantCapabilityState;
  examples: string[];
}
