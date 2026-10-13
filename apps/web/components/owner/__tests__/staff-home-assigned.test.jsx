import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { StaffHome } from "../StaffHome";
import { apiFetch } from "../../../lib/api";

// A barber's own day: a customer assigned to them is shown as ASSIGNED (service not started) with an
// explicit Start service action, and only becomes their "Current service" once they press it.

jest.mock("../../../lib/api", () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock("../../../lib/idempotency", () => ({ newIdempotencyKey: () => "key-1" }));
jest.mock("../../../lib/realtime", () => ({
  getRealtimeSocket: () => ({ on: jest.fn(), off: jest.fn(), connected: true }),
  joinSalonRoom: jest.fn(),
  onReconnect: () => () => {},
}));
jest.mock("../NewQueueCustomerDialog", () => ({ NewQueueCustomerDialog: () => null }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));

const item = (over) => ({
  queueEntryId: "q1",
  serviceSessionId: null,
  tokenNumber: 4,
  customerLabel: "Assigned Asha",
  customerPhone: "+919800000001",
  serviceName: "Haircut",
  startedAt: null,
  status: "CALLED",
  chairLabel: "Chair 2",
  ...over,
});

function work(over = {}) {
  return {
    salonId: "s1",
    salonName: "Alpha",
    staffId: "st1",
    displayName: "Ravi",
    status: "ACTIVE",
    availabilityState: "RESERVED",
    current: null,
    assigned: item({}),
    waiting: [],
    appointmentsToday: [],
    completedToday: 2,
    revision: 5,
    ...over,
  };
}

const textOf = (node) => (typeof node === "string" ? node : (node.children ?? []).map(textOf).join(""));
const allText = (tree) => textOf({ children: tree.root.children });

async function render(w) {
  apiFetch.mockImplementation((path, init) => (init?.method ? Promise.resolve({}) : Promise.resolve(w)));
  let tree;
  await act(async () => {
    tree = TestRenderer.create(<StaffHome salonId="s1" />);
  });
  await act(async () => {});
  return tree;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = { setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} };
  apiFetch.mockReset();
});
afterEach(() => {
  delete globalThis.window;
});

describe("barber's day: assigned vs current service", () => {
  it("shows an assigned customer as 'Assigned to you' with Start service - not as a service in progress", async () => {
    const tree = await render(work());
    const text = allText(tree);
    expect(text).toContain("Assigned to you");
    expect(text).toContain("Assigned Asha");
    expect(text).toContain("Assigned · not started");
    expect(text).toContain("The service has not started");
    // the barber's own status chip says a customer is assigned, not "Booked soon"
    expect(text).toContain("Customer assigned");
    expect(text).not.toContain("Booked soon");
    expect(text).not.toContain("Complete Service");
    expect(text).not.toContain("In service");
  });

  it("Start service calls the explicit start action for that customer", async () => {
    const tree = await render(work());
    const start = tree.root.findAllByType("button").find((b) => textOf(b).includes("Start service"));
    await act(async () => start.props.onClick());
    const post = apiFetch.mock.calls.find(([path, init]) => init?.method === "POST");
    expect(String(post[0])).toBe("dashboard/queue-entries/q1/start-service");
  });

  it("once started it is the Current service with Complete Service, and no assigned card", async () => {
    const tree = await render(
      work({
        availabilityState: "IN_SERVICE",
        assigned: null,
        current: item({ serviceSessionId: "ss1", status: "IN_SERVICE", startedAt: new Date().toISOString() }),
      }),
    );
    const text = allText(tree);
    expect(text).toContain("Current service");
    expect(text).toContain("Complete Service");
    expect(text).not.toContain("Assigned to you");
    expect(text).not.toContain("Start service");
  });

  it("a free barber still gets 'Take next customer', which now only assigns", async () => {
    const tree = await render(work({ assigned: null, availabilityState: "AVAILABLE", waiting: [{ ...item({ queueEntryId: "w1", status: "WAITING", chairLabel: null }), eligible: true, position: 1 }] }));
    const take = tree.root.findAllByType("button").find((b) => textOf(b).includes("Take next customer"));
    expect(take).toBeTruthy();
    await act(async () => take.props.onClick());
    const post = apiFetch.mock.calls.find(([path, init]) => init?.method === "POST");
    expect(String(post[0])).toBe("dashboard/salons/s1/queue/take-next");
    expect(allText(tree)).toContain("Press Start service");
  });
});
