import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { OfferPromoPanel } from "../OfferPromoPanel";
import { apiFetch, ApiError } from "../../../../lib/api";
import { shareOrCopy } from "../../../../lib/booking-actions";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));
jest.mock("../../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});
jest.mock("../../../../lib/booking-actions", () => ({ shareOrCopy: jest.fn() }));

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join(" ");
  return collect(node.children);
};
const text = (r) => collect(r.toJSON());
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const button = (r, re) => r.root.findAll((n) => typeof n.type === "string" && n.type === "button" && re.test(collect(n.props.children)))[0];
const anchor = (r, re) => r.root.findAll((n) => n.type === "a" && re.test(collect(n.props.children)))[0];

const TZ = "Asia/Kolkata";
const TOKEN = "T".repeat(43);
const OFFER = {
  id: "o1", salonId: "s1", kind: "PROMOTION", status: "ACTIVE", title: "Monsoon Special", description: "Free head massage with every cut.", discountType: "PERCENT", discountValue: 20,
  currency: "INR", audience: "ALL", inactiveDays: null, validFrom: "2026-10-01T04:30:00.000Z", validTo: "2026-10-31T18:30:00.000Z", maxRedemptions: null, perCustomerLimit: 1,
  serviceIds: ["sv1"], redemptionCount: 3, createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z",
};
const SERVICES = [{ id: "sv1", name: "Classic Haircut" }, { id: "sv2", name: "Beard Trim" }];
const READY = { salonId: "s1", status: "ACTIVE", publicPath: "/in/patna/fade-house", publicUrl: "https://fastque.com/in/patna/fade-house", readiness: { ready: true, reasons: [] }, metadata: { title: "Fade House", description: null, imageUrl: null } };

let calls;
function install({ share = READY, shareFail, campaign } = {}) {
  calls = [];
  apiFetch.mockImplementation(async (path, opts) => {
    calls.push({ path, opts });
    if (path === "dashboard/salons/s1/share-links") {
      if (shareFail) throw shareFail;
      return share;
    }
    if (path === "dashboard/salons/s1/booking-attribution/campaigns") {
      if (campaign instanceof Error) throw campaign;
      return campaign ?? { id: "c1", token: TOKEN, source: "FACEBOOK", label: "Offer: Monsoon Special" };
    }
    throw new Error(`unexpected ${path}`);
  });
}

async function mount(offer = OFFER, now = new Date("2026-10-15T08:00:00.000Z")) {
  jest.useFakeTimers({ now, doNotFake: ["setTimeout", "setImmediate", "nextTick", "queueMicrotask"] });
  let r;
  await act(async () => { r = TestRenderer.create(<OfferPromoPanel salonId="s1" offer={offer} services={SERVICES} timeZone={TZ} />); });
  await flush();
  await flush();
  return r;
}
const field = (r, id) => r.root.findByProps({ id });
const type = async (r, id, value) => { await act(async () => { field(r, id).props.onChange({ target: { value } }); }); };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  globalThis.navigator = { clipboard: { writeText: jest.fn(async () => {}) } };
});
afterEach(() => { jest.useRealTimers(); delete globalThis.navigator; });

describe("OfferPromoPanel (owner issue #17)", () => {
  describe("offers that cannot be shared produce no post and no request", () => {
    for (const [name, over, expected] of [
      ["a draft", { status: "DRAFT" }, "still a draft"],
      ["a paused offer", { status: "PAUSED" }, "is paused"],
      ["an ended offer", { status: "EXPIRED" }, "has ended"],
      ["an offer whose dates have passed", { validTo: "2026-10-10T18:30:00.000Z" }, "dates have passed"],
      ["an offer that has not started", { validFrom: "2026-11-01T04:30:00.000Z", validTo: "2026-11-30T18:30:00.000Z" }, "has not started yet"],
      ["an offer with every allowed booking used", { maxRedemptions: 3, redemptionCount: 3 }, "All 3 allowed bookings"],
    ]) {
      it(`${name}: says why and asks the server for nothing`, async () => {
        install();
        const r = await mount({ ...OFFER, ...over });
        expect(text(r)).toContain(expected);
        expect(calls).toEqual([]);
        expect(r.root.findAllByType("textarea")).toHaveLength(0);
        expect(r.root.findAllByType("button")).toHaveLength(0);
      });
    }
  });

  it("prepares a post from the offer's own details with the shop's public link, and says FastQue posts nothing", async () => {
    install();
    const r = await mount();
    expect(calls.map((c) => c.path)).toEqual(["dashboard/salons/s1/share-links"]);
    const post = field(r, "promo-text-o1").props.value;
    expect(post).toContain("Monsoon Special at Fade House: 20% off on Classic Haircut.");
    expect(post).toContain("Free head massage with every cut.");
    expect(post).toContain("Book online on FastQue with your account to use it.");
    expect(field(r, "promo-link-o1").props.value).toBe("https://fastque.com/in/patna/fade-house");
    const t = text(r);
    expect(t).toContain("FastQue posts nothing on Facebook, Instagram or anywhere else");
    expect(t).toContain("Instagram has no sharing page for the web");
  });

  it("shows only figures FastQue really has, and says what it cannot see", async () => {
    install();
    const t = text(await mount());
    expect(t).toContain("3 bookings used it");
    expect(t).toContain("FastQue cannot see likes, reach or clicks");
    expect(t).not.toMatch(/\b\d+\s*(likes|views|impressions|clicks|shares)\b/i);
  });

  it("shares exactly the (editable) text and link through WhatsApp, Facebook and email", async () => {
    install();
    const r = await mount();
    await type(r, "promo-text-o1", "Come in this week!");
    const wa = anchor(r, /WhatsApp/).props.href;
    expect(decodeURIComponent(wa.split("?text=")[1])).toBe("Come in this week!\nhttps://fastque.com/in/patna/fade-house");
    expect(anchor(r, /Facebook/).props.href).toBe("https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent("https://fastque.com/in/patna/fade-house"));
    expect(anchor(r, /Email/).props.href).toMatch(/^mailto:/);
  });

  it("copies the post and link together, and does not claim success when the browser blocks copying", async () => {
    install();
    const r = await mount();
    await act(async () => { await button(r, /Copy post/).props.onClick(); });
    const copied = globalThis.navigator.clipboard.writeText.mock.calls[0][0];
    expect(copied).toContain("Monsoon Special at Fade House");
    expect(copied.endsWith("https://fastque.com/in/patna/fade-house")).toBe(true);
    expect(text(r)).toContain("Post and link copied.");
    globalThis.navigator.clipboard.writeText.mockRejectedValueOnce(new Error("denied"));
    await act(async () => { await button(r, /Copy post/).props.onClick(); });
    expect(text(r)).toContain("Your browser blocked copying");
    expect(text(r)).not.toContain("Post and link copied.");
  });

  it("reports the native share honestly: shared, copied fallback, cancelled (silent), unsupported", async () => {
    install();
    const r = await mount();
    for (const [result, expected] of [["shared", "Shared."], ["copied", "were copied instead"], ["unsupported", "Sharing is not available"]]) {
      shareOrCopy.mockResolvedValueOnce(result);
      await act(async () => { await button(r, /Share…/).props.onClick(); });
      expect(text(r)).toContain(expected);
    }
    shareOrCopy.mockResolvedValueOnce("cancelled");
    await act(async () => { await button(r, /Share…/).props.onClick(); });
    expect(text(r)).not.toMatch(/Shared\.|were copied instead|Sharing is not available/);
  });

  describe("tracking link", () => {
    it("creates a campaign named after the offer, for exactly the days it is valid, then shares the tracking link", async () => {
      install();
      const r = await mount();
      await act(async () => { await button(r, /Make a tracking link/).props.onClick(); });
      await flush();
      const post = calls.find((c) => c.path.endsWith("/campaigns"));
      const body = JSON.parse(post.opts.body);
      expect(post.opts.method).toBe("POST");
      expect(body).toMatchObject({ source: "FACEBOOK", label: "Offer: Monsoon Special" });
      expect(body.startsAt).toBe("2026-09-30T18:30:00.000Z"); // 1 Oct 00:00 Asia/Kolkata
      expect(body.endsAt).toBe("2026-10-31T18:30:00.000Z"); // 1 Nov 00:00 Asia/Kolkata (the last day, 31 Oct, is included)
      const link = field(r, "promo-link-o1").props.value;
      expect(link).toBe(`https://fastque.com/in/patna/fade-house?fq_campaign=${TOKEN}`);
      expect(anchor(r, /Facebook/).props.href).toContain(encodeURIComponent(link));
      // the link is labelled Facebook, so WhatsApp and Email must NOT carry it (they would be counted as Facebook)
      expect(decodeURIComponent(anchor(r, /WhatsApp/).props.href.split("?text=")[1]).endsWith("fade-house")).toBe(true);
      expect(anchor(r, /WhatsApp/).props.href).not.toContain(TOKEN);
      expect(anchor(r, /Email/).props.href).not.toContain(TOKEN);
      expect(text(r)).toContain("the label you chose");
      expect(text(r)).toContain("cannot confirm where the link is really posted");
      expect(text(r)).toContain("Tracking link ready");
    });

    it("uses the source the owner picked, and a changed source drops a link made for another one", async () => {
      install();
      const r = await mount();
      await type(r, "promo-source-o1", "INSTAGRAM");
      await act(async () => { await button(r, /Make a tracking link/).props.onClick(); });
      await flush();
      expect(JSON.parse(calls.find((c) => c.path.endsWith("/campaigns")).opts.body).source).toBe("INSTAGRAM");
      await type(r, "promo-source-o1", "OTHER");
      expect(field(r, "promo-link-o1").props.value).toBe("https://fastque.com/in/patna/fade-house");
      expect(text(r)).toContain("Make a tracking link");
    });

    it("keeps the plain shop link and says so when the campaign cannot be created", async () => {
      install({ campaign: new ApiError("Too many campaigns.", 429) });
      const r = await mount();
      await act(async () => { await button(r, /Make a tracking link/).props.onClick(); });
      await flush();
      expect(text(r)).toContain("Too many campaigns.");
      expect(field(r, "promo-link-o1").props.value).toBe("https://fastque.com/in/patna/fade-house");
    });

    it("never makes a link from a token it cannot trust", async () => {
      install({ campaign: { id: "c1", token: "short", source: "FACEBOOK", label: "x" } });
      const r = await mount();
      await act(async () => { await button(r, /Make a tracking link/).props.onClick(); });
      await flush();
      expect(text(r)).toContain("The tracking link could not be built");
      expect(field(r, "promo-link-o1").props.value).toBe("https://fastque.com/in/patna/fade-house");
    });
  });

  it("makes no post when the shop is not open to the public, and shows no link", async () => {
    install({ share: { ...READY, status: "PENDING", readiness: { ready: false, reasons: ["SALON_NOT_PUBLIC"] } } });
    const r = await mount();
    expect(text(r)).toContain("not open to the public yet");
    expect(r.root.findAllByType("textarea")).toHaveLength(0);
    expect(r.root.findAllByType("input")).toHaveLength(0);
  });

  it("makes no post when the server has no trusted public address, and explains a failed load", async () => {
    install({ share: { ...READY, publicUrl: null, readiness: { ready: false, reasons: [] } } });
    expect(text(await mount())).toContain("no trusted public address");
    install({ shareFail: new ApiError("Shop not found.", 404) });
    expect(text(await mount())).toContain("Shop not found.");
  });
  describe("shop and offer isolation (review of PR #306)", () => {
    const READY2 = { ...READY, salonId: "s2", publicPath: "/in/patna/other-shop", publicUrl: "https://fastque.com/in/patna/other-shop", name: "Other Shop" };
    const render = (r, salonId, offer = OFFER) => act(async () => { r.update(<OfferPromoPanel salonId={salonId} offer={offer} services={SERVICES} timeZone={TZ} />); });
    const pending = () => { let release; const gate = new Promise((res) => { release = res; }); return { gate, release }; };

    it("never shows or shares the previous shop's link, not even for a moment after the shop changes", async () => {
      install();
      const r = await mount();
      await act(async () => { await button(r, /Make a tracking link/).props.onClick(); });
      await flush();
      expect(field(r, "promo-link-o1").props.value).toContain(TOKEN);
      const gate = pending();
      apiFetch.mockImplementation(async (path) => { await gate.gate; if (path === "dashboard/salons/s2/share-links") return READY2; throw new Error(`unexpected ${path}`); });
      await render(r, "s2");
      const t = text(r);
      expect(t).toContain("Preparing your post");
      expect(t).not.toContain("fade-house");
      expect(t).not.toContain(TOKEN);
      expect(r.root.findAll((n) => n.props && n.props.id === "promo-link-o1")).toHaveLength(0);
      await act(async () => { gate.release(); });
      await flush();
      expect(field(r, "promo-link-o1").props.value).toBe("https://fastque.com/in/patna/other-shop");
      expect(JSON.stringify(r.toJSON())).not.toContain(TOKEN);
    });

    it("drops a tracking link that finishes for the previous shop after the owner has moved on", async () => {
      install();
      const r = await mount();
      const gate = pending();
      apiFetch.mockImplementation(async (path) => {
        if (path.endsWith("/campaigns")) { await gate.gate; return { id: "c1", token: TOKEN, source: "FACEBOOK", label: "x" }; }
        if (path === "dashboard/salons/s2/share-links") return READY2;
        throw new Error(`unexpected ${path}`);
      });
      let click;
      await act(async () => { click = button(r, /Make a tracking link/).props.onClick(); });
      await render(r, "s2");
      await flush();
      await act(async () => { gate.release(); await click; });
      await flush();
      expect(field(r, "promo-link-o1").props.value).toBe("https://fastque.com/in/patna/other-shop");
      expect(JSON.stringify(r.toJSON())).not.toContain(TOKEN);
    });

    it("starts a different offer of the same shop from scratch: no old text edits, no old tracking link", async () => {
      install();
      const r = await mount();
      await type(r, "promo-text-o1", "My own words");
      await act(async () => { await button(r, /Make a tracking link/).props.onClick(); });
      await flush();
      await render(r, "s1", { ...OFFER, id: "o2", title: "Winter Special" });
      await flush();
      await flush();
      const t = JSON.stringify(r.toJSON());
      expect(t).not.toContain(TOKEN);
      expect(t).not.toContain("My own words");
      expect(field(r, "promo-link-o2").props.value).toBe("https://fastque.com/in/patna/fade-house");
    });
  });

  describe("channel labels (review of PR #306)", () => {
    it("a link labelled Other may be carried by WhatsApp and Email, but the Facebook button keeps the plain link", async () => {
      install({ campaign: { id: "c1", token: TOKEN, source: "OTHER", label: "x" } });
      const r = await mount();
      await type(r, "promo-source-o1", "OTHER");
      await act(async () => { await button(r, /Make a tracking link/).props.onClick(); });
      await flush();
      expect(anchor(r, /WhatsApp/).props.href).toContain(encodeURIComponent(TOKEN));
      expect(anchor(r, /Email/).props.href).toContain(encodeURIComponent(TOKEN));
      expect(anchor(r, /Facebook/).props.href).not.toContain(TOKEN);
    });
    it("a link labelled Instagram is carried by no automatic share button", async () => {
      install();
      const r = await mount();
      await type(r, "promo-source-o1", "INSTAGRAM");
      await act(async () => { await button(r, /Make a tracking link/).props.onClick(); });
      await flush();
      for (const re of [/WhatsApp/, /Facebook/, /Email/]) expect(anchor(r, re).props.href).not.toContain(TOKEN);
      expect(field(r, "promo-link-o1").props.value).toContain(TOKEN); // Copy post / Share use the link shown, which the owner can see
    });
  });
});
