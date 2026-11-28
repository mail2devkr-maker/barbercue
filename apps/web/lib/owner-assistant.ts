import { OWNER_ASSISTANT_QUERY_LIMITS, formatMoney } from "@barbercue/shared";
import type { OwnerAssistantFigureDto, OwnerAssistantIntent, OwnerAssistantQueryDto } from "@barbercue/shared";

// Owner "Quick Insights" (requirement #15, owner side) on docs/contracts/FASTQUE_OWNER_ASSISTANT_QUERY_V1.md:
//   POST dashboard/salons/:salonId/assistant/query { question }  (2-300 characters; 12 requests a minute)
//   -> { mode: "DETERMINISTIC", intent, localDate, timezone, answer, figures[], generatedAt }
//   422 OWNER_ASSISTANT_QUERY_UNSUPPORTED { details.supportedIntents[] } for anything outside the fixed question set.
//
// This is a fixed set of read-only questions answered from the shop's own recorded numbers. It is not a chat, it uses no AI
// provider, and it cannot change anything. This file never makes up an answer: a reply that does not have the documented shape
// is treated as "could not answer", and an estimated figure is always labelled as an estimate, never as money collected.

export const QUESTION_LIMITS = { min: 2, max: OWNER_ASSISTANT_QUERY_LIMITS.maxQuestionLength } as const;

export interface QuickQuestion {
  intent: OwnerAssistantIntent;
  label: string;
  /** Wording the server is known to understand for this intent. */
  question: string;
}

export const QUICK_QUESTIONS: ReadonlyArray<QuickQuestion> = [
  { intent: "TODAY_SUMMARY", label: "Today's summary", question: "Give me today's summary" },
  { intent: "TODAY_RECORDED_AND_ESTIMATED_VALUE", label: "Collections today", question: "How much was collected today" },
  { intent: "APPOINTMENTS_TODAY", label: "Appointments today", question: "How many appointments today" },
  { intent: "COMPLETED_SERVICES_TODAY", label: "Completed today", question: "How many services were completed today" },
  { intent: "WAITING_QUEUE_NOW", label: "Waiting now", question: "How many customers are waiting now" },
  { intent: "IN_SERVICE_NOW", label: "In service now", question: "How many customers are in service now" },
  { intent: "AVAILABLE_BARBERS_NOW", label: "Barbers free now", question: "Which barbers are available now" },
  { intent: "CANCELLATIONS_TODAY", label: "Cancellations today", question: "How many cancellations today" },
];

const METRIC_LABELS: Record<OwnerAssistantFigureDto["metric"], string> = {
  appointmentsToday: "Appointments today",
  completedServicesToday: "Services completed today",
  waitingInQueue: "Waiting in the queue",
  inService: "In service now",
  availableBarbers: "Barbers available now",
  cancelledToday: "Cancelled today",
  recordedCollectionsToday: "Collections recorded today",
  estimatedServiceValueToday: "Estimated value of completed services",
};

/** The error text for a question that cannot be sent, or null when it can. The server trims the text the same way. */
export function validateQuestion(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < QUESTION_LIMITS.min) return `Type at least ${QUESTION_LIMITS.min} characters, or pick one of the questions below.`;
  if (trimmed.length > QUESTION_LIMITS.max) return `Keep the question under ${QUESTION_LIMITS.max} characters.`;
  return null;
}

export function metricLabel(metric: string): string {
  if (Object.prototype.hasOwnProperty.call(METRIC_LABELS, metric)) return METRIC_LABELS[metric as OwnerAssistantFigureDto["metric"]];
  // A figure this page does not know yet is still shown, with its name made readable instead of hidden.
  const words = metric.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatFigure(figure: OwnerAssistantFigureDto): string {
  if (figure.unit === "money") {
    // No currency means the shop has not set one: say so instead of showing a bare number that looks like rupees.
    return figure.currency ? formatMoney(figure.value, figure.currency) : `${figure.value.toFixed(2)} (currency not set)`;
  }
  return new Intl.NumberFormat("en-IN").format(figure.value);
}

function isFigure(value: unknown): value is OwnerAssistantFigureDto {
  if (!value || typeof value !== "object") return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.metric === "string" &&
    typeof f.value === "number" &&
    Number.isFinite(f.value) &&
    (f.unit === "count" || f.unit === "money") &&
    (f.currency === null || typeof f.currency === "string") &&
    typeof f.estimated === "boolean"
  );
}

/** The answer, only when it has exactly the documented shape; anything else is "no answer" (never a half-shown one). */
export function parseAnswer(raw: unknown): OwnerAssistantQueryDto | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.mode !== "DETERMINISTIC") return null;
  if (typeof r.answer !== "string" || r.answer.trim().length === 0) return null;
  if (typeof r.localDate !== "string" || typeof r.timezone !== "string" || typeof r.generatedAt !== "string") return null;
  if (!Array.isArray(r.figures) || !r.figures.every(isFigure)) return null;
  return r as unknown as OwnerAssistantQueryDto;
}

export type InsightFailure =
  | { kind: "UNSUPPORTED"; message: string; supported: string[] }
  | { kind: "TOO_FAST"; message: string }
  | { kind: "NO_ACCESS"; message: string }
  | { kind: "TRY_LATER"; message: string };

/** Turns a refused request into words an owner can act on. `details` is the error envelope's details object, when there is one. */
export function describeFailure(status: number | undefined, code: string | undefined, details?: unknown): InsightFailure {
  if (status === 422 || code === "OWNER_ASSISTANT_QUERY_UNSUPPORTED") {
    const raw = details && typeof details === "object" ? (details as { supportedIntents?: unknown }).supportedIntents : undefined;
    const supported = Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 120).slice(0, 12) : [];
    return {
      kind: "UNSUPPORTED",
      message: "Quick Insights cannot answer that. It only answers the questions listed below, about today or about right now.",
      supported,
    };
  }
  if (status === 0) {
    return { kind: "TRY_LATER", message: "You appear to be offline. Check your connection and try again. Nothing was changed." };
  }
  if (status === 429) {
    return { kind: "TOO_FAST", message: `You have asked a lot of questions in a short time (the limit is ${OWNER_ASSISTANT_QUERY_LIMITS.maxRequests} a minute). Wait a minute and try again.` };
  }
  if (status === 401 || status === 403) {
    return { kind: "NO_ACCESS", message: "Only the shop owner can use Quick Insights. Sign in with the owner account for this shop." };
  }
  return { kind: "TRY_LATER", message: "Quick Insights could not answer right now. Nothing was changed. Try again in a moment." };
}
