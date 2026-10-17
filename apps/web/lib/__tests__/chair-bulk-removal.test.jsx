// Pure logic and a fake API only: no browser, no network, no production data.
import { ChairStatus } from "@barbercue/shared";
import { planChairRemoval, executeChairRemoval } from "../chair-bulk-removal";

const chair = (id, label, status = ChairStatus.ACTIVE) => ({ id, label, status });
const live = (id, over = {}) => ({ id, label: id, occupancy: "FREE", manualOccupancyId: null, activeServiceSessionId: null, tokenNumber: null, reservedForEntryId: null, reservedForTokenNumber: null, ...over });

const chairs = [chair("c1", "Chair 1"), chair("c2", "Chair 2"), chair("c3", "Chair 3"), chair("c4", "Chair 4", ChairStatus.MAINTENANCE), chair("c5", "Chair 5", ChairStatus.INACTIVE)];

describe("planChairRemoval", () => {
  it("lets free chairs be removed", () => {
    const plan = planChairRemoval(["c1", "c2"], chairs, [live("c1"), live("c2"), live("c3")]);
    expect(plan.removableIds).toEqual(["c1", "c2"]);
    expect(plan.blockedIds).toEqual([]);
    expect(plan.leavesNoActiveChairs).toBe(false);
  });

  it("BLOCKS a chair with a customer being served, with the token in the reason", () => {
    const plan = planChairRemoval(["c1"], chairs, [live("c1", { occupancy: "FASTQUE", activeServiceSessionId: "s1", tokenNumber: 12 })]);
    expect(plan.items[0].verdict).toBe("BLOCKED");
    expect(plan.items[0].conflicts[0].kind).toBe("IN_SERVICE");
    expect(plan.items[0].conflicts[0].message).toContain("#12");
    expect(plan.removableIds).toEqual([]);
  });

  it("BLOCKS a chair marked occupied for an in-shop customer", () => {
    const plan = planChairRemoval(["c2"], chairs, [live("c2", { occupancy: "LOCAL", manualOccupancyId: "m1" })]);
    expect(plan.items[0].verdict).toBe("BLOCKED");
    expect(plan.items[0].conflicts[0].kind).toBe("MANUAL_OCCUPANCY");
  });

  it("WARNS (does not block) when an assigned customer holds the chair: they go back to waiting", () => {
    const plan = planChairRemoval(["c3"], chairs, [live("c3", { reservedForEntryId: "e1", reservedForTokenNumber: 7 })]);
    expect(plan.items[0].verdict).toBe("REMOVE_WITH_WARNING");
    expect(plan.removableIds).toEqual(["c3"]);
    expect(plan.warningIds).toEqual(["c3"]);
    expect(plan.items[0].conflicts[0].message).toContain("back to waiting");
  });

  it("a chair that is both in service and reserved is still BLOCKED", () => {
    const plan = planChairRemoval(["c1"], chairs, [live("c1", { occupancy: "FASTQUE", activeServiceSessionId: "s1", reservedForEntryId: "e1" })]);
    expect(plan.items[0].verdict).toBe("BLOCKED");
  });

  it("allows a chair under repair that is not on the live board (it cannot be occupied)", () => {
    const plan = planChairRemoval(["c4"], chairs, [live("c1")]);
    expect(plan.items[0].verdict).toBe("REMOVE");
  });

  it("blocks an ACTIVE chair that is missing from the live board (cannot verify)", () => {
    const plan = planChairRemoval(["c2"], chairs, [live("c1")]);
    expect(plan.items[0].verdict).toBe("BLOCKED");
    expect(plan.items[0].conflicts[0].kind).toBe("UNKNOWN_OCCUPANCY");
  });

  it("refuses everything when the live board could not be read", () => {
    const plan = planChairRemoval(["c1", "c2"], chairs, null);
    expect(plan.boardKnown).toBe(false);
    expect(plan.removableIds).toEqual([]);
    expect(plan.blockedIds).toEqual(["c1", "c2"]);
  });

  it("skips chairs that are already removed, and ignores duplicates", () => {
    const plan = planChairRemoval(["c5", "c1", "c1"], chairs, [live("c1")]);
    expect(plan.skippedIds).toEqual(["c5"]);
    expect(plan.items).toHaveLength(2);
  });

  it("reports an unknown id as blocked instead of dropping it", () => {
    const plan = planChairRemoval(["nope"], chairs, [live("c1")]);
    expect(plan.items[0].verdict).toBe("BLOCKED");
  });

  it("flags when the removal would leave no ACTIVE chair", () => {
    const only = [chair("a", "A"), chair("b", "B")];
    const plan = planChairRemoval(["a", "b"], only, [live("a"), live("b")]);
    expect(plan.leavesNoActiveChairs).toBe(true);
    const partial = planChairRemoval(["a"], only, [live("a"), live("b")]);
    expect(partial.leavesNoActiveChairs).toBe(false);
  });

  it("does not flag 'no chairs left' when nothing is removable", () => {
    const only = [chair("a", "A")];
    const plan = planChairRemoval(["a"], only, [live("a", { occupancy: "FASTQUE", activeServiceSessionId: "s" })]);
    expect(plan.leavesNoActiveChairs).toBe(false);
  });
});

describe("executeChairRemoval", () => {
  it("removes the removable chairs and reports every selected chair", async () => {
    const removed = [];
    const summary = await executeChairRemoval({
      selectedIds: ["c1", "c2", "c5"],
      chairs,
      fetchBoard: async () => [live("c1"), live("c2")],
      removeChair: async (id) => { removed.push(id); },
    });
    expect(removed).toEqual(["c1", "c2"]);
    expect(summary).toMatchObject({ removed: 2, failed: 0, blocked: 0, skipped: 1 });
    expect(summary.results.map((r) => r.chairId)).toEqual(["c1", "c2", "c5"]);
  });

  it("re-reads the board and does NOT touch a chair that became occupied after the preview", async () => {
    const removed = [];
    const summary = await executeChairRemoval({
      selectedIds: ["c1", "c2"],
      chairs,
      fetchBoard: async () => [live("c1"), live("c2", { occupancy: "FASTQUE", activeServiceSessionId: "s9", tokenNumber: 4 })],
      removeChair: async (id) => { removed.push(id); },
    });
    expect(removed).toEqual(["c1"]);
    expect(summary.blocked).toBe(1);
    expect(summary.results.find((r) => r.chairId === "c2").message).toContain("#4");
  });

  it("never sends a request when the board cannot be read", async () => {
    const removeChair = jest.fn();
    const summary = await executeChairRemoval({
      selectedIds: ["c1"],
      chairs,
      fetchBoard: async () => { throw new Error("offline"); },
      removeChair,
    });
    expect(removeChair).not.toHaveBeenCalled();
    expect(summary.blocked).toBe(1);
  });

  it("a failure on one chair is reported and does not stop the others", async () => {
    const summary = await executeChairRemoval({
      selectedIds: ["c1", "c2", "c3"],
      chairs,
      fetchBoard: async () => [live("c1"), live("c2"), live("c3")],
      removeChair: async (id) => { if (id === "c2") throw new Error("Server said no"); },
      describeError: (e) => e.message,
    });
    expect(summary).toMatchObject({ removed: 2, failed: 1 });
    expect(summary.results.find((r) => r.outcome === "FAILED")).toMatchObject({ chairId: "c2", message: "Server said no" });
  });

  it("tells the owner an assigned customer went back to waiting", async () => {
    const summary = await executeChairRemoval({
      selectedIds: ["c3"],
      chairs,
      fetchBoard: async () => [live("c3", { reservedForEntryId: "e1", reservedForTokenNumber: 2 })],
      removeChair: async () => {},
    });
    expect(summary.results[0].message).toContain("went back to waiting");
  });
});
