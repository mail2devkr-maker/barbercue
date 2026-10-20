// Price-check bounds (Codex PR #268): an empty service list means every active service, at most 100.
import * as O from "../offers";

const valid = (extra = {}) => ({ ...O.EMPTY_OFFER_FORM, title: "Festival 20%", discountValue: "20", validFrom: "2026-10-20T09:00", validTo: "2026-10-27T21:00", ...extra });
const ids = (n) => Array.from({ length: n }, (_, i) => `a0000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

describe("service bound", () => {
  it("allows no service (all of them) and up to 100", () => {
    expect(O.buildOfferBody(valid(), "Asia/Kolkata").body.serviceIds).toEqual([]);
    expect(O.buildOfferBody(valid({ serviceIds: ids(100) }), "Asia/Kolkata").body.serviceIds).toHaveLength(100);
    expect(O.MAX_OFFER_SERVICES).toBe(100);
  });
  it("refuses 101 distinct services next to the field", () => {
    const r = O.buildOfferBody(valid({ serviceIds: ids(101) }), "Asia/Kolkata");
    expect(r.body).toBeNull();
    expect(r.errors.serviceIds).toContain("at most 100");
  });
  it("counts a repeated service once", () => {
    expect(O.buildOfferBody(valid({ serviceIds: [...ids(100), ...ids(100)] }), "Asia/Kolkata").errors.serviceIds).toBeUndefined();
  });
});

describe("previewErrorText", () => {
  it("explains a shop with no active service or a service that is no longer theirs", () => {
    expect(O.previewErrorText("OFFER_SERVICE_MISMATCH", "m")).toContain("no active service to check");
  });
  it("explains the bound when the shop has more than 100 active services", () => {
    const text = O.previewErrorText("OFFER_INVALID", "This shop has more than 100 active services. Select a bounded set to preview.");
    expect(text).toContain("more than 100 active services");
    expect(text).toContain("Tick up to 100");
  });
  it("leaves any other error to the general wording", () => {
    expect(O.previewErrorText("OFFER_INVALID", "Percentage discounts must be whole numbers.")).toContain("not accepted");
    expect(O.previewErrorText("OFFER_CHANGED_RETRY", "m")).toContain("Reload");
    expect(O.previewErrorText("X", "as sent")).toBe("as sent");
  });
});
