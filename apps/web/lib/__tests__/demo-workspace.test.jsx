// Pure parsing and confirmation rules only (owner decision D3). Shapes are the contract's proposal, so parsing is defensive.
import * as D from "../demo-workspace";

describe("parseDemoStatus", () => {
  it("reads an inactive workspace", () => {
    expect(D.parseDemoStatus({ active: false, workspaceId: null, label: "DEMO DATA — Not real business records" })).toEqual({
      active: false, workspaceId: null, label: "DEMO DATA — Not real business records", counts: null,
    });
  });
  it("reads an active workspace with its counts, keeping only numbers", () => {
    const s = D.parseDemoStatus({ active: true, workspaceId: "w1", label: "DEMO", counts: { customers: 12, staff: 3, services: 8, visits: "x", bookings: -1, extra: 4 } });
    expect(s.active).toBe(true);
    expect(s.workspaceId).toBe("w1");
    expect(s.counts).toEqual({ customers: 12, staff: 3, services: 8 });
  });
  it("never treats a workspace as active unless the server says exactly true and names it", () => {
    expect(D.parseDemoStatus({ active: true, workspaceId: null }).active).toBe(false);
    expect(D.parseDemoStatus({ active: "true", workspaceId: "w1" }).active).toBe(false);
    expect(D.parseDemoStatus({ active: 1, workspaceId: "w1" }).active).toBe(false);
  });
  it("falls back to the standard demo label and tolerates garbage", () => {
    expect(D.parseDemoStatus({ active: false, label: "  " }).label).toBe(D.DEFAULT_DEMO_LABEL);
    for (const raw of [undefined, null, "x", []]) expect(D.parseDemoStatus(raw)).toEqual({ active: false, workspaceId: null, label: D.DEFAULT_DEMO_LABEL, counts: null });
  });
});

describe("delete confirmation", () => {
  it("needs the exact phrase, ignoring surrounding spaces only", () => {
    expect(D.DELETE_CONFIRMATION).toBe("DELETE DEMO DATA");
    expect(D.confirmationMatches("DELETE DEMO DATA")).toBe(true);
    expect(D.confirmationMatches("  DELETE DEMO DATA \n")).toBe(true);
    for (const bad of ["", "delete demo data", "DELETE DEMO", "DELETE  DEMO DATA", "DELETE DEMO DATA!"]) expect(D.confirmationMatches(bad)).toBe(false);
  });
  it("builds the delete body from the workspace and the preview token", () => {
    expect(D.deleteBody("w1", "tok")).toEqual({ workspaceId: "w1", confirmation: "DELETE DEMO DATA", confirmationToken: "tok" });
  });
  it("accepts a preview only when it carries a token", () => {
    expect(D.parseDeletePreview({ confirmationToken: "tok", expiresAt: "2026-10-17T10:02:00.000Z" })).toEqual({ confirmationToken: "tok", expiresAt: "2026-10-17T10:02:00.000Z" });
    expect(D.parseDeletePreview({ confirmationToken: "tok" }).expiresAt).toBeNull();
    for (const raw of [null, {}, { confirmationToken: "" }, { confirmationToken: 5 }, "tok"]) expect(D.parseDeletePreview(raw)).toBeNull();
  });
  it("knows when a preview has expired", () => {
    const now = new Date("2026-10-17T10:00:00.000Z");
    expect(D.previewExpired({ confirmationToken: "t", expiresAt: "2026-10-17T09:59:59.000Z" }, now)).toBe(true);
    expect(D.previewExpired({ confirmationToken: "t", expiresAt: "2026-10-17T10:02:00.000Z" }, now)).toBe(false);
    expect(D.previewExpired({ confirmationToken: "t", expiresAt: null }, now)).toBe(false);
  });
});

describe("countRows", () => {
  it("lists only reported counts in a fixed order", () => {
    expect(D.countRows({ visits: 5, customers: 2 })).toEqual([{ key: "customers", label: "Customers", value: 2 }, { key: "visits", label: "Visits", value: 5 }]);
    expect(D.countRows(null)).toEqual([]);
  });
});
