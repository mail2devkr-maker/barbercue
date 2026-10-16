import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { LiveQueueConsole } from "../LiveQueueConsole";
import { apiFetch } from "../../../lib/api";
import { setVoiceEnabled, useVoiceEnabled } from "../../../lib/voice-preference";

// Owner-approved workflow: arrived WAITING -> IN_SERVICE -> COMPLETED. Historical
// CALLED/ASSIGNED reservations from older apps remain visible under Waiting, never mislabeled as started.

jest.mock("../../../lib/api", () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock("../../../lib/auth-context", () => ({ useAuth: () => ({ user: { id: "u1", preferredLanguage: "en" } }) }));
jest.mock("../../../lib/realtime", () => ({
  getRealtimeSocket: () => ({ on: jest.fn(), off: jest.fn(), connected: true }),
  joinSalonRoom: jest.fn(),
  onReconnect: () => () => {},
}));
jest.mock("../../../lib/voice-preference", () => ({
  ownerVoiceAnnouncements: () => ({ newCustomerJoined: () => "" }),
  setVoiceEnabled: jest.fn(),
  speakOwnerVoice: jest.fn(),
  useVoiceEnabled: jest.fn(() => false),
}));
jest.mock("../OwnerShell", () => ({ useOwnerShell: () => ({ kind: "owner", refreshCounts: jest.fn() }) }));
jest.mock("../NewQueueCustomerDialog", () => ({ NewQueueCustomerDialog: () => null }));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...rest }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
let search = "view=waiting";
const replace = jest.fn();
jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/salons/s1/queue",
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

const entry = (over) => ({
  id: "x",
  salonId: "s1",
  bookingId: null,
  source: "WALK_IN",
  tokenNumber: 1,
  status: "WAITING",
  assignedStaffId: null,
  assignedChairId: null,
  estimatedWaitMinutes: 10,
  serviceId: "sv1",
  serviceName: "Haircut",
  position: 1,
  customerPhone: null,
  customerName: null,
  arrivedAt: new Date().toISOString(),
  assignedStaffName: null,
  assignedChairLabel: null,
  preferredStaffId: null,
  preferredStaffName: null,
  activeServiceSessionId: null,
  joinedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
  calledAt: null,
  estimatedWaitRangeMinutes: null,
  turnApproaching: false,
  ...over,
});

const waiting = entry({ id: "w1", tokenNumber: 5, customerName: "Waiting Wendy" });
const assigned = entry({
  id: "a1",
  tokenNumber: 7,
  customerName: "Assigned Asha",
  status: "CALLED",
  phase: "ASSIGNED",
  position: null,
  assignedStaffId: "st1",
  assignedChairId: "ch1",
  assignedStaffName: "Ravi",
  assignedChairLabel: "Chair 1",
  assignedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  serviceStartedAt: null,
});
const inService = entry({
  id: "s1",
  tokenNumber: 3,
  customerName: "Serviced Sam",
  status: "IN_SERVICE",
  phase: "IN_SERVICE",
  position: null,
  assignedStaffId: "st2",
  assignedChairId: "ch2",
  assignedStaffName: "Sunil",
  assignedChairLabel: "Chair 2",
  activeServiceSessionId: "ss1",
  serviceStartedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
});

function board(over = {}) {
  return {
    revision: 100,
    entries: [waiting, assigned, inService],
    sections: { waiting: [waiting], called: [], assigned: [assigned], inService: [inService], completedToday: [], historyToday: [] },
    counts: { waiting: 1, called: 0, assigned: 1, inService: 1, completedToday: 0, historyToday: 0 },
    autoAssignEnabled: true,
    staffRoster: [
      { id: "st1", displayName: "Ravi", status: "ACTIVE", availabilityState: "RESERVED", busyUntil: null, nextBookingStart: null },
      { id: "st2", displayName: "Sunil", status: "ACTIVE", availabilityState: "IN_SERVICE", busyUntil: null, nextBookingStart: null },
      { id: "st3", displayName: "Meena", status: "ACTIVE", availabilityState: "AVAILABLE", busyUntil: null, nextBookingStart: null },
    ],
    chairs: [
      { id: "ch1", label: "Chair 1", occupancy: "FREE", reservedForEntryId: "a1", reservedForTokenNumber: 7 },
      { id: "ch2", label: "Chair 2", occupancy: "FASTQUE", activeServiceSessionId: "ss1", tokenNumber: 3, assignedStaffName: "Sunil" },
      { id: "ch3", label: "Chair 3", occupancy: "FREE" },
    ],
    services: [{ id: "sv1", name: "Haircut" }],
    ...over,
  };
}

const textOf = (node) => (typeof node === "string" ? node : (node.children ?? []).map(textOf).join(""));
const allText = (tree) => textOf({ children: tree.root.children });

async function render(snapshot = board()) {
  apiFetch.mockImplementation((path, init) => {
    const p = String(path);
    if (init?.method === "POST" || init?.method === "PATCH") return Promise.resolve({});
    return p.endsWith("/queue") ? Promise.resolve(snapshot) : Promise.resolve({});
  });
  let tree;
  await act(async () => {
    tree = TestRenderer.create(<LiveQueueConsole salonId="s1" />);
  });
  await act(async () => {});
  return tree;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = {
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  apiFetch.mockReset();
  useVoiceEnabled.mockReturnValue(false);
  setVoiceEnabled.mockClear();
  replace.mockClear();
  search = "view=waiting";
});
afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

describe("Live Queue: direct service start and a separate NO SHOW tab", () => {
  it("has Waiting, In service, Completed, NO SHOW, Cancelled & expired — never Assigned", async () => {
    search = "view=waiting";
    const tree = await render();
    const tabs = tree.root.findAllByProps({ role: "tab" });
    const labels = tabs.map((t) => textOf(t).replace(/\s+/g, " ").trim());
    expect(labels.join("|")).toMatch(/Waiting.*2/); // one genuine waiting + one legacy reservation
    expect(labels.join("|")).toMatch(/In service.*1/);
    expect(labels.join("|")).toMatch(/NO SHOW.*0/);
    expect(labels.some((l) => l.startsWith("Completed today"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Cancelled & expired"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Assigned"))).toBe(false);
  });

  it("keeps legacy reserved visits under Waiting until the barber starts, never falsifies In service", async () => {
    search = "view=waiting";
    const tree = await render();
    const t = allText(tree);
    expect(t).toContain("Waiting Wendy");
    expect(t).toContain("Assigned Asha");
    expect(t).toContain("Ready to start · legacy reservation");
    expect(t).toContain("Reserved for Ravi · Chair 1");
    expect(t).toContain("Existing reservation from an older app");
    expect(t).not.toContain("Serviced Sam");

    search = "view=in-service";
    const active = await render();
    expect(allText(active)).toContain("Serviced Sam");
    expect(allText(active)).not.toContain("Assigned Asha");
    expect(allText(active)).not.toContain("Waiting Wendy");
  });

  it("legacy Start service posts an idempotency key and refreshes", async () => {
    search = "view=waiting";
    const tree = await render();
    const startButton = tree.root.findAllByType("button").find((b) => textOf(b) === "Start service");
    expect(startButton).toBeTruthy();
    await act(async () => startButton.props.onClick());
    const post = apiFetch.mock.calls.find(([path, init]) => init?.method === "POST" && String(path).endsWith("/queue-entries/a1/start-service"));
    expect(post).toBeTruthy();
    expect(post[1].headers?.["Idempotency-Key"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(apiFetch.mock.calls.filter(([path, init]) => String(path).endsWith("/queue") && !init?.method).length).toBeGreaterThanOrEqual(2);
  });

  it("only NO_SHOW records appear in NO SHOW, not in Cancelled & expired", async () => {
    const absent = entry({ id: "absent", status: "NO_SHOW", phase: "NO_SHOW", customerName: "Absent Anna" });
    const expired = entry({ id: "expired", status: "EXPIRED", phase: "EXPIRED", customerName: "Expired Eric" });
    const cancelled = entry({ id: "cancelled", status: "CANCELLED", phase: "CANCELLED", customerName: "Cancelled Chris" });
    const snapshot = board({ entries: [], sections: {
      waiting: [], called: [], assigned: [], inService: [], completedToday: [], historyToday: [absent, expired, cancelled],
    } });

    search = "view=no-show";
    const noShowTree = await render(snapshot);
    expect(allText(noShowTree)).toContain("Absent Anna");
    expect(allText(noShowTree)).toContain("NO SHOW");
    expect(allText(noShowTree)).not.toContain("Expired Eric");
    expect(allText(noShowTree)).not.toContain("Cancelled Chris");
    const tabs = noShowTree.root.findAllByProps({ role: "tab" }).map((t) => textOf(t));
    expect(tabs.find((t) => t.startsWith("NO SHOW"))).toMatch(/1/);
    expect(tabs.find((t) => t.startsWith("Cancelled"))).toMatch(/2/);

    search = "view=history";
    const historyTree = await render(snapshot);
    expect(allText(historyTree)).not.toContain("Absent Anna");
    expect(allText(historyTree)).toContain("Expired Eric");
    expect(allText(historyTree)).toContain("Cancelled Chris");
  });

  it("a remote unarrived customer can be marked NO SHOW but not automatically started", async () => {
    search = "view=waiting";
    const absent = entry({ id: "remote", tokenNumber: 8, customerName: "Remote Ria", arrivedAt: null });
    const snapshot = board({ entries: [absent], sections: {
      waiting: [absent], called: [], assigned: [], inService: [], completedToday: [], historyToday: [],
    } });
    const tree = await render(snapshot);
    expect(allText(tree)).toContain("Background auto-assignment waits for arrival.");
    expect(allText(tree)).toContain("Mark as in the shop");
    const start = tree.root.findAllByType("button").find((b) => textOf(b) === "Start service automatically");
    expect(start).toBeTruthy();
    expect(start.props.disabled).toBe(true);
    const noShow = tree.root.findAllByType("button").find((b) => textOf(b) === "Mark NO SHOW");
    expect(noShow).toBeTruthy();
    await act(async () => noShow.props.onClick());
    expect(apiFetch.mock.calls).toContainEqual([expect.stringMatching(/queue-entries\/remote\/no-show$/), expect.objectContaining({ method: "POST" })]);
  });

  it("the chair reserved by an older client is not offered to another guest", async () => {
    search = "view=waiting";
    const tree = await render();
    const t = allText(tree);
    expect(t).toContain("Reserved · token #7 · not started");
    expect(t).toContain("Reserved for #7 · not started");
    expect(t).toContain("1 of 3 free");
  });

  it("the server-side automatic assignment setting controls its own switch", async () => {
    search = "view=waiting";
    const on = await render(board({ autoAssignEnabled: true }));
    const toggle = on.root.findAllByProps({ role: "switch" }).find((n) => n.props["aria-label"] === "Automatic assignment");
    expect(toggle.props["aria-checked"]).toBe(true);
    await act(async () => toggle.props.onClick());
    const patch = apiFetch.mock.calls.find(([path, init]) => init?.method === "PATCH" && String(path).endsWith("/queue/settings"));
    expect(JSON.parse(patch[1].body)).toEqual({ autoAssignEnabled: false });
    const off = await render(board({ autoAssignEnabled: false }));
    const offToggle = off.root.findAllByProps({ role: "switch" }).find((n) => n.props["aria-label"] === "Automatic assignment");
    expect(offToggle.props["aria-checked"]).toBe(false);
    expect(allText(off)).toContain("Automatic assignment is OFF for this shop");
  });

  it("the OFF warning has an explicit opt-in, not a silent switch", async () => {
    search = "view=waiting";
    const tree = await render(board({ autoAssignEnabled: false }));
    const button = tree.root.findAllByType("button").find((b) => textOf(b).includes("Enable automatic assignment"));
    expect(button).toBeTruthy();
    expect(apiFetch.mock.calls.some(([_, init]) => init?.method === "PATCH")).toBe(false);
    await act(async () => button.props.onClick());
    const patch = apiFetch.mock.calls.find(([path, init]) => init?.method === "PATCH" && String(path).endsWith("/queue/settings"));
    expect(JSON.parse(patch[1].body)).toEqual({ autoAssignEnabled: true });
  });

  it("explicit barber/chair selection starts service directly and does not steal a reserved chair", async () => {
    search = "view=waiting";
    const tree = await render();
    const open = tree.root.findAllByType("button").find((b) => textOf(b).includes("Choose barber"));
    await act(async () => open.props.onClick());
    const staff = tree.root.findAll((n) => n.type === "select" && String(n.props.id).startsWith("as-staff-"))[0];
    const chair = tree.root.findAll((n) => n.type === "select" && String(n.props.id).startsWith("as-chair-"))[0];
    const options = chair.findAllByType("option").map((o) => textOf(o));
    expect(options).toContain("Chair 3");
    expect(options).not.toContain("Chair 1");
    expect(options).not.toContain("Chair 2");
    await act(async () => staff.props.onChange({ target: { value: "st3" } }));
    await act(async () => chair.props.onChange({ target: { value: "ch3" } }));
    const startButton = tree.root.findAllByType("button").find((b) => textOf(b) === "Start service");
    await act(async () => startButton.props.onClick());
    const post = apiFetch.mock.calls.find(([path, init]) => init?.method === "POST" && String(path).endsWith("/queue-entries/w1/assign"));
    expect(post).toBeTruthy();
    expect(JSON.parse(post[1].body)).toMatchObject({ staffId: "st3", chairId: "ch3", startService: true });
  });

  it("cancelled visit shows former staff metadata only in Cancelled & expired", async () => {
    search = "view=history";
    const old = entry({ id: "past", status: "CANCELLED", phase: "CANCELLED", customerName: "Previous Customer",
      assignedStaffId: "st1", assignedStaffName: "Ravi", assignedChairId: "ch1", assignedChairLabel: "Chair 1" });
    const snapshot = board({ entries: [old], sections: {
      waiting: [], called: [], assigned: [], inService: [], completedToday: [], historyToday: [old],
    } });
    const tree = await render(snapshot);
    expect(allText(tree)).toContain("Previously assigned to Ravi · Chair 1");
    const tabs = tree.root.findAllByProps({ role: "tab" }).map((t) => textOf(t));
    expect(tabs.some((t) => t.startsWith("Assigned"))).toBe(false);
    expect(tabs.find((t) => t.startsWith("Cancelled"))).toMatch(/1/);
  });
});

describe("Live Queue voice controls", () => {
  beforeEach(() => {
    // The real Dialog traps keyboard focus. The node test renderer has no DOM: mock only the
    // document event targets needed to confirm the modal's real render/cancel/confirm behavior.
    globalThis.document = {
      activeElement: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
  });

  it("turns voice on immediately, without an unnecessary confirmation", async () => {
    const tree = await render();
    const voice = tree.root.findAllByType("button").find((b) => textOf(b) === "Voice: off");
    expect(voice).toBeTruthy();
    await act(async () => voice.props.onClick());
    expect(setVoiceEnabled).toHaveBeenCalledWith(true);
    expect(allText(tree)).not.toContain("Turn off voice announcements?");
  });

  it("never turns voice off without a separate explicit warning confirmation", async () => {
    useVoiceEnabled.mockReturnValue(true);
    const tree = await render();
    const voice = tree.root.findAllByType("button").find((b) => textOf(b) === "Voice: on");
    expect(voice.props["aria-pressed"]).toBe(true);
    await act(async () => voice.props.onClick());
    expect(setVoiceEnabled).not.toHaveBeenCalled();
    expect(allText(tree)).toContain("Turn off voice announcements?");
    expect(allText(tree)).toContain("Chime alerts will still play.");
    const cancel = tree.root.findAllByType("button").find((b) => textOf(b) === "Keep voice on");
    await act(async () => cancel.props.onClick());
    expect(setVoiceEnabled).not.toHaveBeenCalled();
    expect(allText(tree)).not.toContain("Turn off voice announcements?");
    await act(async () => voice.props.onClick());
    const confirm = tree.root.findAllByType("button").find((b) => textOf(b) === "Yes, turn voice off");
    await act(async () => confirm.props.onClick());
    expect(setVoiceEnabled).toHaveBeenCalledTimes(1);
    expect(setVoiceEnabled).toHaveBeenCalledWith(false);
  });
});
