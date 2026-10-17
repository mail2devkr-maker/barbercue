import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { ShopSharePanel } from "../ShopSharePanel";
import { apiFetch } from "../../../lib/api";
import { shareOrCopy } from "../../../lib/booking-actions";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));
jest.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value, ...rest }) => <svg data-qr={value} {...rest} />,
  QRCodeCanvas: ({ value }) => <canvas data-qr-canvas={value} />,
}));
jest.mock("../../../lib/api", () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock("../../../lib/booking-actions", () => ({ shareOrCopy: jest.fn() }));

const collect = (node) => (node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(collect).join("") : collect(node.children));
const text = (r) => collect(r.toJSON());
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

const OWN = { id: "s1", slug: "fade-house", name: "Fade House", status: "ACTIVE", publicId: "BC-SHOP-000001" };
const LISTING = { id: "s1", slug: "fade-house", citySlug: "patna", countryCode: "IN", name: "Fade House" };

function install({ own = OWN, items = [LISTING], fail } = {}) {
  apiFetch.mockImplementation(async (path) => {
    if (fail) throw fail;
    if (path.startsWith("salons/mine/")) return own;
    if (path.startsWith("salons?")) return { items, nextCursor: null };
    throw new Error(`unexpected ${path}`);
  });
}

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<ShopSharePanel salonId="s1" settingsHref="/dashboard/salons/s1/settings" />); });
  await flush();
  await flush();
  return r;
}
const button = (r, re) => r.root.findAll((n) => typeof n.type === "string" && n.type === "button" && re.test(collect(n.props.children)))[0];
const anchor = (r, re) => r.root.findAll((n) => n.type === "a" && re.test(collect(n.props.children)))[0];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  globalThis.window = { location: { origin: "https://fastque.com" } };
  globalThis.navigator = { clipboard: { writeText: jest.fn(async () => {}) } };
  globalThis.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
});
afterEach(() => { delete globalThis.window; delete globalThis.navigator; delete globalThis.document; });

describe("ShopSharePanel", () => {
  it("explains that a shop that is not open yet has no public page, and does not search the directory", async () => {
    install({ own: { ...OWN, status: "PENDING" } });
    const r = await mount();
    expect(text(r)).toContain("not open to the public yet");
    expect(text(r)).toContain("pending");
    expect(apiFetch.mock.calls.some(([p]) => p.startsWith("salons?"))).toBe(false);
    expect(r.root.findAll((n) => n.type === "a" && n.props.href === "/dashboard/salons/s1/settings")).toHaveLength(1);
  });

  it("does not invent a link when the open shop is missing from the directory", async () => {
    install({ items: [{ ...LISTING, id: "someone-else" }] });
    const r = await mount();
    expect(text(r)).toContain("not found in the directory");
    expect(r.root.findAll((n) => n.props && n.props.id === "share-link")).toHaveLength(0);
  });

  it("builds the public link from the directory listing and the current origin", async () => {
    install();
    const r = await mount();
    expect(r.root.findByProps({ id: "share-link" }).props.value).toBe("https://fastque.com/in/patna/fade-house");
    const search = apiFetch.mock.calls.find(([p]) => p.startsWith("salons?"))[0];
    expect(new URLSearchParams(search.split("?")[1]).get("q")).toBe("Fade House");
  });

  it("prefills an editable message and shows exactly what will be sent", async () => {
    install();
    const r = await mount();
    const area = r.root.findByProps({ id: "share-message" });
    expect(area.props.value).toContain("Fade House");
    await act(async () => { area.props.onChange({ target: { value: "Come visit us!" } }); });
    const preview = r.root.findByProps({ "data-testid": "share-preview" });
    expect(collect(preview.props.children)).toBe("Come visit us!\nhttps://fastque.com/in/patna/fade-house");
  });

  it("links WhatsApp, Facebook and email with the edited message and the public link", async () => {
    install();
    const r = await mount();
    await act(async () => { r.root.findByProps({ id: "share-message" }).props.onChange({ target: { value: "Hi & welcome" } }); });
    const wa = anchor(r, /WhatsApp/).props.href;
    expect(wa.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(wa.split("text=")[1])).toBe("Hi & welcome\nhttps://fastque.com/in/patna/fade-house");
    expect(anchor(r, /Facebook/).props.href).toContain(encodeURIComponent("https://fastque.com/in/patna/fade-house"));
    expect(anchor(r, /Email/).props.href.startsWith("mailto:?subject=")).toBe(true);
    expect(anchor(r, /WhatsApp/).props.rel).toContain("noopener");
  });

  it("says plainly that FastQue sends and posts nothing itself", async () => {
    install();
    const r = await mount();
    expect(text(r)).toContain("FastQue does not post or send anything for you");
  });

  it("copies the link and confirms only after the clipboard accepted it", async () => {
    install();
    const r = await mount();
    await act(async () => { await button(r, /Copy link/).props.onClick(); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://fastque.com/in/patna/fade-house");
    expect(text(r)).toContain("Link copied.");
  });

  it("does not claim success when the browser blocks copying", async () => {
    install();
    navigator.clipboard.writeText.mockRejectedValue(new Error("denied"));
    const r = await mount();
    await act(async () => { await button(r, /Copy link/).props.onClick(); });
    expect(text(r)).not.toContain("Link copied.");
    expect(text(r)).toContain("blocked copying");
  });

  it("reports a native share honestly: shared, copied fallback, cancelled (silent), unsupported", async () => {
    install();
    const r = await mount();
    for (const [result, expected] of [["shared", "Shared."], ["copied", "were copied instead"], ["unsupported", "Sharing is not available"]]) {
      shareOrCopy.mockResolvedValueOnce(result);
      await act(async () => { await button(r, /Share…/).props.onClick(); });
      expect(text(r)).toContain(expected);
    }
    shareOrCopy.mockResolvedValueOnce("cancelled");
    await act(async () => { await button(r, /Share…/).props.onClick(); });
    expect(text(r)).not.toContain("Shared.");
    expect(text(r)).not.toContain("were copied instead");
  });

  it("encodes the QR code with the public link and labels it", async () => {
    install();
    const r = await mount();
    const qr = r.root.findAll((n) => n.type === "svg" && n.props["data-qr"]);
    expect(qr[0].props["data-qr"]).toBe("https://fastque.com/in/patna/fade-house");
    expect(qr[0].props["aria-label"]).toContain("QR code");
  });

  it("shows an error with a retry when the shop cannot be loaded", async () => {
    install({ fail: new Error("offline") });
    const r = await mount();
    expect(text(r)).toContain("Could not load your shop's public link.");
    expect(button(r, /Try again/)).toBeTruthy();
  });
});
