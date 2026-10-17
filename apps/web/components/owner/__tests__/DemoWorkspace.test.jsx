import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { DemoWorkspace } from "../DemoWorkspace";
import { apiFetch, ApiError } from "../../../lib/api";
import { resetCapabilitiesCache } from "../../../lib/use-capabilities";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));

jest.mock("../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join(" ");
  return collect(node.children);
};
const text = (r) => collect(r.toJSON());
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const button = (r, label) => r.root.findAllByType("button").find((b) => new RegExp(label).test(collect(b.props.children)));
const lastDeleteButton = (r) => r.root.findAllByType("button").filter((b) => /Delete demo data/.test(collect(b.props.children))).at(-1);

const INACTIVE = { active: false, workspaceId: null, label: "DEMO DATA — Not real business records" };
const ACTIVE = { active: true, workspaceId: "w-1", label: "DEMO DATA — Not real business records", counts: { customers: 12, staff: 3, chairs: 4, services: 8, visits: 40, bookings: 25, invoices: 18, reviews: 9 } };

let calls;
let statusAnswer;
function install({ capability = { status: "ENABLED" }, status = INACTIVE, onImport, onPreview, onDelete } = {}) {
  calls = [];
  statusAnswer = status;
  apiFetch.mockImplementation(async (path, opts) => {
    calls.push({ path, opts });
    if (path.endsWith("/capabilities")) {
      if (capability === "ERROR") throw new Error("not found");
      return capability ? { features: { demoData: capability } } : { features: {} };
    }
    if (path.endsWith("/demo/status")) return statusAnswer;
    if (path.endsWith("/demo/import")) return onImport ? onImport() : ACTIVE;
    if (path.endsWith("/demo/delete-preview")) return onPreview ? onPreview() : { confirmationToken: "tok-1", expiresAt: new Date(Date.now() + 120000).toISOString() };
    if (path.endsWith("/demo") && opts?.method === "DELETE") return onDelete ? onDelete(opts) : {};
    throw new Error(`unexpected ${path}`);
  });
}

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<DemoWorkspace salonId="s1" />); });
  await flush();
  await flush();
  return r;
}

async function openDeleteConfirmation(r) {
  await act(async () => { button(r, "Delete demo data").props.onClick(); });
  await flush();
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  resetCapabilitiesCache();
});

describe("DemoWorkspace availability", () => {
  it("says honestly that demo data is unavailable and calls nothing else when the capability is off", async () => {
    install({ capability: { status: "DISABLED", reasonCode: "FEATURE_DISABLED" } });
    const r = await mount();
    expect(text(r)).toContain("Demo data is not available yet");
    expect(text(r)).toContain("Nothing about your real shop is affected");
    expect(calls.some((c) => c.path.includes("/demo"))).toBe(false);
  });

  it("is unavailable when the server cannot report capabilities", async () => {
    install({ capability: "ERROR" });
    const r = await mount();
    expect(text(r)).toContain("not available");
    expect(calls.some((c) => c.path.includes("/demo"))).toBe(false);
  });

  it("labels sandbox mode", async () => {
    install({ capability: { status: "SANDBOX" } });
    const r = await mount();
    expect(text(r)).toContain("test mode");
  });
});

describe("DemoWorkspace import", () => {
  it("offers to add demo data when none exists and explains it is separate from real data", async () => {
    install();
    const r = await mount();
    const t = text(r);
    expect(t).toContain("You have no demo data right now");
    expect(t).toContain("separate private workspace");
    expect(t).toContain("never mixes with your real");
    expect(button(r, "Delete demo data")).toBeUndefined();
  });

  it("imports with an idempotency key and shows the server's label and counts", async () => {
    install();
    const r = await mount();
    await act(async () => { button(r, "Add demo data").props.onClick(); });
    await flush();
    const post = calls.find((c) => c.path.endsWith("/demo/import"));
    expect(post.opts.method).toBe("POST");
    expect(post.opts.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    const t = text(r);
    expect(t).toContain("DEMO DATA — Not real business records");
    expect(t).toMatch(/Customers\s+12/);
    expect(t).toContain("Your real shop was not changed");
  });

  it("does not claim success when the server does not confirm an active workspace", async () => {
    install({ onImport: () => ({ active: false }) });
    const r = await mount();
    await act(async () => { button(r, "Add demo data").props.onClick(); });
    await flush();
    expect(text(r)).toContain("did not confirm");
    expect(text(r)).not.toContain("Demo data added");
  });

  it("shows the server's message when the import fails", async () => {
    install({ onImport: () => { throw new ApiError("Demo data is already active.", 409); } });
    const r = await mount();
    await act(async () => { button(r, "Add demo data").props.onClick(); });
    await flush();
    expect(text(r)).toContain("Demo data is already active.");
  });
});

describe("DemoWorkspace deletion", () => {
  it("asks the server for a confirmation token first and deletes nothing yet", async () => {
    install({ status: ACTIVE });
    const r = await mount();
    await openDeleteConfirmation(r);
    expect(calls.find((c) => c.path.endsWith("/demo/delete-preview")).opts.method).toBe("POST");
    expect(calls.some((c) => c.opts?.method === "DELETE")).toBe(false);
    expect(text(r)).toContain("DELETE DEMO DATA");
    expect(text(r)).toContain("real customers, bookings, revenue and reports are not touched");
  });

  it("keeps the final button disabled until the exact phrase is typed", async () => {
    install({ status: ACTIVE });
    const r = await mount();
    await openDeleteConfirmation(r);
    expect(lastDeleteButton(r).props.disabled).toBe(true);
    await act(async () => { r.root.findByProps({ id: "demo-confirm" }).props.onChange({ target: { value: "delete demo data" } }); });
    expect(lastDeleteButton(r).props.disabled).toBe(true);
    await act(async () => { r.root.findByProps({ id: "demo-confirm" }).props.onChange({ target: { value: "DELETE DEMO DATA" } }); });
    expect(lastDeleteButton(r).props.disabled).toBe(false);
  });

  it("sends the workspace, the phrase and the token, then reloads the status", async () => {
    install({ status: ACTIVE, onDelete: () => { statusAnswer = INACTIVE; return {}; } });
    const r = await mount();
    await openDeleteConfirmation(r);
    await act(async () => { r.root.findByProps({ id: "demo-confirm" }).props.onChange({ target: { value: "DELETE DEMO DATA" } }); });
    await act(async () => { lastDeleteButton(r).props.onClick(); });
    await flush();
    const del = calls.find((c) => c.opts?.method === "DELETE");
    expect(JSON.parse(del.opts.body)).toEqual({ workspaceId: "w-1", confirmation: "DELETE DEMO DATA", confirmationToken: "tok-1" });
    const t = text(r);
    expect(t).toContain("Demo data deleted");
    expect(t).toContain("You have no demo data right now");
  });

  it("refuses to send an expired confirmation", async () => {
    install({ status: ACTIVE, onPreview: () => ({ confirmationToken: "old", expiresAt: new Date(Date.now() - 1000).toISOString() }) });
    const r = await mount();
    await openDeleteConfirmation(r);
    await act(async () => { r.root.findByProps({ id: "demo-confirm" }).props.onChange({ target: { value: "DELETE DEMO DATA" } }); });
    await act(async () => { lastDeleteButton(r).props.onClick(); });
    expect(calls.some((c) => c.opts?.method === "DELETE")).toBe(false);
    expect(text(r)).toContain("expired");
  });

  it("deletes nothing when the server returns no confirmation token", async () => {
    install({ status: ACTIVE, onPreview: () => ({}) });
    const r = await mount();
    await openDeleteConfirmation(r);
    expect(text(r)).toContain("Nothing was deleted");
    expect(r.root.findAllByProps({ id: "demo-confirm" })).toHaveLength(0);
  });

  it("shows the server's message when the deletion is refused and keeps the workspace", async () => {
    install({ status: ACTIVE, onDelete: () => { throw new ApiError("The confirmation is no longer valid.", 409); } });
    const r = await mount();
    await openDeleteConfirmation(r);
    await act(async () => { r.root.findByProps({ id: "demo-confirm" }).props.onChange({ target: { value: "DELETE DEMO DATA" } }); });
    await act(async () => { lastDeleteButton(r).props.onClick(); });
    await flush();
    expect(text(r)).toContain("The confirmation is no longer valid.");
    expect(text(r)).toContain("DEMO DATA — Not real business records");
  });

  it("cancelling leaves everything in place", async () => {
    install({ status: ACTIVE });
    const r = await mount();
    await openDeleteConfirmation(r);
    await act(async () => { button(r, "Cancel").props.onClick(); });
    expect(r.root.findAllByProps({ id: "demo-confirm" })).toHaveLength(0);
    expect(calls.some((c) => c.opts?.method === "DELETE")).toBe(false);
  });

  it("offers a link to the read-only demo dashboard while demo data exists", async () => {
    install({ status: ACTIVE });
    const r = await mount();
    const link = r.root.findAll((n) => n.props?.href === "/dashboard/salons/s1/demo/view");
    expect(link.length).toBeGreaterThan(0);
    expect(text(r)).toContain("Open demo dashboard");
    expect(text(r)).not.toContain("not available yet");
  });

  it("offers no demo dashboard link when there is no demo data", async () => {
    install();
    const r = await mount();
    expect(text(r)).not.toContain("Open demo dashboard");
  });

  it("offers a way back to the real shop after the demo data is deleted", async () => {
    install({ status: ACTIVE, onDelete: () => { statusAnswer = INACTIVE; return { deleted: true, deletedWorkspaceId: "w-1" }; } });
    const r = await mount();
    await openDeleteConfirmation(r);
    await act(async () => { r.root.findByProps({ id: "demo-confirm" }).props.onChange({ target: { value: "DELETE DEMO DATA" } }); });
    await act(async () => { lastDeleteButton(r).props.onClick(); });
    await flush();
    expect(text(r)).toContain("Demo data deleted");
    expect(text(r)).toContain("Back to real shop");
    expect(r.root.findAll((n) => n.props?.href === "/dashboard/salons/s1").length).toBeGreaterThan(0);
  });
});
