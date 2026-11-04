import { z } from "zod";

/**
 * Issue #378: permanent deletion of ONE chair or ONE staff roster record by the shop owner (or an
 * authorized platform admin). Two steps, both checked on the server:
 *   1. preview  - nothing changes; returns the exact target, the effects, and either a short-lived
 *                 single-use token or the reasons deletion is blocked (history, live use...);
 *   2. confirm  - needs that token, the target's name typed exactly, and an explicit acknowledgement.
 *                 Everything is re-checked in one transaction; a stale or replayed token does nothing.
 * Historical bookings, invoices, payments and service sessions are never deleted: a chair or staff
 * member that appears in any history cannot be deleted (use Remove chair / Remove access instead).
 */
export const PERMANENT_DELETION_PATHS = {
  preview: "deletion-preview",
  confirm: "permanent-deletion",
} as const;

export type PermanentDeletionKind = "chair" | "staff";

export interface PermanentDeletionBlocker {
  code: string;
  count: number;
  message: string;
}

export interface PermanentDeletionPreviewDto {
  kind: PermanentDeletionKind;
  target: { id: string; name: string; status: string };
  salon: { id: string; name: string };
  /** True only when the record can be physically deleted right now. */
  deletable: boolean;
  blockers: PermanentDeletionBlocker[];
  /** What deletion does (and does not) affect, in plain words. */
  effects: string[];
  /** The text the owner must type: the target's exact name. */
  confirmName: string;
  /** The safe alternative when deletion is blocked (e.g. "Remove chair" keeps history). */
  alternative: string | null;
  token?: string;
  expiresAt?: string;
}

export const permanentDeletionConfirmSchema = z.object({
  token: z.string().min(20).max(2048),
  typedName: z.string().max(200),
  acknowledged: z.literal(true),
});
export type PermanentDeletionConfirmInput = z.infer<typeof permanentDeletionConfirmSchema>;

export interface PermanentDeletionResultDto {
  kind: PermanentDeletionKind;
  deletedId: string;
  name: string;
  message: string;
}

export const PermanentDeletionErrorCode = {
  BLOCKED: "PERMANENT_DELETE_BLOCKED",
  TOKEN_INVALID: "PERMANENT_DELETE_TOKEN_INVALID",
  TOKEN_EXPIRED: "PERMANENT_DELETE_TOKEN_EXPIRED",
  TOKEN_USED: "PERMANENT_DELETE_TOKEN_USED",
  STALE: "PERMANENT_DELETE_STALE",
  NAME_MISMATCH: "PERMANENT_DELETE_NAME_MISMATCH",
  NOT_FOUND: "PERMANENT_DELETE_NOT_FOUND",
  SELF: "PERMANENT_DELETE_SELF",
  ACCESS_CHANGED: "PERMANENT_DELETE_ACCESS_CHANGED",
} as const;
