import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { OwnerPhoneOtpPanel } from "../OwnerPhoneOtpPanel";
import { apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

const originalActEnvironment = Object.getOwnPropertyDescriptor(
  globalThis,
  "IS_REACT_ACT_ENVIRONMENT",
);
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

jest.mock("../../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock("../../../lib/auth-context", () => ({ useAuth: jest.fn() }));

const PHONE = "+919876543210";
const CODE = "012345";
const USER = {
  id: "synthetic-user",
  roles: ["CUSTOMER"],
  audience: "CUSTOMER",
};

async function renderPanel(mode, auth) {
  globalThis.window = {
    setInterval: jest.fn(() => 1),
    clearInterval: jest.fn(),
  };
  useAuth.mockReturnValue(auth);
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <OwnerPhoneOtpPanel mode={mode} onSuccess={auth.onSuccess} />,
    );
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

describe("OwnerPhoneOtpPanel", () => {
  afterEach(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete globalThis.window;
    }
    if (originalActEnvironment) {
      Object.defineProperty(
        globalThis,
        "IS_REACT_ACT_ENVIRONMENT",
        originalActEnvironment,
      );
    } else {
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
  });

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    apiFetch.mockReset();
    useAuth.mockReset();
  });

  it("keeps existing-owner sign-in on its dedicated STAFF OTP API", async () => {
    apiFetch.mockResolvedValue({ phoneOtp: true, ownerPhoneOtp: true });
    const requestOwnerOtp = jest
      .fn()
      .mockResolvedValue({ expiresInSeconds: 300 });
    const verifyOwnerOtp = jest
      .fn()
      .mockResolvedValue({
        ...USER,
        audience: "STAFF",
        roles: ["SALON_OWNER"],
      });
    const onSuccess = jest.fn();
    const renderer = await renderPanel("existing-owner", {
      requestOwnerOtp,
      verifyOwnerOtp,
      onSuccess,
    });

    await fillAndSubmit(renderer, "owner-phone-existing-owner", PHONE);
    expect(requestOwnerOtp).toHaveBeenCalledWith({ phone: PHONE });

    await fillAndSubmit(renderer, "owner-otp-existing-owner", CODE);
    expect(verifyOwnerOtp).toHaveBeenCalledWith({ phone: PHONE, code: CODE });
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ audience: "STAFF", roles: ["SALON_OWNER"] }),
    );
    await act(async () => renderer.unmount());
  });

  it("uses CUSTOMER OTP for a new owner until shop registration authorizes SALON_OWNER", async () => {
    apiFetch
      .mockResolvedValueOnce({ phoneOtp: true, ownerPhoneOtp: true })
      .mockResolvedValueOnce({ expiresInSeconds: 300 });
    const verifyCustomerOtp = jest.fn().mockResolvedValue(USER);
    const onSuccess = jest.fn();
    const renderer = await renderPanel("new-owner", {
      verifyCustomerOtp,
      onSuccess,
    });

    await fillAndSubmit(renderer, "owner-phone-new-owner", PHONE);
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("otp/request"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ phone: PHONE }),
      }),
    );

    await fillAndSubmit(renderer, "owner-otp-new-owner", CODE);
    expect(verifyCustomerOtp).toHaveBeenCalledWith({
      phone: PHONE,
      code: CODE,
    });
    expect(onSuccess).toHaveBeenCalledWith(USER);
    await act(async () => renderer.unmount());
  });

  it("fails closed when the server capability probe is unavailable", async () => {
    apiFetch.mockResolvedValue({ phoneOtp: false, ownerPhoneOtp: false });
    const renderer = await renderPanel("existing-owner", {
      onSuccess: jest.fn(),
    });

    expect(
      renderer.root.findByProps({ role: "status" }).children.join(" "),
    ).toContain("Mobile verification is temporarily unavailable");
    expect(renderer.root.findAllByType("input")).toHaveLength(0);
    await act(async () => renderer.unmount());
  });
});
