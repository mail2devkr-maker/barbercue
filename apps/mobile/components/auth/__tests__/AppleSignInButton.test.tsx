/// <reference types="jest" />
import { act, createElement } from "react";
import { Platform } from "react-native";
import TestRenderer from "react-test-renderer";
import { AUTH_PATHS } from "@barbercue/shared";
import { AppleSignInButton } from "../AppleSignInButton";

jest.mock("expo-apple-authentication", () => {
  const React = require("react") as typeof import("react");
  return {
    isAvailableAsync: jest.fn(),
    signInAsync: jest.fn(),
    AppleAuthenticationScope: { EMAIL: "EMAIL", FULL_NAME: "FULL_NAME" },
    AppleAuthenticationButtonType: { CONTINUE: "CONTINUE" },
    AppleAuthenticationButtonStyle: { BLACK: "BLACK" },
    AppleAuthenticationButton: (props: Record<string, unknown>) =>
      React.createElement("AppleButton", props),
  };
});
jest.mock("../../../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: jest.fn(),
}));
jest.mock("../../../lib/auth-context", () => ({
  __mockAppleLogin: jest.fn(),
  __mockStaffAppleLogin: jest.fn(),
  useAuth: () => ({
    appleLogin: jest.requireMock("../../../lib/auth-context").__mockAppleLogin,
    staffAppleLogin: jest.requireMock("../../../lib/auth-context")
      .__mockStaffAppleLogin,
  }),
}));

const mockAppleNative = jest.requireMock("expo-apple-authentication") as {
  isAvailableAsync: jest.Mock;
  signInAsync: jest.Mock;
};
const mockApiFetch = jest.requireMock("../../../lib/api").apiFetch as jest.Mock;
const mockAppleLogin = jest.requireMock("../../../lib/auth-context")
  .__mockAppleLogin as jest.Mock;
const mockStaffAppleLogin = jest.requireMock("../../../lib/auth-context")
  .__mockStaffAppleLogin as jest.Mock;
jest.mock("../../../lib/language-context", () => ({
  useLanguage: () => ({
    t: { couldNotCompleteAppleSignIn: "Could not complete Apple sign-in." },
  }),
}));

describe("AppleSignInButton", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("stays hidden off iOS and never calls the native Apple SDK", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    let tree!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      tree = TestRenderer.create(
        createElement(AppleSignInButton, { audience: "customer" }),
      );
    });
    expect(tree.root.findAllByType("AppleButton")).toHaveLength(0);
    expect(mockAppleNative.isAvailableAsync).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  it("completes customer sign-in only when native support and backend verification are available", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    mockAppleNative.isAvailableAsync.mockResolvedValue(true);
    mockApiFetch.mockImplementation((path: string) => {
      if (path === `auth/${AUTH_PATHS.methods}`)
        return Promise.resolve({ apple: true });
      if (path === `auth/${AUTH_PATHS.appleNonce}`)
        return Promise.resolve({ nonce: "n".repeat(43) });
      return Promise.resolve({});
    });
    mockAppleNative.signInAsync.mockResolvedValue({
      identityToken: "signed-identity-token",
      authorizationCode: "short-lived-authorization-code",
    });
    mockAppleLogin.mockResolvedValue(undefined);
    const onBeforeSignIn = jest.fn();
    let tree!: ReturnType<typeof TestRenderer.create>;

    await act(async () => {
      tree = TestRenderer.create(
        createElement(AppleSignInButton, {
          audience: "customer",
          onBeforeSignIn,
        }),
      );
    });
    const button = tree.root.findByType("AppleButton");
    await act(async () => button.props.onPress());

    expect(mockAppleNative.signInAsync).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: "n".repeat(43) }),
    );
    expect(mockAppleLogin).toHaveBeenCalledWith({
      identityToken: "signed-identity-token",
      nonce: "n".repeat(43),
      authorizationCode: "short-lived-authorization-code",
    });
    expect(mockStaffAppleLogin).not.toHaveBeenCalled();
    expect(onBeforeSignIn).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  it("uses the staff-only server endpoint for an owner/staff audience", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    mockAppleNative.isAvailableAsync.mockResolvedValue(true);
    mockApiFetch.mockImplementation((path: string) => {
      if (path === `auth/${AUTH_PATHS.methods}`)
        return Promise.resolve({ apple: true });
      if (path === `auth/${AUTH_PATHS.appleNonce}`)
        return Promise.resolve({ nonce: "s".repeat(43) });
      return Promise.resolve({});
    });
    mockAppleNative.signInAsync.mockResolvedValue({
      identityToken: "staff-identity-token",
      authorizationCode: "short-lived-authorization-code",
    });
    mockStaffAppleLogin.mockResolvedValue(undefined);
    let tree!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      tree = TestRenderer.create(
        createElement(AppleSignInButton, { audience: "staff" }),
      );
    });
    await act(async () => tree.root.findByType("AppleButton").props.onPress());

    expect(mockStaffAppleLogin).toHaveBeenCalledWith({
      identityToken: "staff-identity-token",
      nonce: "s".repeat(43),
      authorizationCode: "short-lived-authorization-code",
    });
    expect(mockAppleLogin).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  it("hides Apple when the backend cannot verify Apple tokens", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    mockAppleNative.isAvailableAsync.mockResolvedValue(true);
    mockApiFetch.mockResolvedValue({ apple: false });
    let tree!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      tree = TestRenderer.create(
        createElement(AppleSignInButton, { audience: "customer" }),
      );
    });
    expect(tree.root.findAllByType("AppleButton")).toHaveLength(0);
    await act(async () => tree.unmount());
  });
});
