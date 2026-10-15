import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { CustomerPhoneLinkPanel } from "../CustomerPhoneLinkPanel";
import { apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock("../../../lib/auth-context", () => ({ useAuth: jest.fn() }));

const PHONE = "+919876543210";
const CODE = "012345";

async function renderPanel(auth) {
  globalThis.window = {
    setInterval: jest.fn(() => 1),
    clearInterval: jest.fn(),
  };
  useAuth.mockReturnValue(auth);
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<CustomerPhoneLinkPanel />);
  });
  return renderer;
}

async function fillAndSubmit(renderer, inputId, value) {
  await act(async () => {
    renderer.root
      .findByProps({ id: inputId })
      .props.onChange({ target: { value } });
  });
  await act(async () => {
    await renderer.root
      .findByType("form")
      .props.onSubmit({ preventDefault: jest.fn() });
  });
}

describe("CustomerPhoneLinkPanel", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useAuth.mockReset();
  });

  it("verifies and links a phone through the authenticated customer endpoints, then applies the rotated session", async () => {
    const user = {
      id: "customer-1",
      roles: ["CUSTOMER"],
      audience: "CUSTOMER",
      phone: PHONE,
    };
    const session = {
      user: { ...user, phone: PHONE },
      tokens: {
        accessToken: "synthetic-access",
        refreshToken: "synthetic-refresh",
        expiresIn: 900,
      },
    };
    apiFetch
      .mockResolvedValueOnce({ phoneOtp: true })
      .mockResolvedValueOnce({ expiresInSeconds: 300 })
      .mockResolvedValueOnce(session);
    const applySession = jest.fn();
    const renderer = await renderPanel({ user, applySession });

    await fillAndSubmit(renderer, "customer-account-phone", PHONE);
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("customer/phone/link/request"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ phone: PHONE }),
      }),
    );

    await fillAndSubmit(renderer, "customer-account-phone-otp", CODE);
    expect(apiFetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("customer/phone/link/verify"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ phone: PHONE, code: CODE }),
      }),
    );
    expect(applySession).toHaveBeenCalledWith(session);
    expect(
      renderer.root.findByProps({ role: "status" }).children.join(" "),
    ).toContain("Other refresh sessions were signed out");
    await act(async () => renderer.unmount());
  });

  it("does not render for a STAFF audience session even if a customer role is present on the account", async () => {
    apiFetch.mockResolvedValue({ phoneOtp: true });
    const renderer = await renderPanel({
      user: { id: "owner-1", roles: ["CUSTOMER"], audience: "STAFF" },
      applySession: jest.fn(),
    });
    expect(renderer.toJSON()).toBeNull();
    await act(async () => renderer.unmount());
  });
});
