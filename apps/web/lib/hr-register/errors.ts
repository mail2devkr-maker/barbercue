import { ApiError } from "../api";

/**
 * Plain-language HR messages for register failures. Error codes other than the generic HTTP ones are
 * PROPOSED names (Codex owns the final list); unknown codes fall back to status-based copy so the
 * screen stays truthful whatever the backend returns.
 */
export function describeHrFailure(error: unknown, fallback = "Could not complete this request."): string {
  if (!(error instanceof ApiError)) return fallback;

  switch (error.code) {
    case "HR_MATCH_REVIEW_REQUIRED":
      return "These details are close to an existing person. Review the matches and confirm who this is before continuing.";
    case "HR_IDENTITY_CONFLICT":
      return "This identity changed while you were working. Search again and re-check the matches.";
    case "HR_OFFER_INVALID_TRANSITION":
      return "That status change is not allowed for this offer in its current state. Refresh to see the latest status.";
    case "HR_OPEN_OFFER_EXISTS":
      return "This person already has an open offer. Record its outcome before issuing another.";
    case "HR_OVERRIDE_REQUIRES_SENIOR":
      return "These details match an existing person exactly. Only a Co-Founder or Platform Admin can create a separate identity.";
    case "HR_LETTER_NOT_STORED":
      return "The original letter was not stored in the register, so it cannot be reprinted.";
    case "HR_DATE_IN_FUTURE":
      return "That date cannot be in the future.";
    case "HR_PRINTED_CODE_MUST_BE_LINKED":
      return "The letter printed an employee ID. Link it to that person instead of creating a new identity.";
    case "HR_PRINTED_CODE_MISMATCH":
      return "The letter printed a different employee ID. Link the person who owns that ID.";
    case "HR_RECONCILIATION_RESOLVED":
      return "This item was already resolved.";
    case "HR_EXIT_BEFORE_JOIN":
      return "The last working day cannot be before the joining date.";
    case "HR_RESERVED_CODE":
      return "That employee ID is in the reserved range and cannot be used here.";
    case "IDEMPOTENCY_KEY_REUSED":
      return "This request was already submitted with different details. Reload and try again.";
    case "NETWORK_OFFLINE":
      return error.message;
  }

  switch (error.status) {
    case 0:
      return "You appear to be offline. Check your connection and try again.";
    case 401:
      return "Your session has expired. Sign in again to continue.";
    case 403:
      return "Your role is not allowed to use the HR offer register.";
    case 404:
      return "The HR offer register is not available on this server yet.";
    case 409:
      return "This record changed. Refresh and check the latest state before trying again.";
    case 422:
      return error.message && error.message !== "Request failed"
        ? error.message
        : "Some details are not valid. Check the highlighted fields.";
    case 429:
      return "Too many requests. Wait a moment and try again.";
    case 501:
    case 503:
      return "The HR offer register is temporarily unavailable. Nothing was saved.";
    default:
      return error.status >= 500 ? "The server could not complete this request. Nothing was changed." : fallback;
  }
}

/** True when the register backend is not deployed/enabled — the UI must then fail closed. */
export function isRegisterUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 501 || error.status === 503);
}
