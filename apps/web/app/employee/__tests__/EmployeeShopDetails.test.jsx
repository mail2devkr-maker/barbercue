import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { EmployeeShopDetails } from "../EmployeeShopDetails";
import { apiFetch, ApiError } from "../../../lib/api";

jest.mock("../../../components/ui/SalonImage", () => ({ SalonImage: ({ url, alt }) => <img data-testid="photo" src={url} alt={alt} /> }));
jest.mock("../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
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
const text = (r) => collect(r.toJSON()).replace(/\s+([,.:])/g, "$1").replace(/\s+/g, " ");
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const button = (r) => r.root.findAllByType("button")[0];

const SHOP = {
  leadId: "L1",
  onboarded: true,
  shop: {
    salonId: "s1", name: "Fade House", status: "ACTIVE", addressLine: "12 Station Road", localityText: "Boring Road", cityName: "Patna",
    publicPath: "/in/patna/fade-house", onboardedAt: "2026-10-20T05:00:00.000Z", businessPhone: "+919812345678",
    photos: [{ id: "p1", url: "https://img.test/cover.jpg", altText: "Shop front", type: "COVER", sortOrder: 0 }, { id: "p2", url: "https://img.test/g.jpg", altText: null, type: "GALLERY", sortOrder: 1 }],
    chairs: [{ id: "c1", label: "Chair 1", status: "ACTIVE" }, { id: "c2", label: "Chair 2", status: "INACTIVE" }],
    chairCounts: { total: 2, active: 1 },
  },
};

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<EmployeeShopDetails leadId="L1" />); });
  return r;
}
const open = async (r) => { await act(async () => { button(r).props.onClick(); }); await flush(); };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

describe("EmployeeShopDetails (owner issue #28)", () => {
  it("fetches nothing until the employee asks, then asks the employee shop route for that lead only", async () => {
    apiFetch.mockResolvedValue(SHOP);
    const r = await mount();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(text(r)).toContain("Shop details");
    await open(r);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("employee/leads/L1/shop");
  });

  it("shows the real shop name, address, phone, chairs and photos", async () => {
    apiFetch.mockResolvedValue(SHOP);
    const r = await mount();
    await open(r);
    const t = text(r);
    expect(t).toContain("Fade House");
    expect(t).toContain("12 Station Road, Boring Road, Patna");
    expect(t).toContain("Business phone +919812345678");
    expect(t).toContain("Chairs: 1 active of 2");
    expect(t).toContain("Chair 1 — active");
    expect(t).toContain("Chair 2 — inactive");
    expect(t).toContain("Photos: 2");
    const photos = r.root.findAllByProps({ "data-testid": "photo" });
    expect(photos.map((p) => p.props.src)).toEqual(["https://img.test/cover.jpg", "https://img.test/g.jpg"]);
    expect(photos[0].props.alt).toBe("Shop front");
    expect(photos[1].props.alt).toBe("Fade House photo");
  });

  it("offers no way to change the shop: the only control is the show/hide button", async () => {
    apiFetch.mockResolvedValue(SHOP);
    const r = await mount();
    await open(r);
    expect(r.root.findAllByType("button")).toHaveLength(1);
    expect(r.root.findAllByType("input")).toHaveLength(0);
    expect(r.root.findAllByType("form")).toHaveLength(0);
  });

  it("says so, instead of inventing details, when the shop has no phone, chairs or photos", async () => {
    apiFetch.mockResolvedValue({ ...SHOP, shop: { ...SHOP.shop, businessPhone: null, photos: [], chairs: [], chairCounts: { total: 0, active: 0 } } });
    const r = await mount();
    await open(r);
    const t = text(r);
    expect(t).toContain("No business phone published");
    expect(t).toContain("No chairs added yet.");
    expect(t).toContain("No photos uploaded yet.");
    expect(r.root.findAllByProps({ "data-testid": "photo" })).toHaveLength(0);
  });

  it("explains a lead with no onboarded shop", async () => {
    apiFetch.mockResolvedValue({ leadId: "L1", onboarded: false, shop: null });
    const r = await mount();
    await open(r);
    expect(text(r)).toContain("This lead has no onboarded shop on record yet.");
  });

  it("shows the server's refusal in words and keeps the page usable", async () => {
    apiFetch.mockRejectedValue(new ApiError(404, "Lead not found."));
    const r = await mount();
    await open(r);
    expect(text(r)).toContain("Lead not found.");
    expect(r.root.findAllByProps({ role: "alert" }).length).toBeGreaterThan(0);
  });

  it("falls back to a plain message when the failure is not a server answer", async () => {
    apiFetch.mockRejectedValue(new Error("network down"));
    const r = await mount();
    await open(r);
    expect(text(r)).toContain("Could not load the shop details.");
    expect(text(r)).not.toContain("network down");
  });

  it("hides and re-shows without fetching again", async () => {
    apiFetch.mockResolvedValue(SHOP);
    const r = await mount();
    await open(r);
    await open(r);
    expect(text(r)).not.toContain("Fade House");
    expect(text(r)).toContain("Shop details");
    await open(r);
    expect(text(r)).toContain("Fade House");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
