import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { PublicOffers } from "../PublicOffers";
import { apiFetch } from "../../../lib/api";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));
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

const offer = (n, salon = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, kind: "OFFER", status: "ACTIVE", title: `Deal ${n}`, description: null, discountType: "PERCENT", discountValue: 10, currency: "INR",
  audience: "ALL", inactiveDays: null, validFrom: "2026-10-01T00:00:00.000Z", validTo: "2026-12-01T00:00:00.000Z", maxRedemptions: null, perCustomerLimit: 1, serviceIds: [],
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
  salon: { id: "s1", name: "Studio 360", slug: "studio-360", city: "New Delhi", countryCode: "IN", citySlug: "new-delhi", ...salon },
  eligibility: { audience: "ALL", accountRequired: true }, prices: [],
});

async function mount(props) {
  let r;
  await act(async () => { r = TestRenderer.create(<PublicOffers {...props} />); });
  await flush();
  return r;
}
const bookLinks = (r) => r.root.findAll((n) => n.type === "a" && /Book with this offer/.test(collect(n.children)));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

describe("PublicOffers with canonical locations (Codex PR #268)", () => {
  it("asks with the legacy and canonical city filters, and the country only when the address named one", async () => {
    apiFetch.mockResolvedValue({ items: [], nextCursor: null });
    await mount({ city: "New Delhi" });
    let q = new URLSearchParams(apiFetch.mock.calls[0][0].split("?")[1]);
    expect(q.get("city")).toBe("new-delhi");
    expect(q.get("citySlug")).toBe("new-delhi");
    expect(q.has("countryCode")).toBe(false);
    apiFetch.mockClear();
    await mount({ city: "new-delhi", country: "in" });
    q = new URLSearchParams(apiFetch.mock.calls[0][0].split("?")[1]);
    expect(q.get("countryCode")).toBe("IN");
  });

  it("links each card with the offer's own country and city slug, whatever was searched", async () => {
    apiFetch.mockResolvedValue({ items: [offer(1), offer(2, { slug: "other-shop", countryCode: "AE", citySlug: "dubai", city: "Dubai" })], nextCursor: null });
    const r = await mount({ city: "new-delhi" });
    const links = bookLinks(r);
    expect(links).toHaveLength(2);
    expect(links[0].props.href).toBe("/book/studio-360?country=in&city=new-delhi&offer=00000000-0000-4000-8000-000000000001");
    expect(links[1].props.href).toBe("/book/other-shop?country=ae&city=dubai&offer=00000000-0000-4000-8000-000000000002");
  });

  it("for an older server, links from the searched city, and says so when there is nothing to link from", async () => {
    apiFetch.mockResolvedValue({ items: [offer(1, { countryCode: undefined, citySlug: undefined })], nextCursor: null });
    const r = await mount({ city: "jharsuguda" });
    expect(bookLinks(r)[0].props.href).toBe("/book/studio-360?country=in&city=jharsuguda&offer=00000000-0000-4000-8000-000000000001");
  });

  it("asks for a city when none is given, and calls nothing", async () => {
    const r = await mount({ city: null });
    expect(text(r)).toContain("Enter your city");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("shows only what the server returned for the city (no other offers appear)", async () => {
    apiFetch.mockResolvedValue({ items: [offer(1)], nextCursor: null });
    const r = await mount({ city: "new-delhi" });
    expect(text(r)).toContain("Deal 1");
    expect(text(r)).not.toContain("Deal 2");
  });
});
