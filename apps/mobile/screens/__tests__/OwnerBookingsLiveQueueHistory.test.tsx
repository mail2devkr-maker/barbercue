import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { uiStringsFor } from "@barbercue/shared";
import OwnerBookingsScreen from "../owner/OwnerBookingsScreen";
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
jest.mock("../../lib/language-context", () => ({
  useLanguage: () => ({ language: "EN", t: require("@barbercue/shared").uiStringsFor("EN") }),
}));
jest.mock("../../lib/salon-context", () => ({
  useSalon: () => ({ selectedSalonId: "salon-1" }),
}));
jest.mock("../../lib/realtime", () => ({
  getRealtimeSocket: () => ({ on: jest.fn(), off: jest.fn() }),
  joinSalonRoom: jest.fn(),
  onReconnect: () => jest.fn(),
}));
jest.mock("../../lib/voice-announce", () => ({ speakBooking: jest.fn() }));
jest.mock("../../lib/booking-voice-dedupe", () => ({
  claimBookingVoiceEvent: jest.fn(() => true),
}));
jest.mock("../../components/ui", () => {
  const ReactRuntime = require("react");
  const { Text: NativeText, View: NativeView } = require("react-native");
  return {
    Screen: NativeView,
    SectionHeader: ({ title }: { title: string }) =>
      ReactRuntime.createElement(NativeText, null, title),
    Card: NativeView,
    Button: ({ title }: { title: string }) => ReactRuntime.createElement(NativeText, null, title),
    EmptyState: ({ title, message }: { title: string; message: string }) =>
      ReactRuntime.createElement(NativeText, null, `${title} ${message}`),
    Skeleton: NativeView,
    InlineError: ({ message }: { message: string }) =>
      ReactRuntime.createElement(NativeText, null, message),
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
  customerId: "customer-1",
  customerName: null,
  customerPhone: "+919999000000",
  customerEmail: null,
  createdAt: "2026-10-11T08:00:00.000Z",
};

const expiredVisit = {
  ...completedVisit,
  id: "LIVE_QUEUE:queue-expired",
  queueEntryId: "queue-expired",
  status: "EXPIRED",
  completedAt: null,
  reviewEligible: false,
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
    if (path.includes("/timezone")) return { timezone: "Asia/Kolkata" };
    if (path.includes("/history?")) {
      return { items: [completedVisit, expiredVisit], nextCursor: null };
    }
    if (path.includes("/bookings?")) return { items: [], nextCursor: null };
    throw new Error("Unexpected API request in owner history rendering test");
  });
});

afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
});

it("renders historical Live Queue visits with their actual completed and expired states", async () => {
  await act(async () => {
    tree = TestRenderer.create(
      createElement(OwnerBookingsScreen, { route: { params: {} } } as never),
    );
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });

  const renderedText = collectRenderedText(tree!.root);
  expect(renderedText).toContain(t.liveQueueHistory);
  expect(renderedText).toContain("Haircut");
  expect(renderedText).toContain(t.statusCompleted);
  expect(renderedText).toContain(t.statusExpired);
  expect(renderedText).toContain(t.sourceLiveQueue);
  expect(renderedText).toContain(t.notRecordedLabel);
  expect(apiFetch).toHaveBeenCalledWith(
    expect.stringContaining("bookings/history?source=LIVE_QUEUE"),
  );
});
