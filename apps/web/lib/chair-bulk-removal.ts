import { ChairStatus } from "@barbercue/shared";
import type {
  BulkChairDeactivationPreviewDto,
  BulkChairDeactivationPreviewItemDto,
  BulkChairDeactivationResultDto,
  ChairDeactivationConflict,
  SalonChairDto,
} from "@barbercue/shared";

// Bulk chair removal (owner dashboard, requirement #27), integrated with Codex PR #229:
//   POST .../chairs/bulk-deactivate/preview {chairIds}  -> per chair READY | CONFLICT | NOT_FOUND + expectedUpdatedAt
//   POST .../chairs/bulk-deactivate/apply   {items:[{chairId, expectedUpdatedAt}]} -> per chair DEACTIVATED | CONFLICT | NOT_FOUND
//
// The server decides whether a chair is in use and applies each removal only against the exact row version the
// owner reviewed, so this file holds no occupancy rules of its own. It turns the server answer into a reviewable
// plan, splits large selections into the server's batch size, and reports every selected chair in the result.

/** The server accepts at most this many chairs per request. */
export const BULK_CHAIR_BATCH_SIZE = 50;

export function chunk<T>(items: ReadonlyArray<T>, size: number = BULK_CHAIR_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const CONFLICT_TEXT: Record<ChairDeactivationConflict, string> = {
  ACTIVE_SERVICE_SESSION: "A customer is being served in this chair. Complete the service first.",
  ACTIVE_MANUAL_OCCUPANCY: "This chair is marked occupied (in-shop customer). Free it first.",
  ASSIGNED_QUEUE_ENTRY: "A waiting customer is assigned to this chair. Seat or move them first.",
  NOT_ACTIVE: "Already out of use.",
  STALE_PREVIEW: "This chair changed after the review. Review again.",
};

export function conflictMessage(conflict: ChairDeactivationConflict): string {
  // A conflict code this screen does not know yet is shown as-is rather than hidden.
  return CONFLICT_TEXT[conflict] ?? `Not removed (${conflict}).`;
}

/**
 * REMOVE: the server reviewed it as safe to remove.
 * BLOCKED: refused by the server (in use) or no longer found; the owner has to resolve it first.
 * SKIP: already out of use, nothing to do.
 */
export type ChairRemovalVerdict = "REMOVE" | "BLOCKED" | "SKIP";

export interface ChairRemovalPlanItem {
  chairId: string;
  label: string;
  verdict: ChairRemovalVerdict;
  messages: string[];
  /** Present only for REMOVE: the exact version the server reviewed. */
  expectedUpdatedAt: string | null;
}

export interface ChairRemovalPlan {
  items: ChairRemovalPlanItem[];
  /** What would be sent to apply: only chairs the server marked READY, with their reviewed version. */
  applyItems: Array<{ chairId: string; expectedUpdatedAt: string }>;
  removableIds: string[];
  blockedIds: string[];
  skippedIds: string[];
  /** True when carrying out the plan would leave the shop with no ACTIVE chair (capacity 0). */
  leavesNoActiveChairs: boolean;
}

function planItem(
  chairId: string,
  fallbackLabel: string,
  server: BulkChairDeactivationPreviewItemDto | undefined,
): ChairRemovalPlanItem {
  if (!server) {
    return { chairId, label: fallbackLabel, verdict: "BLOCKED", messages: ["The server did not review this chair. Review again."], expectedUpdatedAt: null };
  }
  const label = server.label ?? fallbackLabel;
  if (server.disposition === "NOT_FOUND") {
    return { chairId, label, verdict: "BLOCKED", messages: ["This chair is no longer in your shop. Reload the page."], expectedUpdatedAt: null };
  }
  if (server.disposition === "READY") {
    if (!server.expectedUpdatedAt) {
      // Without a version the removal cannot be applied safely, so it is never offered.
      return { chairId, label, verdict: "BLOCKED", messages: ["Could not confirm this chair's current state. Review again."], expectedUpdatedAt: null };
    }
    return { chairId, label, verdict: "REMOVE", messages: [], expectedUpdatedAt: server.expectedUpdatedAt };
  }
  const onlyNotActive = server.conflicts.length > 0 && server.conflicts.every((c) => c === "NOT_ACTIVE");
  const messages = server.conflicts.map(conflictMessage);
  return { chairId, label, verdict: onlyNotActive ? "SKIP" : "BLOCKED", messages: messages.length ? messages : ["Not removed."], expectedUpdatedAt: null };
}

/** Builds the reviewable plan from the server's preview. Order follows the owner's selection; nothing is dropped. */
export function planFromPreview(
  selectedIds: ReadonlyArray<string>,
  chairs: ReadonlyArray<SalonChairDto>,
  preview: ReadonlyArray<BulkChairDeactivationPreviewItemDto>,
): ChairRemovalPlan {
  const labels = new Map(chairs.map((c) => [c.id, c.label]));
  const reviewed = new Map(preview.map((p) => [p.chairId, p]));
  const seen = new Set<string>();
  const items: ChairRemovalPlanItem[] = [];
  for (const id of selectedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    items.push(planItem(id, labels.get(id) ?? "Unknown chair", reviewed.get(id)));
  }
  const removing = items.filter((i) => i.verdict === "REMOVE");
  const removingIds = new Set(removing.map((i) => i.chairId));
  const remainingActive = chairs.filter((c) => c.status === ChairStatus.ACTIVE && !removingIds.has(c.id)).length;
  const hadActive = chairs.some((c) => c.status === ChairStatus.ACTIVE);
  return {
    items,
    applyItems: removing.map((i) => ({ chairId: i.chairId, expectedUpdatedAt: i.expectedUpdatedAt as string })),
    removableIds: removing.map((i) => i.chairId),
    blockedIds: items.filter((i) => i.verdict === "BLOCKED").map((i) => i.chairId),
    skippedIds: items.filter((i) => i.verdict === "SKIP").map((i) => i.chairId),
    leavesNoActiveChairs: hadActive && remainingActive === 0 && removing.length > 0,
  };
}

/** Previews the selection in server-sized batches and merges the answers. Throws if any batch fails (nothing is planned). */
export async function previewSelection(
  selectedIds: ReadonlyArray<string>,
  requestPreview: (chairIds: string[]) => Promise<BulkChairDeactivationPreviewDto>,
): Promise<BulkChairDeactivationPreviewItemDto[]> {
  const unique = [...new Set(selectedIds)];
  const merged: BulkChairDeactivationPreviewItemDto[] = [];
  for (const ids of chunk(unique)) {
    const result = await requestPreview(ids);
    merged.push(...result.items);
  }
  return merged;
}

export interface ChairRemovalResult {
  chairId: string;
  label: string;
  outcome: "REMOVED" | "FAILED" | "BLOCKED" | "SKIPPED";
  message: string;
}

export interface ChairRemovalSummary {
  results: ChairRemovalResult[];
  removed: number;
  failed: number;
  blocked: number;
  skipped: number;
}

function summarize(results: ChairRemovalResult[]): ChairRemovalSummary {
  const count = (o: ChairRemovalResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  return { results, removed: count("REMOVED"), failed: count("FAILED"), blocked: count("BLOCKED"), skipped: count("SKIPPED") };
}

/**
 * Applies a reviewed plan. Only the chairs the server marked READY are sent, each with the version it reviewed, so a
 * chair that changed since the review is refused by the server (STALE_PREVIEW) instead of being removed. A failed batch
 * is reported chair by chair and never hides the others; every selected chair appears in the summary. Never throws.
 */
export async function applyChairRemoval(options: {
  plan: ChairRemovalPlan;
  requestApply: (items: Array<{ chairId: string; expectedUpdatedAt: string }>) => Promise<BulkChairDeactivationResultDto>;
  describeError?: (err: unknown) => string;
}): Promise<ChairRemovalSummary> {
  const describe = options.describeError ?? ((err: unknown) => (err instanceof Error ? err.message : "The request failed."));
  const { plan } = options;
  const outcomes = new Map<string, ChairRemovalResult>();

  for (const item of plan.items) {
    if (item.verdict === "SKIP") outcomes.set(item.chairId, { chairId: item.chairId, label: item.label, outcome: "SKIPPED", message: "Already out of use." });
    else if (item.verdict === "BLOCKED") outcomes.set(item.chairId, { chairId: item.chairId, label: item.label, outcome: "BLOCKED", message: item.messages.join(" ") || "Not removed." });
  }

  const labelOf = new Map(plan.items.map((i) => [i.chairId, i.label]));
  for (const batch of chunk(plan.applyItems)) {
    try {
      const result = await options.requestApply(batch);
      const answered = new Map(result.items.map((r) => [r.chairId, r]));
      for (const sent of batch) {
        const label = labelOf.get(sent.chairId) ?? "Chair";
        const answer = answered.get(sent.chairId);
        if (!answer) {
          outcomes.set(sent.chairId, { chairId: sent.chairId, label, outcome: "FAILED", message: "The server did not report this chair. Reload to see its current state." });
        } else if (answer.result === "DEACTIVATED") {
          outcomes.set(sent.chairId, { chairId: sent.chairId, label: answer.label ?? label, outcome: "REMOVED", message: "Removed from active capacity." });
        } else if (answer.result === "NOT_FOUND") {
          outcomes.set(sent.chairId, { chairId: sent.chairId, label: answer.label ?? label, outcome: "BLOCKED", message: "This chair is no longer in your shop." });
        } else {
          const messages = answer.conflicts.map(conflictMessage);
          outcomes.set(sent.chairId, { chairId: sent.chairId, label: answer.label ?? label, outcome: "BLOCKED", message: messages.join(" ") || "Not removed." });
        }
      }
    } catch (err) {
      const message = describe(err);
      for (const sent of batch) {
        outcomes.set(sent.chairId, { chairId: sent.chairId, label: labelOf.get(sent.chairId) ?? "Chair", outcome: "FAILED", message });
      }
    }
  }

  return summarize(plan.items.map((i) => outcomes.get(i.chairId) as ChairRemovalResult));
}
