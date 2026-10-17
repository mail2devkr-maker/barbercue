import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { LocationProposalReview } from "../LocationProposalReview";
import { apiFetch, ApiError } from "../../../lib/api";

jest.mock("../../ui/Button", () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button> }));
jest.mock("../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join("");
  return collect(node.children);
};
const text = (r) => collect(r.toJSON());
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const button = (r, label) => r.root.findAllByType("button").find((b) => new RegExp(label).test(collect(b.props.children)));

const proposal = (over = {}) => ({
  id: "p1", status: "PENDING", latitude: 21.86, longitude: 84.01, source: "GPS", submittedAt: "2026-10-16T10:00:00.000Z", reviewedAt: null, reviewNote: null,
  submittedByUserId: "u1",
  salon: { id: "s1", publicId: "BC-SHOP-000001", name: "Fade House", addressLine: "14 Station Road", localityText: null, postalCode: "768201", cityName: "Jharsuguda", currentLatitude: 21.855, currentLongitude: 84.006 },
  ...over,
});

let calls;
function install({ items = [proposal()], nextCursor = null, onDecision } = {}) {
  calls = [];
  apiFetch.mockImplementation(async (path, opts) => {
    calls.push({ path, opts });
    if (opts?.method === "POST") return onDecision ? onDecision(opts) : {};
    return { items, nextCursor };
  });
}

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<LocationProposalReview />); });
  await flush();
  return r;
}
const writeNote = async (r, value) => { await act(async () => { r.root.findByProps({ id: "note-p1" }).props.onChange({ target: { value } }); }); };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

describe("LocationProposalReview", () => {
  it("loads the pending queue from the admin route and shows what a reviewer needs", async () => {
    install();
    const r = await mount();
    expect(calls[0].path).toBe("admin/location-verifications?limit=20");
    const t = text(r);
    expect(t).toContain("Fade House");
    expect(t).toContain("BC-SHOP-000001");
    expect(t).toContain("14 Station Road, Jharsuguda, 768201");
    expect(t).toContain("21.860000, 84.010000");
    expect(t).toContain("Device location: how it was entered, not proof of position");
    expect(t).toMatch(/About [\d.]+ (m|km) from the current location/);
    const links = r.root.findAll((n) => n.type === "a" && /map/.test(collect(n.props.children)));
    expect(links).toHaveLength(2);
    for (const l of links) expect(l.props.rel).toContain("noopener");
  });

  it("says plainly when nothing is waiting", async () => {
    install({ items: [] });
    expect(text(await mount())).toContain("No proposals are waiting");
  });

  it("shows the server's message when the queue cannot be loaded (for example not a global administrator)", async () => {
    install();
    apiFetch.mockRejectedValue(new ApiError("A global platform administrator is required.", 403));
    expect(text(await mount())).toContain("A global platform administrator is required.");
  });

  it("will not offer a decision until a note of at least three characters is written", async () => {
    install();
    const r = await mount();
    expect(button(r, "Approve").props.disabled).toBe(true);
    expect(button(r, "Reject").props.disabled).toBe(true);
    await writeNote(r, "ok");
    expect(button(r, "Approve").props.disabled).toBe(true);
    await writeNote(r, "Matches the shop front");
    expect(button(r, "Approve").props.disabled).toBe(false);
  });

  it("asks for an explicit confirmation before approving and sends nothing until then", async () => {
    install();
    const r = await mount();
    await writeNote(r, "Matches the shop front");
    await act(async () => { button(r, "^Approve").props.onClick(); });
    expect(text(r)).toContain("public location for distances and maps");
    expect(calls.some((c) => c.opts?.method === "POST")).toBe(false);
    await act(async () => { button(r, "Back").props.onClick(); });
    expect(calls.some((c) => c.opts?.method === "POST")).toBe(false);
  });

  it("sends the decision with the trimmed note, then removes the proposal and says what happened", async () => {
    install();
    const r = await mount();
    await writeNote(r, "  Matches the shop front  ");
    await act(async () => { button(r, "^Approve").props.onClick(); });
    await act(async () => { button(r, "Yes, approve").props.onClick(); });
    await flush();
    const post = calls.find((c) => c.opts?.method === "POST");
    expect(post.path).toBe("admin/location-verifications/p1/decision");
    expect(JSON.parse(post.opts.body)).toEqual({ decision: "APPROVED", note: "Matches the shop front" });
    expect(text(r)).toContain("Approved. The shop's public location now uses the proposed point.");
    expect(text(r)).not.toContain("BC-SHOP-000001");
  });

  it("rejects with the same flow and says the public location is unchanged", async () => {
    install();
    const r = await mount();
    await writeNote(r, "Point is in another town");
    await act(async () => { button(r, "^Reject").props.onClick(); });
    expect(text(r)).toContain("keeps the current public location");
    await act(async () => { button(r, "Yes, reject").props.onClick(); });
    await flush();
    expect(JSON.parse(calls.find((c) => c.opts?.method === "POST").opts.body).decision).toBe("REJECTED");
    expect(text(r)).toContain("The public location is unchanged");
  });

  it("shows the server's refusal (for example the reviewer is the proposer) and keeps the proposal", async () => {
    install({ onDecision: () => { throw new ApiError("You cannot review your own proposal.", 403); } });
    const r = await mount();
    await writeNote(r, "Matches the shop front");
    await act(async () => { button(r, "^Approve").props.onClick(); });
    await act(async () => { button(r, "Yes, approve").props.onClick(); });
    await flush();
    expect(text(r)).toContain("You cannot review your own proposal.");
    expect(text(r)).toContain("BC-SHOP-000001");
    expect(text(r)).not.toContain("Approved.");
  });

  it("loads more with the server's cursor", async () => {
    install({ nextCursor: "CUR" });
    const r = await mount();
    await act(async () => { button(r, "Load more").props.onClick(); });
    await flush();
    expect(calls.at(-1).path).toBe("admin/location-verifications?limit=20&cursor=CUR");
  });
});
