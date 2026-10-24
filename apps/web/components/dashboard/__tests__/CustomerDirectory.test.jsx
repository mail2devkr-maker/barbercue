import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { CustomerDirectory } from "../CustomerDirectory";
import { apiFetch, ApiError } from "../../../lib/api";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));
jest.mock("../../ui/Button", () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button> }));
jest.mock("../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(status, body) {
      super(body?.error?.message ?? "Request failed");
      this.status = status;
      this.code = body?.error?.code ?? "UNKNOWN_ERROR";
    }
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join(" ");
  return collect(node.children);
};
const text = (r) => collect(r.toJSON());
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const wait = async (ms) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };
const button = (r, label) => r.root.findAllByType("button").find((b) => new RegExp(label).test(collect(b.props.children)));

const row = (n, extra = {}) => ({
  customerId: `c${n}`, phone: `+91900000000${n}`, email: null, currency: "INR", displayName: null, displayNameSource: "NOT_ON_FILE",
  totalBookings: 3, completedCount: 2, cancelledCount: 1, noShowCount: 0, firstVisitAt: "2026-09-01T05:00:00.000Z", lastVisitAt: "2026-10-10T05:00:00.000Z",
  totalVisitCount: 3, completedVisitCount: 2, liveQueueVisitCount: 0, completedLiveQueueVisitCount: 0, cancelledLiveQueueVisitCount: 0,
  expiredLiveQueueVisitCount: 0, noShowLiveQueueVisitCount: 0, recordedCollections: 700, recordedRefunds: 200, totalSpent: 500, repeatVisitCount: 1, segment: "repeat", ...extra,
});

let calls;
let handler;
function install(fn) {
  calls = [];
  handler = fn;
  apiFetch.mockImplementation(async (path) => {
    calls.push(path);
    return handler(path);
  });
}
const query = (path) => new URLSearchParams(path.split("?")[1]);
const page = (items, nextCursor = null) => ({ salonId: "s1", currency: "INR", items, nextCursor });

async function mount(props = {}) {
  let r;
  await act(async () => { r = TestRenderer.create(<CustomerDirectory salonId="s1" {...props} />); });
  await flush();
  return r;
}
const type = async (r, id, value) => { await act(async () => { r.root.findByProps({ id }).props.onChange({ target: { value } }); }); };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

describe("CustomerDirectory", () => {
  it("asks the server directory route and shows recorded contact; with no name on file it shows contact only, never an invented name", async () => {
    install(() => page([row(1), row(2, { phone: null, email: "a@b.test", segment: "frequent" })]));
    const r = await mount();
    expect(calls[0].startsWith("dashboard/salons/s1/customers/directory?")).toBe(true);
    expect(query(calls[0]).get("limit")).toBe("25");
    const t = text(r);
    expect(t).toContain("+919000000001");
    expect(t).toContain("a@b.test");
    expect(t).toContain("Repeat");
    expect(t).toContain("Frequent");
    expect(t).toContain("Recorded spend");
    expect(t).not.toMatch(/Unknown|null/);
    expect(r.root.findAll((n) => n.props?.href === "/dashboard/salons/s1/customers/c1").length).toBeGreaterThan(0);
  });

  describe("customer name (owner issue #6)", () => {
    it("shows the name the customer gave when joining the queue, with that source, beside the contact details", async () => {
      install(() => page([row(1, { displayName: "Asha Kapoor", displayNameSource: "CONTACT_NAME_ON_VISIT" })]));
      const r = await mount();
      const t = text(r);
      expect(t).toContain("Asha Kapoor");
      expect(t).toContain("+919000000001");
      expect(t).toContain("Name given when joining the queue");
      expect(r.root.findAll((n) => n.props?.title === "Name given when joining the queue").length).toBeGreaterThan(0);
    });

    it("labels a name that came from a booking differently", async () => {
      install(() => page([row(2, { displayName: "Bina Guest", displayNameSource: "GUEST_NAME_ON_BOOKING" })]));
      const t = text(await mount());
      expect(t).toContain("Bina Guest");
      expect(t).toContain("Name given on a booking");
      expect(t).not.toContain("Name given when joining the queue");
    });

    it("never shows a name or a source note when none is on file, and still shows the contact line", async () => {
      install(() => page([row(3), row(4, { displayName: "   ", displayNameSource: "NOT_ON_FILE" }), row(5, { phone: null, email: null })]));
      const t = text(await mount());
      expect(t).toContain("+919000000003");
      expect(t).toContain("No contact recorded");
      expect(t).not.toMatch(/Name given|Unknown|null|undefined/);
    });

    it("renders a hostile name as plain text (no markup is created from it)", async () => {
      const hostile = '<img src=x onerror=alert(1)> & "Bob"';
      install(() => page([row(6, { displayName: hostile, displayNameSource: "CONTACT_NAME_ON_VISIT" })]));
      const r = await mount();
      expect(text(r)).toContain(hostile);
      expect(r.root.findAllByType("img")).toHaveLength(0);
    });

    it("keeps the name for the same customer when the page is searched again", async () => {
      install((path) => page(query(path).get("q") ? [row(1, { displayName: "Asha Kapoor", displayNameSource: "CONTACT_NAME_ON_VISIT" })] : [row(1, { displayName: "Asha Kapoor", displayNameSource: "CONTACT_NAME_ON_VISIT" }), row(2)]));
      const r = await mount();
      await type(r, "customer-search", "Asha");
      await wait(500);
      await flush();
      expect(calls.some((c) => query(c).get("q") === "Asha")).toBe(true);
      expect(text(r)).toContain("Asha Kapoor");
    });
  });

  it("sends the search only after the owner pauses, with a phone reduced to digits", async () => {
    install(() => page([row(1)]));
    const r = await mount();
    await type(r, "customer-search", "+91-98765 43210");
    expect(calls).toHaveLength(1);
    await wait(500);
    await flush();
    expect(calls).toHaveLength(2);
    expect(query(calls[1]).get("q")).toBe("919876543210");
  });

  it("sends segment, sort and minimum visits for the whole shop", async () => {
    install(() => page([row(1)]));
    const r = await mount();
    await act(async () => { button(r, "Frequent").props.onClick(); });
    await type(r, "customer-sort", "totalSpent");
    await type(r, "customer-min-visits", "3");
    await wait(500);
    await flush();
    const q = query(calls.at(-1));
    expect(q.get("segment")).toBe("frequent");
    expect(q.get("sort")).toBe("totalSpent");
    expect(q.get("minVisits")).toBe("3");
  });

  it("keeps two filter changes made in the same instant (no change overwrites the other)", async () => {
    install(() => page([row(1)]));
    const r = await mount();
    await act(async () => {
      button(r, "Repeat").props.onClick();
      r.root.findByProps({ id: "customer-min-visits" }).props.onChange({ target: { value: "4" } });
      r.root.findByProps({ id: "customer-sort" }).props.onChange({ target: { value: "visits" } });
    });
    await wait(500);
    await flush();
    const q = query(calls.at(-1));
    expect(q.get("segment")).toBe("repeat");
    expect(q.get("minVisits")).toBe("4");
    expect(q.get("sort")).toBe("visits");
  });

  it("does not send an invalid minimum and says why", async () => {
    install(() => page([row(1)]));
    const r = await mount();
    await type(r, "customer-min-visits", "many");
    await wait(500);
    await flush();
    expect(text(r)).toContain("whole number");
    expect(calls.every((c) => !query(c).has("minVisits"))).toBe(true);
  });

  it("continues with the cursor exactly as the server sent it", async () => {
    install((path) => (query(path).has("cursor") ? page([row(3)]) : page([row(1), row(2)], "signed.cursor/with+chars=")));
    const r = await mount();
    await act(async () => { button(r, "Show more customers").props.onClick(); });
    await flush();
    expect(query(calls.at(-1)).get("cursor")).toBe("signed.cursor/with+chars=");
    expect(text(r)).toContain("+919000000003");
    expect(button(r, "Show more customers")).toBeUndefined();
  });

  it("stops paging, without duplicating rows, when the server sends the same page again", async () => {
    install(() => page([row(1), row(2)], "same.cursor"));
    const r = await mount();
    await act(async () => { button(r, "Show more customers").props.onClick(); });
    await flush();
    expect(text(r)).toContain("sent the same rows again");
    expect(r.root.findAllByType("li")).toHaveLength(2);
    expect(button(r, "Show more customers")).toBeUndefined();
  });

  it("restarts from the first page when the server says the cursor no longer matches", async () => {
    let first = true;
    install((path) => {
      if (query(path).has("cursor")) throw new ApiError(400, { error: { code: "INVALID_FILTER", message: "bad cursor" } });
      if (first) { first = false; return page([row(1)], "c1"); }
      return page([row(9)]);
    });
    const r = await mount();
    await act(async () => { button(r, "Show more customers").props.onClick(); });
    await flush();
    await flush();
    expect(text(r)).toContain("reloaded from the start");
    expect(text(r)).toContain("+919000000009");
  });

  it("keeps the customers already shown when paging is unavailable", async () => {
    install((path) => {
      if (query(path).has("cursor")) throw new ApiError(503, { error: { code: "CUSTOMER_DIRECTORY_CURSOR_UNAVAILABLE", message: "x" } });
      return page([row(1)], "c1");
    });
    const r = await mount();
    await act(async () => { button(r, "Show more customers").props.onClick(); });
    await flush();
    expect(text(r)).toContain("Paging more customers is not available");
    expect(text(r)).toContain("+919000000001");
  });

  it("tells the page when the server has no directory route, and shows no error of its own", async () => {
    install(() => { throw new ApiError(404, { error: { code: "NOT_FOUND", message: "Cannot GET" } }); });
    const onRouteMissing = jest.fn();
    const r = await mount({ onRouteMissing });
    expect(onRouteMissing).toHaveBeenCalledTimes(1);
    expect(text(r)).not.toContain("Cannot GET");
  });

  it("refuses a non-owner in plain words", async () => {
    install(() => { throw new ApiError(403, { error: { code: "FORBIDDEN_ROLE", message: "no" } }); });
    const r = await mount();
    expect(text(r)).toContain("Only the shop owner");
  });

  it("says so when no customer matches, and offers to clear the filters", async () => {
    install((path) => (query(path).has("segment") ? page([]) : page([row(1)])));
    const r = await mount();
    await act(async () => { button(r, "New").props.onClick(); });
    await wait(500);
    await flush();
    expect(text(r)).toContain("No customer matches these filters");
    await act(async () => { button(r, "Clear filters").props.onClick(); });
    await wait(500);
    await flush();
    expect(text(r)).toContain("+919000000001");
  });
});
