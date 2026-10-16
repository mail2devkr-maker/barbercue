import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { LiveQueueConsole } from "../LiveQueueConsole";
import { apiFetch } from "../../../lib/api";
import { setVoiceEnabled, useVoiceEnabled } from "../../../lib/voice-preference";

// Owner-approved workflow: WAITING -> ASSIGNED -> IN_SERVICE -> COMPLETED. An assigned customer is shown
// in their own place with a Start service action; they are never counted or listed as waiting, and never
// shown as in service until the barber actually starts.

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
let search = "view=assigned";
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
  search = "view=assigned";
});
afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

describe("Live Queue: Waiting, Assigned and In service are separate places", () => {
  it("shows exact counts on separate tabs", async () => {
    const tree = await render();
    const tabs = tree.root.findAllByProps({ role: "tab" });
    const labels = tabs.map((t) => textOf(t).replace(/\s+/g, " ").trim());
    expect(labels.join("|")).toMatch(/Waiting.*1/);
    expect(labels.join("|")).toMatch(/Assigned.*1/);
    expect(labels.join("|")).toMatch(/In service.*1/);
    expect(labels.some((l) => l.startsWith("Completed today"))).toBe(true);
  });

  it("the Assigned tab lists the assigned customer as 'Assigned · not started', with their barber and chair - and not the others", async () => {
    const tree = await render();
    const text = allText(tree);
    expect(text).toContain("Assigned Asha");
    expect(text).toContain("Assigned · not started");
    expect(text).toContain("Assigned to Ravi · Chair 1");
    expect(text).toContain("Service not started");
    expect(text).not.toContain("Waiting Wendy");
    expect(text).not.toContain("Serviced Sam");
  });

  it("Start service starts the assigned customer through the explicit start-service action, then refreshes", async () => {
    const tree = await render();
    const start = tree.root.findAllByType("button").find((b) => textOf(b).includes("Start service"));
    expect(start).toBeTruthy();
    await act(async () => start.props.onClick());
    const post = apiFetch.mock.calls.find(([path, init]) => init?.method === "POST" && String(path).endsWith("/queue-entries/a1/start-service"));
    expect(post).toBeTruthy();
    // The production Start service endpoint uses @Idempotent(): without this header it returns HTTP 400.
    expect(post[1].headers?.["Idempotency-Key"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const refreshed = apiFetch.mock.calls.filter(([path, init]) => String(path).endsWith("/queue") && !init?.method);
    expect(refreshed.length).toBeGreaterThanOrEqual(2);
  });

  it("an assigned customer is neither listed as waiting nor as in service", async () => {
    search = "view=waiting";
    const waitingTree = await render();
    expect(allText(waitingTree)).toContain("Waiting Wendy");
    expect(allText(waitingTree)).not.toContain("Assigned Asha");

    search = "view=in-service";
    const serviceTree = await render();
    expect(allText(serviceTree)).toContain("Serviced Sam");
    expect(allText(serviceTree)).not.toContain("Assigned Asha");
  });

  it("a waiting customer is told they are waiting for available staff (or to be assigned when automatic assignment is off)", async () => {
    search = "view=waiting";
    expect(allText(await render())).toContain("Waiting for available staff");
    expect(allText(await render(board({ autoAssignEnabled: false })))).toContain("Waiting to be assigned");
  });

  it("explains that background auto-assignment waits until the customer physically arrives", async () => {
    search = "view=waiting";
    const remote = entry({ id: "remote", tokenNumber: 8, customerName: "Remote Customer", arrivedAt: null });
    const snapshot = board({
      entries: [remote],
      sections: { waiting: [remote], called: [], assigned: [], inService: [], completedToday: [], historyToday: [] },
    });
    const tree = await render(snapshot);
    expect(allText(tree)).toContain("Background auto-assignment waits for arrival.");
    expect(allText(tree)).toContain("Mark as in the shop");
  });

  it("the chair held by an assigned customer is shown as reserved, and the barber as assigned", async () => {
    const tree = await render();
    const text = allText(tree);
    expect(text).toContain("Reserved · token #7 · not started");
    expect(text).toContain("Assigned to #7 · not started");
    expect(text).toContain("1 of 3 free"); // only Chair 3 is free: Chair 1 is reserved, Chair 2 is in service
  });

  it("the automatic assignment switch shows what the SERVER says, and changing it PATCHes the opposite", async () => {
    const on = await render(board({ autoAssignEnabled: true }));
    let toggle = on.root.findAllByProps({ role: "switch" }).find((n) => n.props["aria-label"] === "Automatic assignment");
    expect(toggle.props["aria-checked"]).toBe(true);
    await act(async () => toggle.props.onClick());
    const patch = apiFetch.mock.calls.find(([path, init]) => init?.method === "PATCH" && String(path).endsWith("/queue/settings"));
    expect(JSON.parse(patch[1].body)).toEqual({ autoAssignEnabled: false });

    const off = await render(board({ autoAssignEnabled: false }));
    toggle = off.root.findAllByProps({ role: "switch" }).find((n) => n.props["aria-label"] === "Automatic assignment");
    expect(toggle.props["aria-checked"]).toBe(false);
  });

  it("choosing a barber and chair by hand ASSIGNS (startService:false); it does not start the service", async () => {
    search = "view=waiting";
    const tree = await render();
    const open = tree.root.findAllByType("button").find((b) => textOf(b).includes("Choose barber"));
    await act(async () => open.props.onClick());
    const staff = tree.root.findAll((n) => n.type === "select" && String(n.props.id).startsWith("as-staff-"))[0];
    const chair = tree.root.findAll((n) => n.type === "select" && String(n.props.id).startsWith("as-chair-"))[0];
    await act(async () => staff.props.onChange({ target: { value: "st3" } }));
    await act(async () => chair.props.onChange({ target: { value: "ch3" } }));
    const submit = tree.root.findAllByType("button").find((b) => textOf(b).includes("Assign customer"));
    await act(async () => submit.props.onClick());
    const post = apiFetch.mock.calls.find(([path, init]) => init?.method === "POST" && String(path).endsWith("/queue-entries/w1/assign"));
    expect(post).toBeTruthy();
    expect(JSON.parse(post[1].body)).toMatchObject({ staffId: "st3", chairId: "ch3", startService: false });
  });

  it("does not offer the reserved chair to a different customer, only free ones", async () => {
    search = "view=waiting";
    const tree = await render();
    const open = tree.root.findAllByType("button").find((b) => textOf(b).includes("Choose barber"));
    await act(async () => open.props.onClick());
    const chairSelect = tree.root.findAll((n) => n.type === "select" && String(n.props.id).startsWith("as-chair-"))[0];
    const options = chairSelect.findAllByType("option").map((o) => textOf(o));
    expect(options).toContain("Chair 3");
    expect(options).not.toContain("Chair 1");
    expect(options).not.toContain("Chair 2");
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
