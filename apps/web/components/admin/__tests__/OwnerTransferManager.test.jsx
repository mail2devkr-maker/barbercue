import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { OwnerTransferManager } from "../OwnerTransferManager";
import { apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

jest.mock("../../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock("../../../lib/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../ui/Button", () => ({
  Button: ({ children, onClick, disabled }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
}));
const { ApiError } = jest.requireMock("../../../lib/api");

const collect = (n) => (n == null || typeof n === "boolean" ? "" : typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(collect).join(" ") : collect(n.children));
const text = (r) => collect(r.toJSON());
const byId = (r, id) => r.root.find((n) => typeof n.type === "string" && n.props.id === id);
const buttons = (r, re) => r.root.findAll((n) => n.type === "button" && re.test(collect(n.props.children)));
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const type = async (r, id, value) => { await act(async () => { byId(r, id).props.onChange({ target: { value } }); }); };
const click = async (r, re) => { await act(async () => { await buttons(r, re)[0].props.onClick(); }); await flush(); };
const tick = async (r, re) => { const box = r.root.findAll((n) => n.type === "input" && n.props.type === "checkbox").find((n) => re.test(collect(n.parent.props.children))); await act(async () => { box.props.onChange({ target: { checked: true } }); }); };

const SHOPS = [
  { id: "s1", name: "Studio 25 Salons", publicId: "BC-SHOP-000088", status: "SUSPENDED", ownerEmail: "shared@example.test" },
  { id: "s2", name: "Glamourous looks studio", publicId: "BC-SHOP-000076", status: "ACTIVE", ownerEmail: "shared@example.test" },
];
const transfer = (over = {}) => ({
  id: "t1", salonId: "s1", newEmail: "studio25@example.test", status: "PREPARED", preparedByAdminId: "other-admin", verifiedByAdminId: null,
  verificationEvidence: [], verifiedAt: null, inviteNotBefore: null, invitationExpiresAt: null, invitationCount: 0, breakGlass: false,
  preparedAt: "2026-10-27T10:00:00.000Z", completedAt: null, history: [{ action: "SALON_OWNER_TRANSFER_PREPARED", at: "2026-10-27T10:00:00.000Z", actorEmail: "admin@example.test" }], ...over,
});

let calls;
let transfers;
let failWith;
function install() {
  calls = [];
  apiFetch.mockImplementation(async (path, opts) => {
    calls.push({ path, opts });
    if (path === "admin/overview") return { shops: SHOPS };
    if (opts?.method === "POST") {
      if (failWith) throw failWith;
      return {};
    }
    if (path.endsWith("/owner-transfers")) return transfers;
    throw new Error(`unexpected ${path}`);
  });
}
async function mount(me = "me-admin") {
  useAuth.mockReturnValue({ user: { id: me, roles: ["PLATFORM_ADMIN"] } });
  let r;
  await act(async () => { r = TestRenderer.create(<OwnerTransferManager />); });
  await flush();
  return r;
}
async function select(r, query = "studio", pick = /Studio 25/) {
  await type(r, "transfer-shop-search", query);
  await click(r, pick);
}
const posts = () => calls.filter((c) => c.opts?.method === "POST");
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  global.window = { confirm: jest.fn(() => true) };
  transfers = [];
  failWith = null;
  install();
});
afterEach(() => { delete global.window; });

describe("Owner Transfer Management (Platform Admin)", () => {
  it("finds a shop by name, public id or owner e-mail and shows its current ownership", async () => {
    const r = await mount();
    await type(r, "transfer-shop-search", "BC-SHOP-000076");
    expect(buttons(r, /Glamourous/)).toHaveLength(1);
    expect(buttons(r, /Studio 25/)).toHaveLength(0);
    await type(r, "transfer-shop-search", "shared@example");
    expect(buttons(r, /./).length).toBeGreaterThanOrEqual(2);
    await type(r, "transfer-shop-search", "studio");
    await click(r, /Studio 25/);
    expect(text(r)).toContain("shared@example.test");
    expect(text(r)).toContain("SUSPENDED");
    expect(calls.map((c) => c.path)).toContain("admin/salons/s1/owner-transfers");
  });

  it("prepares a transfer only when the destination address is typed twice, sending it lower-cased", async () => {
    const r = await mount();
    await select(r);
    await type(r, "transfer-email", "New.Owner@Example.test");
    await type(r, "transfer-email-confirm", "other@example.test");
    await click(r, /Prepare transfer/);
    expect(text(r)).toContain("do not match");
    expect(posts()).toHaveLength(0);
    await type(r, "transfer-email-confirm", "new.owner@example.test");
    await click(r, /Prepare transfer/);
    expect(posts()).toHaveLength(1);
    expect(posts()[0].path).toBe("admin/salons/s1/owner-transfers");
    expect(JSON.parse(posts()[0].opts.body)).toEqual({ newEmail: "new.owner@example.test" });
    expect(text(r)).toContain("Nothing has moved");
  });

  it("verification by another administrator: a phone callback alone is refused locally, then identity + authority is sent", async () => {
    transfers = [transfer()];
    const r = await mount();
    await select(r);
    expect(text(r)).toContain("Prepared - waiting for verification");
    expect(r.root.findAll((n) => n.props?.id === "transfer-justification")).toHaveLength(0);
    await tick(r, /Called the registered shop phone/);
    await type(r, "transfer-reference", "Admin B met the person at the shop and saw ID and the shop licence.");
    await click(r, /Record verification/);
    expect(text(r)).toContain("identity check");
    expect(posts()).toHaveLength(0);
    await tick(r, /Government photo ID/);
    await tick(r, /Business or shop proof/);
    await click(r, /Record verification/);
    expect(posts()).toHaveLength(1);
    expect(posts()[0].path).toBe("admin/owner-transfers/t1/verify");
    const body = JSON.parse(posts()[0].opts.body);
    expect(body.evidence.sort()).toEqual(["BUSINESS_OR_SHOP_PROOF", "GOVERNMENT_ID", "REGISTERED_PHONE_CALLBACK"]);
    expect(body.breakGlassJustification).toBeUndefined();
    expect(global.window.confirm).toHaveBeenCalled();
  });

  it("the administrator who prepared the transfer is warned and must write a break-glass justification", async () => {
    transfers = [transfer({ preparedByAdminId: "me-admin" })];
    const r = await mount("me-admin");
    await select(r);
    expect(text(r)).toContain("You prepared this transfer");
    await tick(r, /Government photo ID/);
    await tick(r, /Current owner's written consent/);
    await type(r, "transfer-reference", "Checked ID and a signed consent letter from the current owner.");
    await click(r, /Record verification/);
    expect(text(r)).toContain("Break-glass needs a written justification");
    expect(posts()).toHaveLength(0);
    await type(r, "transfer-justification", "No second administrator is available and the owner is travelling for two weeks.");
    await click(r, /Record verification/);
    expect(JSON.parse(posts()[0].opts.body).breakGlassJustification).toContain("No second administrator");
  });

  it("verified: invitation can be sent after confirmation; during a break-glass cool-down it cannot", async () => {
    transfers = [transfer({ status: "VERIFIED", verifiedAt: "2026-10-27T11:00:00.000Z", verificationEvidence: ["GOVERNMENT_ID", "BUSINESS_OR_SHOP_PROOF"] })];
    const r = await mount();
    await select(r);
    expect(text(r)).toContain("Verified - invitation not sent");
    await click(r, /Send invitation/);
    expect(posts()[0].path).toBe("admin/owner-transfers/t1/invite");
    expect(JSON.parse(posts()[0].opts.body)).toEqual({});

    transfers = [transfer({ status: "VERIFIED", breakGlass: true, inviteNotBefore: "2999-01-01T00:00:00.000Z" })];
    const cooling = await mount();
    await select(cooling);
    expect(text(cooling)).toContain("cool-down");
    expect(buttons(cooling, /Send invitation/)).toHaveLength(0);
  });

  it("invited: shows expiry and no resend while live; after expiry a written reason is required", async () => {
    transfers = [transfer({ status: "INVITED", invitationCount: 1, invitationExpiresAt: "2999-01-01T00:00:00.000Z" })];
    const live = await mount();
    await select(live);
    expect(text(live)).toContain("Invited - waiting for the recipient");
    expect(text(live)).toMatch(/Invitation\s+1\s+of 3/);
    expect(buttons(live, /Send a new invitation/)).toHaveLength(0);
    expect(buttons(live, /Cancel transfer/)).toHaveLength(1);

    transfers = [transfer({ status: "INVITED", invitationCount: 1, invitationExpiresAt: "2020-01-01T00:00:00.000Z" })];
    const expired = await mount();
    await select(expired);
    await click(expired, /Send a new invitation/);
    expect(text(expired)).toContain("at least 10 characters");
    expect(posts()).toHaveLength(0);
    await type(expired, "transfer-reason", "Recipient re-confirmed by phone call.");
    await click(expired, /Send a new invitation/);
    expect(JSON.parse(posts()[0].opts.body)).toEqual({ reference: "Recipient re-confirmed by phone call." });
  });

  it("cancel is confirmed first and posts to the cancel endpoint", async () => {
    transfers = [transfer({ status: "INVITED", invitationCount: 1, invitationExpiresAt: "2999-01-01T00:00:00.000Z" })];
    const r = await mount();
    await select(r);
    global.window.confirm = jest.fn(() => false);
    await click(r, /Cancel transfer/);
    expect(posts()).toHaveLength(0);
    global.window.confirm = jest.fn(() => true);
    await click(r, /Cancel transfer/);
    expect(posts()[0].path).toBe("admin/owner-transfers/t1/cancel");
  });

  it("shows every state distinctly with its audit history, and never a token or password", async () => {
    transfers = [
      transfer({ id: "a", status: "COMPLETED", completedAt: "2026-10-26T10:00:00.000Z", history: [{ action: "SALON_OWNER_TRANSFER_COMPLETED", at: "2026-10-26T10:00:00.000Z", actorEmail: "new@example.test" }] }),
      transfer({ id: "b", status: "CANCELLED", history: [{ action: "SALON_OWNER_TRANSFER_CANCELLED", at: "2026-10-25T10:00:00.000Z", actorEmail: "admin@example.test" }] }),
    ];
    const r = await mount();
    await select(r);
    const t = text(r);
    expect(t).toContain("Completed");
    expect(t).toContain("Cancelled");
    expect(t).toContain("Accepted - ownership moved");
    expect(t).toContain("new@example.test");
    expect(r.root.findAll((n) => n.props?.["data-testid"] === "transfer-row")).toHaveLength(2);
    expect(JSON.stringify(r.toJSON())).not.toMatch(/[a-f0-9]{64}/);
    expect(r.root.findAll((n) => n.type === "input" && /password|token/i.test(String(n.props.id ?? n.props.name ?? n.props.type)))).toHaveLength(0);
    // nothing to prepare while the only transfers are finished: the prepare form is offered again
    expect(byId(r, "transfer-email")).toBeTruthy();
  });

  it("shows the server's reason as it is when an action is refused, and changes nothing locally", async () => {
    transfers = [transfer({ status: "VERIFIED" })];
    failWith = new ApiError("Another administrator must verify the owner, not the one who prepared the transfer.");
    const r = await mount();
    await select(r);
    await click(r, /Send invitation/);
    expect(text(r)).toContain("Another administrator must verify");
    expect(text(r)).not.toContain("Invitation sent to");
  });
});
