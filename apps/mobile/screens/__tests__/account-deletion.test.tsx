/// <reference types="jest" />
import { act, createElement } from "react";
import { Text } from "react-native";
import TestRenderer from "react-test-renderer";
import { Role, type AccountDeletionRequestDto } from "@barbercue/shared";
import AccountScreen from "../AccountScreen";
import DashboardAccountScreen from "../dashboard/DashboardAccountScreen";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

jest.mock("../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock("../../lib/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../lib/language-context", () => ({
  useLanguage: () => {
    const { Language, uiStringsFor } = require("@barbercue/shared");
    return {
      language: Language.EN,
      setLanguage: jest.fn(),
      t: uiStringsFor(Language.EN),
    };
  },
}));
jest.mock("../../lib/date-locale", () => ({ dateLocaleFor: () => "en-IN" }));
jest.mock("../../lib/feature-flags", () => ({ isCreditsEnabled: () => false }));
jest.mock("../../components/owner/OwnerVoiceSettingsCard", () => ({
  OwnerVoiceSettingsCard: () => null,
}));
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) =>
    require("react").useEffect(effect, [effect]),
}));
jest.mock("../../components/ui", () => {
  const React = require("react");
  const {
    Pressable: NativePressable,
    Text: NativeText,
    View: NativeView,
  } = require("react-native");
  return {
    Screen: ({ children }: any) =>
      React.createElement(NativeView, null, children),
    SectionHeader: ({ title, subtitle }: any) =>
      React.createElement(
        NativeView,
        null,
        React.createElement(NativeText, null, title),
        React.createElement(NativeText, null, subtitle),
      ),
    Card: ({ children }: any) =>
      React.createElement(NativeView, null, children),
    Button: ({ title, onPress, disabled }: any) =>
      React.createElement(
        NativePressable,
        { accessibilityRole: "button", onPress, disabled },
        React.createElement(NativeText, null, title),
      ),
    InlineError: ({ message }: { message: string }) =>
      React.createElement(NativeText, null, message),
    LanguageSwitcher: () => null,
  };
});
jest.mock("../../components/ui/ErrorState", () => {
  const React = require("react");
  const { Text: NativeText } = require("react-native");
  return {
    InlineError: ({ message }: { message: string }) =>
      React.createElement(NativeText, null, message),
  };
});

const userMock = useAuth as jest.Mock;
const apiFetchMock = apiFetch as jest.Mock;
let tree: ReturnType<typeof TestRenderer.create>;

function flattenText(node: any): string {
  return node.children
    .map((child: any) =>
      typeof child === "string" ? child : flattenText(child),
    )
    .join("");
}

function renderedText(): string {
  return tree.root
    .findAll((node: any) => node.type === Text)
    .map(flattenText)
    .join(" ");
}

function setupApi(status: AccountDeletionRequestDto) {
  apiFetchMock.mockImplementation(
    async (path: string, options?: RequestInit) => {
      if (path === "auth/sessions") return [];
      if (path.includes("premium")) return {};
      if (
        path === "auth/account/deletion-request" &&
        options?.method === "POST"
      ) {
        return {
          ...status,
          request: {
            id: "request-1",
            status: "REQUESTED",
            createdAt: "2026-10-28T10:00:00.000Z",
          },
        };
      }
      if (path === "auth/account/deletion-request") return status;
      return {};
    },
  );
}

beforeEach(() => jest.clearAllMocks());
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

it("keeps the existing customer-only direct deletion affordance", async () => {
  userMock.mockReturnValue({
    user: { roles: [Role.CUSTOMER] },
    logout: jest.fn(),
    refreshMe: jest.fn(),
  });
  setupApi({
    request: null,
    resolution: "CUSTOMER_DIRECT_DELETE",
    relatedShopCount: 0,
  });

  await act(async () => {
    tree = TestRenderer.create(createElement(AccountScreen));
  });

  expect(renderedText()).toContain("Delete account");
  expect(renderedText()).toContain("Delete my account");
  expect(renderedText()).not.toContain("Request account deletion");
});

it("lets an owner submit a non-destructive deletion request and renders its pending state", async () => {
  const logout = jest.fn();
  userMock.mockReturnValue({
    user: { roles: [Role.SALON_OWNER] },
    logout,
    refreshMe: jest.fn(),
  });
  setupApi({
    request: null,
    resolution: "OWNER_TRANSFER_REQUIRED",
    relatedShopCount: 2,
  });

  await act(async () => {
    tree = TestRenderer.create(createElement(DashboardAccountScreen));
  });
  expect(renderedText()).toContain("Request account deletion");
  expect(renderedText()).toContain("Review ownership of 2 linked shops");

  const start = tree.root.findAll(
    (node: any) =>
      node.props.accessibilityRole === "button" &&
      flattenText(node).includes("Start deletion request"),
  )[0];
  await act(async () => start.props.onPress());
  const confirm = tree.root.findAll(
    (node: any) =>
      node.props.accessibilityRole === "button" &&
      flattenText(node).includes("Confirm deletion request"),
  )[0];
  await act(async () => confirm.props.onPress());

  expect(apiFetchMock).toHaveBeenCalledWith("auth/account/deletion-request", {
    method: "POST",
    body: JSON.stringify({ confirmation: "REQUEST_DELETION" }),
  });
  expect(renderedText()).toContain("Request received");
  expect(renderedText()).toContain(
    "This is a pending request, not completed deletion.",
  );
  expect(logout).not.toHaveBeenCalled();
});

it("does not route a mixed customer-owner account through direct customer deletion", async () => {
  userMock.mockReturnValue({
    user: { roles: [Role.CUSTOMER, Role.SALON_OWNER] },
    logout: jest.fn(),
    refreshMe: jest.fn(),
  });
  setupApi({
    request: null,
    resolution: "MIXED_ROLE_RESOLUTION_REQUIRED",
    relatedShopCount: 1,
  });

  await act(async () => {
    tree = TestRenderer.create(createElement(AccountScreen));
  });

  expect(renderedText()).toContain("multiple role relationships");
  expect(renderedText()).toContain("Request account deletion");
  expect(renderedText()).not.toContain("Delete my account");
  expect(renderedText()).not.toContain("Permanently delete my account");
});

it("shows the governance resolution and does not offer immediate deletion to an administrator", async () => {
  userMock.mockReturnValue({
    user: { roles: [Role.PLATFORM_ADMIN] },
    logout: jest.fn(),
    refreshMe: jest.fn(),
  });
  setupApi({
    request: {
      id: "request-admin",
      status: "REQUESTED",
      createdAt: "2026-10-28T10:00:00.000Z",
    },
    resolution: "ADMIN_GOVERNANCE_REVIEW_REQUIRED",
    relatedShopCount: 0,
  });

  await act(async () => {
    tree = TestRenderer.create(createElement(AccountScreen));
  });

  expect(renderedText()).toContain(
    "Platform administrator succession and recovery access must be reviewed",
  );
  expect(renderedText()).toContain("Request received");
  expect(renderedText()).not.toContain("Permanently delete my account");
});
