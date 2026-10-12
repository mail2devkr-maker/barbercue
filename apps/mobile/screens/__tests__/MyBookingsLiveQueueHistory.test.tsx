import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { uiStringsFor } from "@barbercue/shared";
import MyBookingsScreen from "../MyBookingsScreen";
import { apiFetch } from "../../lib/api";

const t = uiStringsFor("EN");

jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  const ReactRuntime = require("react");
  return {
    ...actual,
    useFocusEffect: (callback: () => void | (() => void)) =>
      ReactRuntime.useEffect(callback, [callback]),
  };
});

jest.mock("../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock("../../lib/use-rebook", () => ({
  useRebook: () => ({ rebook: jest.fn(), rebookingId: null, rebookError: null }),
}));
jest.mock("../../lib/language-context", () => ({
  useLanguage: () => ({ language: "EN", t: require("@barbercue/shared").uiStringsFor("EN") }),
}));
jest.mock("../../lib/booking-actions", () => ({ openDirections: jest.fn() }));
jest.mock("../../components/ReviewPanel", () => ({
  ReviewPanel: ({ title }: { title: string }) => {
    const ReactRuntime = require("react");
    const { Text: NativeText } = require("react-native");
    return ReactRuntime.createElement(NativeText, { testID: "review-title" }, title);
  },
}));
jest.mock("../../components/ui", () => {
  const ReactRuntime = require("react");
  const { Text: NativeText, View: NativeView } = require("react-native");
  return {
    Screen: NativeView,
    SectionHeader: ({ title }: { title: string }) =>
      ReactRuntime.createElement(NativeText, null, title),
    Skeleton: NativeView,
    EmptyState: ({ title, message }: { title: string; message: string }) =>
      ReactRuntime.createElement(NativeText, null, `${title} ${message}`),
    InlineError: ({ message }: { message: string }) =>
      ReactRuntime.createElement(NativeText, null, message),
    Button: ({ title }: { title: string }) => ReactRuntime.createElement(NativeText, null, title),
  };
});

const completedVisit = {
  id: "LIVE_QUEUE:queue-completed",
  source: "LIVE_QUEUE",
  bookingId: null,
  queueEntryId: "queue-completed",
  salonId: "salon-1",
  salonName: "Handsome Center",
  salonTimezone: "Asia/Kolkata",
  currency: "INR",
  status: "COMPLETED",
  serviceDate: "2026-10-11T08:00:00.000Z",
  joinedAt: "2026-10-11T08:00:00.000Z",
  startedAt: "2026-10-11T08:20:00.000Z",
  completedAt: "2026-10-11T08:45:00.000Z",
  services: [{ serviceId: "service-1", name: "Haircut", assignedStaffName: "Asha", price: null }],
  serviceName: "Haircut",
  assignedStaffName: "Asha",
  price: null,
  review: null,
  reviewEligible: true,
  myReview: null,
};

const expiredVisit = {
  ...completedVisit,
  id: "LIVE_QUEUE:queue-expired",
  queueEntryId: "queue-expired",
  status: "EXPIRED",
  completedAt: null,
  reviewEligible: false,
};

const onlineVisit = {
  ...completedVisit,
  id: "ONLINE_BOOKING:booking-completed",
  source: "ONLINE_BOOKING",
  bookingId: "booking-completed",
  queueEntryId: null,
  serviceName: "Beard trim",
};

let tree: ReturnType<typeof TestRenderer.create> | undefined;

function collectRenderedText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectRenderedText).join(" ");
  if (node && typeof node === "object" && "children" in node) {
    return collectRenderedText((node as { children?: unknown }).children);
  }
  return "";
}

beforeEach(() => {
  jest.clearAllMocks();
  (apiFetch as jest.Mock).mockImplementation(async (path: string) => {
    if (path.includes("history/mine")) {
      return { items: [onlineVisit, completedVisit, expiredVisit], nextCursor: null };
    }
    if (path.endsWith("bookings/mine")) {
      return { items: [], nextCursor: null };
    }
    throw new Error("Unexpected API request in My Bookings rendering test");
  });
});

afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
});

it("renders authenticated completed and expired Live Queue visits without changing their status", async () => {
  await act(async () => {
    tree = TestRenderer.create(
      createElement(MyBookingsScreen, { navigation: { navigate: jest.fn() } } as never),
    );
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });

  const apiPaths = (apiFetch as jest.Mock).mock.calls.map(([path]) => path);
  expect(apiPaths).toEqual(
    expect.arrayContaining([
      expect.stringContaining("history/mine"),
      expect.stringContaining("bookings/mine"),
    ]),
  );
  const renderedText = collectRenderedText(tree!.root);

  expect(renderedText).toContain(t.allVisitHistory);
  expect(renderedText).toContain("Haircut");
  expect(renderedText).toContain(t.statusCompleted);
  expect(renderedText).toContain(t.statusExpired);
  expect(renderedText).toContain(t.sourceLiveQueue);
  expect(renderedText).toContain(t.sourceOnlineBooking);
  expect(renderedText).toContain("Beard trim");
  expect(renderedText).toContain(t.rateYourService);
  expect(apiFetch).toHaveBeenCalledWith(
    expect.stringContaining("bookings/history/mine?source=all&limit=20"),
  );
});
