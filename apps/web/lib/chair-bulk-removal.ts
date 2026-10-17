import { ChairStatus } from "@barbercue/shared";
import type { ChairOptionDto, SalonChairDto } from "@barbercue/shared";

// Bulk chair removal (owner dashboard, requirement #27).
//
// The server does NOT refuse to set a chair INACTIVE while a customer is being served in it: it only
// sends an assigned-but-not-started customer back to waiting (SalonChairsService.update). So the
// "never silently remove a chair that is in use" rule has to be enforced here, from the live queue
// board, before any request is sent - and re-checked right before each removal, because a chair can be
// taken between the preview and the confirmation. A server-side dry run would be authoritative
// (requested in the contract issue); until it exists this is the safety net.

export type ChairConflictKind = "IN_SERVICE" | "MANUAL_OCCUPANCY" | "RESERVED_FOR_CUSTOMER" | "UNKNOWN_OCCUPANCY";

export interface ChairConflict {
  kind: ChairConflictKind;
  message: string;
}

/**
 * REMOVE: nothing in the way.
 * REMOVE_WITH_WARNING: allowed, but the owner must know what happens (an assigned customer goes back to waiting).
 * BLOCKED: refused here; the owner has to finish or free the chair first.
 * SKIP: already out of use, nothing to do.
 */
export type ChairRemovalVerdict = "REMOVE" | "REMOVE_WITH_WARNING" | "BLOCKED" | "SKIP";

export interface ChairRemovalPlanItem {
  chairId: string;
  label: string;
  verdict: ChairRemovalVerdict;
  conflicts: ChairConflict[];
}

export interface ChairRemovalPlan {
  items: ChairRemovalPlanItem[];
  /** Chairs that will be sent a removal request (REMOVE and REMOVE_WITH_WARNING). */
  removableIds: string[];
  blockedIds: string[];
  warningIds: string[];
  skippedIds: string[];
  /** True when carrying out the plan would leave the shop with no ACTIVE chair (capacity 0). */
  leavesNoActiveChairs: boolean;
  /** False when the live board could not be read: then nothing is removable. */
  boardKnown: boolean;
}

function tokenText(token: number | null | undefined): string {
  return typeof token === "number" ? ` (token #${token})` : "";
}

export function planChairRemoval(
  selectedIds: ReadonlyArray<string>,
  chairs: ReadonlyArray<SalonChairDto>,
  board: ReadonlyArray<ChairOptionDto> | null,
): ChairRemovalPlan {
  const byId = new Map(chairs.map((c) => [c.id, c]));
  const boardById = new Map((board ?? []).map((c) => [c.id, c]));
  const items: ChairRemovalPlanItem[] = [];
  const seen = new Set<string>();

  for (const id of selectedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const chair = byId.get(id);
    if (!chair) {
      items.push({ chairId: id, label: "Unknown chair", verdict: "BLOCKED", conflicts: [{ kind: "UNKNOWN_OCCUPANCY", message: "This chair is no longer in your list. Reload the page." }] });
      continue;
    }
    if (chair.status === ChairStatus.INACTIVE) {
      items.push({ chairId: id, label: chair.label, verdict: "SKIP", conflicts: [] });
      continue;
    }
    if (board === null) {
      items.push({
        chairId: id,
        label: chair.label,
        verdict: "BLOCKED",
        conflicts: [{ kind: "UNKNOWN_OCCUPANCY", message: "Could not check whether this chair is in use right now. Reload and try again." }],
      });
      continue;
    }
    const live = boardById.get(id);
    const conflicts: ChairConflict[] = [];
    if (!live) {
      // The board lists the chairs that can seat a customer. A chair under repair is not on it and cannot be occupied.
      if (chair.status === ChairStatus.ACTIVE) {
        conflicts.push({ kind: "UNKNOWN_OCCUPANCY", message: "This chair is missing from the live queue, so its use cannot be checked. Reload and try again." });
      }
    } else {
      if (live.occupancy === "FASTQUE" || live.activeServiceSessionId) {
        conflicts.push({ kind: "IN_SERVICE", message: `A customer is being served in this chair${tokenText(live.tokenNumber)}. Complete the service first.` });
      }
      if (live.occupancy === "LOCAL" || live.manualOccupancyId) {
        conflicts.push({ kind: "MANUAL_OCCUPANCY", message: "This chair is marked occupied (in-shop customer). Free it first." });
      }
      if (live.reservedForEntryId) {
        conflicts.push({
          kind: "RESERVED_FOR_CUSTOMER",
          message: `Reserved for an assigned customer${tokenText(live.reservedForTokenNumber)}. That customer will go back to waiting.`,
        });
      }
    }
    const hardBlock = conflicts.some((c) => c.kind !== "RESERVED_FOR_CUSTOMER");
    const verdict: ChairRemovalVerdict = hardBlock ? "BLOCKED" : conflicts.length > 0 ? "REMOVE_WITH_WARNING" : "REMOVE";
    items.push({ chairId: id, label: chair.label, verdict, conflicts });
  }

  const removableIds = items.filter((i) => i.verdict === "REMOVE" || i.verdict === "REMOVE_WITH_WARNING").map((i) => i.chairId);
  const removing = new Set(removableIds);
  const remainingActive = chairs.filter((c) => c.status === ChairStatus.ACTIVE && !removing.has(c.id)).length;
  const hadActive = chairs.some((c) => c.status === ChairStatus.ACTIVE);

  return {
    items,
    removableIds,
    blockedIds: items.filter((i) => i.verdict === "BLOCKED").map((i) => i.chairId),
    warningIds: items.filter((i) => i.verdict === "REMOVE_WITH_WARNING").map((i) => i.chairId),
    skippedIds: items.filter((i) => i.verdict === "SKIP").map((i) => i.chairId),
    leavesNoActiveChairs: hadActive && remainingActive === 0 && removableIds.length > 0,
    boardKnown: board !== null,
  };
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
 * Carries out a reviewed plan one chair at a time. Right before sending anything the live board is read
 * again and the plan is recomputed: a chair that became occupied since the preview is reported as
 * BLOCKED and is not touched. A failure on one chair never stops or hides the others, and the summary
 * lists every selected chair so nothing is dropped silently. Never throws.
 */
export async function executeChairRemoval(options: {
  selectedIds: ReadonlyArray<string>;
  chairs: ReadonlyArray<SalonChairDto>;
  fetchBoard: () => Promise<ReadonlyArray<ChairOptionDto>>;
  removeChair: (chairId: string) => Promise<void>;
  describeError?: (err: unknown) => string;
}): Promise<ChairRemovalSummary> {
  const describe = options.describeError ?? ((err: unknown) => (err instanceof Error ? err.message : "The request failed."));
  let freshBoard: ReadonlyArray<ChairOptionDto> | null = null;
  try {
    freshBoard = await options.fetchBoard();
  } catch {
    freshBoard = null;
  }
  const plan = planChairRemoval(options.selectedIds, options.chairs, freshBoard);
  const results: ChairRemovalResult[] = [];
  for (const item of plan.items) {
    if (item.verdict === "SKIP") {
      results.push({ chairId: item.chairId, label: item.label, outcome: "SKIPPED", message: "Already out of use." });
      continue;
    }
    if (item.verdict === "BLOCKED") {
      results.push({ chairId: item.chairId, label: item.label, outcome: "BLOCKED", message: item.conflicts.map((c) => c.message).join(" ") || "Not removed." });
      continue;
    }
    try {
      await options.removeChair(item.chairId);
      results.push({
        chairId: item.chairId,
        label: item.label,
        outcome: "REMOVED",
        message: item.verdict === "REMOVE_WITH_WARNING" ? "Removed. The assigned customer went back to waiting." : "Removed from active capacity.",
      });
    } catch (err) {
      results.push({ chairId: item.chairId, label: item.label, outcome: "FAILED", message: describe(err) });
    }
  }
  return summarize(results);
}
