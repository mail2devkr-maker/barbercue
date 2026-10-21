// Owner phone sign-in (requirement #26/#30, FASTQUE_PHONE_OTP_V1): the screen must never turn a phone code into a session that is
// not a shop owner's, and must say "not available" whenever the server does not say that owner phone OTP is on.
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { OwnerPhoneOtpPanel } from "../OwnerPhoneOtpPanel";
import { apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

jest.mock("../../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock("../../../lib/auth-context", () => ({ useAuth: jest.fn() }));

const { ApiError } = jest.requireMock("../../../lib/api");
const PHONE = "+919876543210";
const CODE = "012345";
const OWNER = { id: "u1", audience: "STAFF", roles: ["SALON_OWNER"] };

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join(" ");
  return collect(node.children);
};
const text = (r) => collect(r.toJSON());
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

async function mount(mode, auth) {
  globalThis.window = { setInterval: jest.fn(() => 1), clearInterval: jest.fn() };
  useAuth.mockReturnValue({ logout: jest.fn().mockResolvedValue(undefined), ...auth });
  let r;
  await act(async () => { r = TestRenderer.create(<OwnerPhoneOtpPanel mode={mode} onSuccess={auth.onSuccess ?? jest.fn()} />); });
  return r;
}
const submit = async (r, id, value) => {
  await act(async () => { r.root.findByProps({ id }).props.onChange({ target: { value } }); });
  await act(async () => { await r.root.findByType("form").props.onSubmit({ preventDefault: jest.fn() }); });
};
const signInAs = async (verified, extra = {}) => {
  apiFetch.mockResolvedValue({ phoneOtp: true, ownerPhoneOtp: true });
  const onSuccess = jest.fn();
  const logout = jest.fn().mockResolvedValue(undefined);
  const auth = {
    requestOwnerOtp: jest.fn().mockResolvedValue({ expiresInSeconds: 300 }),
    verifyOwnerOtp: jest.fn().mockResolvedValue(verified),
    onSuccess,
    logout,
    ...extra,
  };
  const r = await mount("existing-owner", auth);
  await submit(r, "owner-phone-existing-owner", PHONE);
  await submit(r, "owner-otp-existing-owner", CODE);
  return { r, onSuccess, logout, auth };
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

describe("an owner phone sign-in must end as a shop owner's session", () => {
  it("lets a STAFF session that carries SALON_OWNER through", async () => {
    const { onSuccess, logout, r } = await signInAs(OWNER);
    expect(onSuccess).toHaveBeenCalledWith(OWNER);
    expect(logout).not.toHaveBeenCalled();
    await act(async () => r.unmount());
  });

  it.each([
    ["a CUSTOMER session", { id: "u2", audience: "CUSTOMER", roles: ["CUSTOMER"] }],
    ["a STAFF session without the owner role", { id: "u3", audience: "STAFF", roles: ["SALON_STAFF"] }],
    ["an owner role on a CUSTOMER audience", { id: "u4", audience: "CUSTOMER", roles: ["SALON_OWNER"] }],
  ])("ends %s instead of carrying on, and says so", async (_name, session) => {
    const { onSuccess, logout, r } = await signInAs(session);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(text(r)).toContain("This number is not linked to a shop-owner account.");
    // The code is cleared so it cannot be resubmitted.
    expect(r.root.findByProps({ id: "owner-otp-existing-owner" }).props.value).toBe("");
    await act(async () => r.unmount());
  });

  it("still reports the refusal when ending the session itself fails", async () => {
    const { onSuccess, r } = await signInAs({ id: "u2", audience: "CUSTOMER", roles: ["CUSTOMER"] }, { logout: jest.fn().mockRejectedValue(new Error("offline")) });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(text(r)).toContain("This number is not linked to a shop-owner account.");
    await act(async () => r.unmount());
  });

  it("does not apply the owner check to a new owner's customer sign-in", async () => {
    apiFetch.mockResolvedValueOnce({ phoneOtp: true, ownerPhoneOtp: false }).mockResolvedValueOnce({ expiresInSeconds: 300 });
    const customer = { id: "u5", audience: "CUSTOMER", roles: ["CUSTOMER"] };
    const onSuccess = jest.fn();
    const r = await mount("new-owner", { verifyCustomerOtp: jest.fn().mockResolvedValue(customer), onSuccess });
    await submit(r, "owner-phone-new-owner", PHONE);
    await submit(r, "owner-otp-new-owner", CODE);
    expect(onSuccess).toHaveBeenCalledWith(customer);
    await act(async () => r.unmount());
  });
});

describe("availability", () => {
  it.each([
    ["an older backend that sends no ownerPhoneOtp", { google: true, phoneOtp: true }],
    ["ownerPhoneOtp turned off", { google: true, phoneOtp: true, ownerPhoneOtp: false }],
    ["a value that is not exactly true", { ownerPhoneOtp: "true" }],
  ])("says it is unavailable for %s, with no input to fill", async (_name, methods) => {
    apiFetch.mockResolvedValue(methods);
    const r = await mount("existing-owner", {});
    expect(text(r)).toContain("Mobile verification is temporarily unavailable");
    expect(r.root.findAllByType("input")).toHaveLength(0);
    await act(async () => r.unmount());
  });

  it("says it is unavailable when the capability check itself fails", async () => {
    apiFetch.mockRejectedValue(new Error("offline"));
    const r = await mount("existing-owner", {});
    expect(text(r)).toContain("Mobile verification is temporarily unavailable");
    expect(r.root.findAllByType("input")).toHaveLength(0);
    await act(async () => r.unmount());
  });

  it("new-owner mode follows phoneOtp, not ownerPhoneOtp", async () => {
    apiFetch.mockResolvedValue({ phoneOtp: false, ownerPhoneOtp: true });
    const r = await mount("new-owner", {});
    expect(text(r)).toContain("temporarily unavailable");
    await act(async () => r.unmount());
  });
});

describe("what the owner is told", () => {
  it("refuses a malformed number before asking the server", async () => {
    apiFetch.mockResolvedValue({ phoneOtp: true, ownerPhoneOtp: true });
    const requestOwnerOtp = jest.fn();
    const r = await mount("existing-owner", { requestOwnerOtp });
    await submit(r, "owner-phone-existing-owner", "98765");
    expect(requestOwnerOtp).not.toHaveBeenCalled();
    expect(r.root.findAllByProps({ role: "alert" }).length).toBeGreaterThan(0);
    await act(async () => r.unmount());
  });

  it("moves to the code step for a number the server did not recognise, revealing nothing", async () => {
    apiFetch.mockResolvedValue({ phoneOtp: true, ownerPhoneOtp: true });
    // The server answers the same generic response for an unknown or ineligible number.
    const r = await mount("existing-owner", { requestOwnerOtp: jest.fn().mockResolvedValue({ expiresInSeconds: 300 }) });
    await submit(r, "owner-phone-existing-owner", PHONE);
    expect(text(r)).toMatch(/Enter the 6-digit code for\s+\+919876543210/);
    expect(text(r)).not.toMatch(/not registered|no account|unknown number/i);
    await act(async () => r.unmount());
  });

  it("shows the server's words for a wrong code and does not sign in", async () => {
    apiFetch.mockResolvedValue({ phoneOtp: true, ownerPhoneOtp: true });
    const onSuccess = jest.fn();
    const r = await mount("existing-owner", {
      requestOwnerOtp: jest.fn().mockResolvedValue({ expiresInSeconds: 300 }),
      verifyOwnerOtp: jest.fn().mockRejectedValue(new ApiError("That code is not correct.")),
      onSuccess,
    });
    await submit(r, "owner-phone-existing-owner", PHONE);
    await submit(r, "owner-otp-existing-owner", CODE);
    expect(text(r)).toContain("That code is not correct.");
    expect(onSuccess).not.toHaveBeenCalled();
    await act(async () => r.unmount());
  });

  it("keeps Resend off during the cooldown", async () => {
    apiFetch.mockResolvedValue({ phoneOtp: true, ownerPhoneOtp: true });
    const r = await mount("existing-owner", { requestOwnerOtp: jest.fn().mockResolvedValue({ expiresInSeconds: 300 }) });
    await submit(r, "owner-phone-existing-owner", PHONE);
    const resend = r.root.findAllByType("button").find((b) => /Resend/.test(collect(b.props.children)));
    expect(collect(resend.props.children)).toMatch(/Resend in \d+s/);
    expect(resend.props.disabled).toBe(true);
    await act(async () => r.unmount());
  });
});
