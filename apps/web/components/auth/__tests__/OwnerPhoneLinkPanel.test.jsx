// Linking a sign-in phone to an owner account (FASTQUE_PHONE_OTP_V1): only for a signed-in shop owner, never without the server's say-so.
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { OwnerPhoneLinkPanel } from "../OwnerPhoneLinkPanel";
import { apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

jest.mock("../../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock("../../../lib/auth-context", () => ({ useAuth: jest.fn() }));

const { ApiError } = jest.requireMock("../../../lib/api");
const PHONE = "+919876543210";
const CODE = "654321";
const OWNER = { id: "o1", audience: "STAFF", roles: ["SALON_OWNER"], phone: null };

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join(" ");
  return collect(node.children);
};
const text = (r) => collect(r.toJSON());
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

async function mount(auth) {
  globalThis.window = { setInterval: jest.fn(() => 1), clearInterval: jest.fn() };
  useAuth.mockReturnValue(auth);
  let r;
  await act(async () => { r = TestRenderer.create(<OwnerPhoneLinkPanel />); });
  return r;
}
const submit = async (r, id, value) => {
  await act(async () => { r.root.findByProps({ id }).props.onChange({ target: { value } }); });
  await act(async () => { await r.root.findByType("form").props.onSubmit({ preventDefault: jest.fn() }); });
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  apiFetch.mockReset();
  useAuth.mockReset();
});
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe("OwnerPhoneLinkPanel", () => {
  it.each([
    ["a customer session", { id: "c1", audience: "CUSTOMER", roles: ["CUSTOMER"] }],
    ["a barber", { id: "b1", audience: "STAFF", roles: ["SALON_STAFF"] }],
    ["an admin", { id: "a1", audience: "STAFF", roles: ["PLATFORM_ADMIN"] }],
    ["nobody signed in", null],
  ])("renders nothing for %s", async (_name, user) => {
    apiFetch.mockResolvedValue({ ownerPhoneOtp: true });
    const r = await mount({ user });
    expect(r.toJSON()).toBeNull();
    await act(async () => r.unmount());
  });

  it("requests and verifies through the owner link calls, then confirms the number and the other sessions signed out", async () => {
    apiFetch.mockResolvedValue({ phoneOtp: true, ownerPhoneOtp: true });
    const requestOwnerPhoneLinkOtp = jest.fn().mockResolvedValue({ expiresInSeconds: 300 });
    const verifyOwnerPhoneLink = jest.fn().mockResolvedValue({ ...OWNER, phone: PHONE });
    const r = await mount({ user: OWNER, requestOwnerPhoneLinkOtp, verifyOwnerPhoneLink });
    await submit(r, "owner-account-phone", PHONE);
    expect(requestOwnerPhoneLinkOtp).toHaveBeenCalledWith({ phone: PHONE });
    await submit(r, "owner-account-phone-otp", CODE);
    expect(verifyOwnerPhoneLink).toHaveBeenCalledWith({ phone: PHONE, code: CODE });
    expect(text(r)).toContain("Other refresh sessions were signed out");
    expect(text(r)).toContain("changes your account login number, not your shop");
    await act(async () => r.unmount());
  });

  it("says it is unavailable, with no input, unless the server reports owner phone OTP on", async () => {
    for (const methods of [{ phoneOtp: true }, { ownerPhoneOtp: false }]) {
      apiFetch.mockResolvedValue(methods);
      const r = await mount({ user: OWNER });
      expect(text(r)).toContain("Mobile verification is temporarily unavailable");
      expect(text(r)).toContain("Your current sign-in methods are unchanged");
      expect(r.root.findAllByType("input")).toHaveLength(0);
      await act(async () => r.unmount());
    }
  });

  it("says it is unavailable when the capability check fails", async () => {
    apiFetch.mockRejectedValue(new Error("offline"));
    const r = await mount({ user: OWNER });
    expect(text(r)).toContain("temporarily unavailable");
    await act(async () => r.unmount());
  });

  it("shows the server's words when the number belongs to another account", async () => {
    apiFetch.mockResolvedValue({ ownerPhoneOtp: true });
    const requestOwnerPhoneLinkOtp = jest.fn().mockRejectedValue(new ApiError("This number is already linked to another account."));
    const r = await mount({ user: OWNER, requestOwnerPhoneLinkOtp });
    await submit(r, "owner-account-phone", PHONE);
    expect(text(r)).toContain("This number is already linked to another account.");
    expect(r.root.findAllByProps({ id: "owner-account-phone-otp" })).toHaveLength(0);
    await act(async () => r.unmount());
  });

  it("does not call the server for a malformed number", async () => {
    apiFetch.mockResolvedValue({ ownerPhoneOtp: true });
    const requestOwnerPhoneLinkOtp = jest.fn();
    const r = await mount({ user: OWNER, requestOwnerPhoneLinkOtp });
    await submit(r, "owner-account-phone", "12345");
    expect(requestOwnerPhoneLinkOtp).not.toHaveBeenCalled();
    await act(async () => r.unmount());
  });
});
