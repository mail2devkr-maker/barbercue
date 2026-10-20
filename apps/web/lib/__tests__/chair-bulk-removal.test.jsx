// Pure logic and a fake API only: no browser, no network, no production data. The server (PR #229) decides what is in use.
import { ChairStatus } from "@barbercue/shared";
import { BULK_CHAIR_BATCH_SIZE, applyChairRemoval, chunk, conflictMessage, planFromPreview, previewSelection } from "../chair-bulk-removal";

const chair = (id, label, status = ChairStatus.ACTIVE) => ({ id, label, status });
const chairs = [chair("c1", "Chair 1"), chair("c2", "Chair 2"), chair("c3", "Chair 3"), chair("c4", "Chair 4", ChairStatus.INACTIVE)];

const ready = (id, version = "2026-10-17T08:00:00.000Z") => ({ chairId: id, label: id, status: "ACTIVE", expectedUpdatedAt: version, disposition: "READY", conflicts: [] });
const conflict = (id, ...conflicts) => ({ chairId: id, label: id, status: "ACTIVE", expectedUpdatedAt: "2026-10-17T08:00:00.000Z", disposition: "CONFLICT", conflicts });
const missing = (id) => ({ chairId: id, label: null, status: null, expectedUpdatedAt: null, disposition: "NOT_FOUND", conflicts: [] });

describe("chunk", () => {
  it("splits into the server's batch size", () => {
    expect(BULK_CHAIR_BATCH_SIZE).toBe(50);
    const ids = Array.from({ length: 120 }, (_, i) => `c${i}`);
    expect(chunk(ids).map((b) => b.length)).toEqual([50, 50, 20]);
    expect(chunk([])).toEqual([]);
  });
});

describe("conflictMessage", () => {
  it("explains each server conflict and never hides an unknown one", () => {
    expect(conflictMessage("ACTIVE_SERVICE_SESSION")).toContain("being served");
    expect(conflictMessage("ASSIGNED_QUEUE_ENTRY")).toContain("assigned");
    expect(conflictMessage("STALE_PREVIEW")).toContain("Review again");
    expect(conflictMessage("SOMETHING_NEW")).toContain("SOMETHING_NEW");
  });
});

describe("planFromPreview", () => {
  it("offers READY chairs with the exact version the server reviewed", () => {
    const plan = planFromPreview(["c1", "c2"], chairs, [ready("c1", "v1"), ready("c2", "v2")]);
    expect(plan.removableIds).toEqual(["c1", "c2"]);
    expect(plan.applyItems).toEqual([{ chairId: "c1", expectedUpdatedAt: "v1" }, { chairId: "c2", expectedUpdatedAt: "v2" }]);
    expect(plan.leavesNoActiveChairs).toBe(false);
  });

  it("blocks a chair the server refused and keeps it out of the apply list", () => {
    const plan = planFromPreview(["c1", "c2"], chairs, [ready("c1"), conflict("c2", "ACTIVE_SERVICE_SESSION", "ASSIGNED_QUEUE_ENTRY")]);
    expect(plan.removableIds).toEqual(["c1"]);
    expect(plan.blockedIds).toEqual(["c2"]);
    expect(plan.applyItems.map((i) => i.chairId)).toEqual(["c1"]);
    const blocked = plan.items.find((i) => i.chairId === "c2");
    expect(blocked.messages).toHaveLength(2);
  });

  it("treats a chair that is only 'not active' as already removed", () => {
    const plan = planFromPreview(["c4"], chairs, [conflict("c4", "NOT_ACTIVE")]);
    expect(plan.skippedIds).toEqual(["c4"]);
    expect(plan.blockedIds).toEqual([]);
  });

  it("blocks unknown, not found or unversioned chairs instead of dropping them", () => {
    const noVersion = { ...ready("c2"), expectedUpdatedAt: null };
    const plan = planFromPreview(["c1", "c2", "c3", "zzz"], chairs, [missing("c1"), noVersion, ready("c3")]);
    expect(plan.removableIds).toEqual(["c3"]);
    expect(plan.blockedIds).toEqual(["c1", "c2", "zzz"]);
    expect(plan.items).toHaveLength(4);
  });

  it("ignores duplicate selections and keeps the selection order", () => {
    const plan = planFromPreview(["c2", "c1", "c2"], chairs, [ready("c1"), ready("c2")]);
    expect(plan.items.map((i) => i.chairId)).toEqual(["c2", "c1"]);
  });

  it("warns when the removal would leave no active chair", () => {
    expect(planFromPreview(["c1", "c2", "c3"], chairs, [ready("c1"), ready("c2"), ready("c3")]).leavesNoActiveChairs).toBe(true);
    expect(planFromPreview(["c1", "c2", "c3"], chairs, [ready("c1"), ready("c2"), conflict("c3", "ACTIVE_MANUAL_OCCUPANCY")]).leavesNoActiveChairs).toBe(false);
  });
});

describe("previewSelection", () => {
  it("previews in batches of 50 and merges every answer", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `c${i}`);
    const batches = [];
    const items = await previewSelection([...ids, "c0"], async (chairIds) => {
      batches.push(chairIds.length);
      return { salonId: "s1", items: chairIds.map((id) => ready(id)) };
    });
    expect(batches).toEqual([50, 50, 20]);
    expect(items).toHaveLength(120);
  });

  it("fails as a whole when any batch fails, so nothing is planned", async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `c${i}`);
    let call = 0;
    await expect(previewSelection(ids, async (chairIds) => {
      call += 1;
      if (call === 2) throw new Error("offline");
      return { salonId: "s1", items: chairIds.map((id) => ready(id)) };
    })).rejects.toThrow("offline");
  });
});

describe("applyChairRemoval", () => {
  const plan = () => planFromPreview(["c1", "c2", "c3", "c4"], chairs, [ready("c1", "v1"), conflict("c2", "ACTIVE_SERVICE_SESSION"), ready("c3", "v3"), conflict("c4", "NOT_ACTIVE")]);

  it("sends only reviewed READY chairs with their version and reports every selected chair", async () => {
    const sent = [];
    const summary = await applyChairRemoval({
      plan: plan(),
      requestApply: async (items) => {
        sent.push(items);
        return { salonId: "s1", deactivatedCount: 2, items: items.map((i) => ({ chairId: i.chairId, label: i.chairId, result: "DEACTIVATED", conflicts: [] })) };
      },
    });
    expect(sent).toEqual([[{ chairId: "c1", expectedUpdatedAt: "v1" }, { chairId: "c3", expectedUpdatedAt: "v3" }]]);
    expect(summary.results.map((r) => [r.chairId, r.outcome])).toEqual([["c1", "REMOVED"], ["c2", "BLOCKED"], ["c3", "REMOVED"], ["c4", "SKIPPED"]]);
    expect([summary.removed, summary.blocked, summary.skipped, summary.failed]).toEqual([2, 1, 1, 0]);
  });

  it("reports a chair the server refused at apply time (changed since the review)", async () => {
    const summary = await applyChairRemoval({
      plan: plan(),
      requestApply: async () => ({
        salonId: "s1",
        deactivatedCount: 1,
        items: [
          { chairId: "c1", label: "c1", result: "DEACTIVATED", conflicts: [] },
          { chairId: "c3", label: "c3", result: "CONFLICT", conflicts: ["STALE_PREVIEW"] },
        ],
      }),
    });
    expect(summary.removed).toBe(1);
    const stale = summary.results.find((r) => r.chairId === "c3");
    expect(stale.outcome).toBe("BLOCKED");
    expect(stale.message).toContain("Review again");
  });

  it("marks a chair the server did not report as failed, not removed", async () => {
    const summary = await applyChairRemoval({ plan: plan(), requestApply: async () => ({ salonId: "s1", deactivatedCount: 0, items: [] }) });
    expect(summary.results.find((r) => r.chairId === "c1").outcome).toBe("FAILED");
    expect(summary.removed).toBe(0);
  });

  it("reports a failed request for those chairs only, without throwing, and still lists the others", async () => {
    const summary = await applyChairRemoval({ plan: plan(), requestApply: async () => { throw new Error("Server refused"); } });
    expect(summary.failed).toBe(2);
    expect(summary.results.find((r) => r.chairId === "c1").message).toBe("Server refused");
    expect(summary.results.find((r) => r.chairId === "c2").outcome).toBe("BLOCKED");
    expect(summary.results).toHaveLength(4);
  });

  it("sends nothing when no chair is removable", async () => {
    const requestApply = jest.fn();
    const none = planFromPreview(["c2"], chairs, [conflict("c2", "ACTIVE_MANUAL_OCCUPANCY")]);
    const summary = await applyChairRemoval({ plan: none, requestApply });
    expect(requestApply).not.toHaveBeenCalled();
    expect(summary.blocked).toBe(1);
  });

  it("splits a large plan into batches of 50 and keeps going when one batch fails", async () => {
    const many = Array.from({ length: 60 }, (_, i) => chair(`m${i}`, `M${i}`));
    const p = planFromPreview(many.map((c) => c.id), many, many.map((c) => ready(c.id)));
    let call = 0;
    const summary = await applyChairRemoval({
      plan: p,
      requestApply: async (items) => {
        call += 1;
        if (call === 1) throw new Error("batch 1 failed");
        return { salonId: "s1", deactivatedCount: items.length, items: items.map((i) => ({ chairId: i.chairId, label: i.chairId, result: "DEACTIVATED", conflicts: [] })) };
      },
    });
    expect(call).toBe(2);
    expect(summary.failed).toBe(50);
    expect(summary.removed).toBe(10);
  });
});
