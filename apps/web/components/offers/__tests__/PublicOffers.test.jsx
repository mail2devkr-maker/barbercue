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

const offer = (n, extra = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, kind: "DAILY_DEAL", status: "ACTIVE", title: `Deal ${n}`, description: null, discountType: "PERCENT", discountValue: 10, currency: "INR",
  audience: "ALL", inactiveDays: null, validFrom: "2026-10-01T00:00:00.000Z", validTo: "2026-12-01T00:00:00.000Z", maxRedemptions: null, perCustomerLimit: 1, serviceIds: [],
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
  salon: { id: "s1", name: "Studio 360", slug: "studio-360", city: "Jharsuguda" }, eligibility: { audience: "ALL", accountRequired: true },
  prices: [{ serviceId: "a", serviceName: "Haircut", basePrice: 250, discount: 25, finalPrice: 225, currency: "INR" }], ...extra,
});

async function mount(props) {
  let r;
  await act(async () => { r = TestRenderer.create(<PublicOffers {...props} />); });
  await flush();
  return r;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

describe("PublicOffers", () => {
  it("asks for a city first and calls nothing", async () => {
    const r = await mount({ city: null });
    expect(text(r)).toContain("Enter your city");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("refuses something that cannot be a city name", async () => {
    const r = await mount({ city: "../x?y" });
    expect(text(r)).toContain("does not look like a city name");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("lists the city's offers with estimates and a booking link built from the searched city", async () => {
    apiFetch.mockResolvedValue({ items: [offer(1), offer(2)], nextCursor: null });
    const r = await mount({ city: "Jharsuguda", country: "IN" });
    expect(apiFetch.mock.calls[0][0].startsWith("offers?")).toBe(true);
    expect(new URLSearchParams(apiFetch.mock.calls[0][0].split("?")[1]).get("city")).toBe("jharsuguda");
    const t = text(r);
    expect(t).toContain("Deal 1");
    expect(t).toContain("Daily deal");
    expect(t).toContain("10% off");
    expect(t).toContain("Studio 360");
    expect(t).toContain("Jharsuguda");
    expect(t).toContain("Sign in to book");
    const links = r.root.findAll((n) => n.type === "a" && /Book with this offer/.test(collect(n.children)));
    expect(links).toHaveLength(2);
    expect(links[0].props.href).toBe("/book/studio-360?country=in&city=jharsuguda&offer=00000000-0000-4000-8000-000000000001");
  });

  it("says plainly when the city has no offers", async () => {
    apiFetch.mockResolvedValue({ items: [], nextCursor: null });
    const r = await mount({ city: "jharsuguda" });
    expect(text(r)).toContain("no offers in this city");
  });

  it("pages with the cursor the server sent", async () => {
    apiFetch
      .mockResolvedValueOnce({ items: [offer(1)], nextCursor: "00000000-0000-4000-8000-0000000000aa" })
      .mockResolvedValueOnce({ items: [offer(2)], nextCursor: null });
    const r = await mount({ city: "jharsuguda" });
    const more = r.root.findAllByType("button").find((b) => /Show more offers/.test(collect(b.props.children)));
    await act(async () => { more.props.onClick(); });
    await flush();
    expect(new URLSearchParams(apiFetch.mock.calls[1][0].split("?")[1]).get("cursor")).toBe("00000000-0000-4000-8000-0000000000aa");
    expect(text(r)).toContain("Deal 2");
  });
});
