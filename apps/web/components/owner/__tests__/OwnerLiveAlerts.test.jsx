import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { OwnerLiveAlerts } from "../OwnerLiveAlerts";
import { apiFetch } from "../../../lib/api";
import { __resetOwnerAlertDedupeForTests, claimOwnerAlert } from "../../../lib/owner-alert-dedupe";
import { speakOwnerVoice, getVoiceEnabled } from "../../../lib/voice-preference";

const handlers = {};
const mockPush = jest.fn();
let mockPath = "/dashboard/salons/s1";
jest.mock("next/navigation", () => ({ usePathname: () => mockPath, useRouter: () => ({ push: mockPush }) }));
jest.mock("../../../lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("../../../lib/auth-context", () => ({ useAuth: () => ({ user: { preferredLanguage: "EN" } }) }));
jest.mock("../../../lib/realtime", () => ({
  getRealtimeSocket: () => ({ on: (e, cb) => { handlers[e] = cb; }, off: (e) => { delete handlers[e]; } }),
  joinSalonRoom: jest.fn(),
}));
jest.mock("../../../lib/voice-preference", () => ({
  getVoiceEnabled: jest.fn(() => true),
  speakOwnerVoice: jest.fn(),
  ownerVoiceAnnouncements: () => ({
    newBookingReceived: (service) => `booking ${service}`,
    newCustomerJoined: (token, service) => `joined ${token} ${service}`,
  }),
}));

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join(" ");
  return collect(node.children);
};
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const cards = (r) => r.root.findAll((n) => n.type === "button" && n.props["data-testid"] === "owner-live-alert");

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<OwnerLiveAlerts salonId="s1" basePath="/dashboard/salons/s1" />); });
  return r;
}

// The web Jest runs in node (no jsdom): give the component the few browser globals it touches.
beforeAll(() => {
  global.window = { addEventListener: jest.fn(), removeEventListener: jest.fn(), setTimeout, clearTimeout, focus: jest.fn() };
  global.document = { visibilityState: "visible" };
});
afterAll(() => {
  delete global.window;
  delete global.document;
});

beforeEach(() => {
  __resetOwnerAlertDedupeForTests();
  speakOwnerVoice.mockClear();
  getVoiceEnabled.mockReturnValue(true);
  apiFetch.mockReset();
  mockPush.mockReset();
  mockPath = "/dashboard/salons/s1";
});

describe("OwnerLiveAlerts — alerts on every dashboard page (owner report, 13 Nov)", () => {
  it("shows and speaks a Live Queue join on the overview page, once, and opens the queue", async () => {
    const r = await mount();
    await act(async () => handlers["queue.entry.joined"]({ salonId: "s1", queueEntryId: "q1", tokenNumber: 4, serviceName: "Haircut" }));
    expect(collect(r.toJSON())).toContain("New customer in Live Queue");
    expect(collect(r.toJSON())).toContain("#4 · Haircut");
    expect(speakOwnerVoice).toHaveBeenCalledWith("joined 4 Haircut", "EN");
    await act(async () => handlers["queue.entry.joined"]({ salonId: "s1", queueEntryId: "q1", tokenNumber: 4, serviceName: "Haircut" }));
    expect(speakOwnerVoice).toHaveBeenCalledTimes(1);
    await act(async () => cards(r)[0].props.onClick());
    expect(mockPush).toHaveBeenCalledWith("/dashboard/salons/s1/queue?view=waiting");
  });

  it("shows and speaks a new booking off the Bookings page", async () => {
    apiFetch.mockResolvedValue({ serviceName: "Fade", salonName: "Handsome Center", slotStart: null });
    const r = await mount();
    await act(async () => handlers["booking.created"]({ salonId: "s1", bookingId: "b1" }));
    await flush();
    expect(cards(r)).toHaveLength(1);
    expect(speakOwnerVoice).toHaveBeenCalledWith("booking Fade", "EN");
  });

  it("leaves the card to the Bookings page and never speaks twice", async () => {
    mockPath = "/dashboard/salons/s1/bookings";
    apiFetch.mockResolvedValue({ serviceName: "Fade", slotStart: null });
    claimOwnerAlert("booking.created", "b2");
    const r = await mount();
    await act(async () => handlers["booking.created"]({ salonId: "s1", bookingId: "b2" }));
    await flush();
    expect(cards(r)).toHaveLength(0);
    expect(speakOwnerVoice).not.toHaveBeenCalled();
  });

  it("stays silent when voice alerts are off, but still shows the card", async () => {
    getVoiceEnabled.mockReturnValue(false);
    const r = await mount();
    await act(async () => handlers["queue.entry.joined"]({ salonId: "s1", queueEntryId: "q5", tokenNumber: 9 }));
    expect(cards(r)).toHaveLength(1);
    expect(speakOwnerVoice).not.toHaveBeenCalled();
  });

  it("ignores another shop's events", async () => {
    const r = await mount();
    await act(async () => handlers["queue.entry.joined"]({ salonId: "s2", queueEntryId: "q9", tokenNumber: 1 }));
    expect(cards(r)).toHaveLength(0);
  });
});
