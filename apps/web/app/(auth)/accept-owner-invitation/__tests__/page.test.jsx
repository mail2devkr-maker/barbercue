import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import AcceptOwnerInvitationPage from "../page";
import { apiFetch } from "../../../../lib/api";

let token = "a".repeat(64);
jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));
jest.mock("next/navigation", () => ({ useSearchParams: () => ({ get: () => token }) }));
jest.mock("../../../../components/auth/AuthCard", () => ({
  AuthCard: ({ title, subtitle, children }) => <div><h1>{title}</h1><p>{subtitle}</p>{children}</div>,
  AuthPageFallback: () => <div>fallback</div>,
}));
jest.mock("../../../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
const { ApiError } = jest.requireMock("../../../../lib/api");

const collect = (n) => (n == null || typeof n === "boolean" ? "" : typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(collect).join(" ") : collect(n.children));
const text = (r) => collect(r.toJSON());
const byId = (r, id) => r.root.find((n) => typeof n.type === "string" && n.props.id === id);
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const type = async (r, id, value) => { await act(async () => { byId(r, id).props.onChange({ target: { value } }); }); };
const submit = async (r) => { await act(async () => { await r.root.findByType("form").props.onSubmit({ preventDefault() {} }); }); await flush(); };

const PREVIEW = { shopName: "Studio 25 Salons", email: "owner@example.test", needsPassword: true, expiresAt: "2026-11-01T00:00:00.000Z" };
let calls;
function install(preview = PREVIEW, accept = async () => ({ shopName: "Studio 25 Salons" })) {
  calls = [];
  apiFetch.mockImplementation(async (path, opts) => {
    calls.push({ path, opts });
    if (path.startsWith("auth/owner-invitations?token=")) {
      if (preview instanceof Error) throw preview;
      return preview;
    }
    if (path === "auth/owner-invitations/accept") return accept(opts);
    throw new Error(`unexpected ${path}`);
  });
}
async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<AcceptOwnerInvitationPage />); });
  await flush();
  return r;
}
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); token = "a".repeat(64); });

describe("accept owner invitation page (owner transfer)", () => {
  it("shows the shop and asks a new address to choose a password; nothing is sent until they confirm", async () => {
    install();
    const r = await mount();
    expect(text(r)).toContain("Take over Studio 25 Salons");
    expect(text(r)).toContain("owner@example.test");
    expect(byId(r, "invite-password")).toBeTruthy();
    expect(calls.map((c) => c.path)).toEqual([`auth/owner-invitations?token=${"a".repeat(64)}`]);
  });

  it("checks the two passwords before sending anything", async () => {
    install();
    const r = await mount();
    await type(r, "invite-password", "short");
    await submit(r);
    expect(text(r)).toContain("8 to 72 characters");
    await type(r, "invite-password", "Long-enough-1");
    await type(r, "invite-confirm", "Different-1");
    await submit(r);
    expect(text(r)).toContain("do not match");
    expect(calls).toHaveLength(1);
  });

  it("accepts with the chosen password only, then points to sign-in and forgets the password", async () => {
    install();
    const r = await mount();
    await type(r, "invite-password", "Long-enough-1");
    await type(r, "invite-confirm", "Long-enough-1");
    await submit(r);
    const post = calls[1];
    expect(post.path).toBe("auth/owner-invitations/accept");
    expect(JSON.parse(post.opts.body)).toEqual({ token: "a".repeat(64), password: "Long-enough-1" });
    expect(text(r)).toContain("You now own this shop");
    expect(r.root.findAll((n) => n.type === "a" && n.props.href === "/owner/login")).toHaveLength(1);
    expect(JSON.stringify(r.toJSON())).not.toContain("Long-enough-1");
  });

  it("an existing verified account just confirms: no password field, no password sent", async () => {
    install({ ...PREVIEW, needsPassword: false });
    const r = await mount();
    expect(r.root.findAll((n) => n.props?.id === "invite-password")).toHaveLength(0);
    expect(text(r)).toContain("Your password stays as it is");
    await submit(r);
    expect(JSON.parse(calls[1].opts.body)).toEqual({ token: "a".repeat(64) });
  });

  it("shows the server's reason and stays on the form when accepting fails", async () => {
    install(PREVIEW, async () => { throw new ApiError("The shop owner changed after this transfer was prepared."); });
    const r = await mount();
    await type(r, "invite-password", "Long-enough-1");
    await type(r, "invite-confirm", "Long-enough-1");
    await submit(r);
    expect(text(r)).toContain("The shop owner changed");
    expect(text(r)).not.toContain("You now own this shop");
  });

  it("an invalid, used or expired link, or one with no token, is explained and offers no form", async () => {
    install(new ApiError("This invitation is invalid or has expired. Ask FastQue to send a new one."));
    const bad = await mount();
    expect(text(bad)).toContain("cannot be used");
    expect(text(bad)).toContain("invalid or has expired");
    expect(bad.root.findAllByType("form")).toHaveLength(0);
    token = "";
    install();
    const none = await mount();
    expect(text(none)).toContain("incomplete");
    expect(calls).toHaveLength(0);
  });
});
