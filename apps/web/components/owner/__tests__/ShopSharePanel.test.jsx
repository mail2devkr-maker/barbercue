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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const READY = {
  salonId: "s1",
  status: "ACTIVE",
  publicPath: "/in/patna/fade-house",
  publicUrl: "https://fastque.com/in/patna/fade-house",
  readiness: { ready: true, reasons: [] },
  metadata: { title: "Fade House", description: null, imageUrl: null },
};

function install({ dto = READY, fail } = {}) {
  apiFetch.mockImplementation(async (path) => {
    if (fail) throw fail;
    if (path === "dashboard/salons/s1/share-links") return dto;
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
  it("explains that a shop that is not open yet has no public page, and shows no link", async () => {
    install({ dto: { ...READY, status: "PENDING", readiness: { ready: false, reasons: ["SALON_NOT_PUBLIC"] } } });
    const r = await mount();
    expect(text(r)).toContain("not open to the public yet");
    expect(r.root.findAll((n) => n.props && n.props.id === "share-link")).toHaveLength(0);
    expect(r.root.findAll((n) => n.type === "a" && n.props.href === "/dashboard/salons/s1/settings")).toHaveLength(1);
  });

  it("shows no link or QR when the server has no trusted public address", async () => {
    install({ dto: { ...READY, publicUrl: null, readiness: { ready: false, reasons: ["WEB_BASE_URL_NOT_CONFIGURED"] } } });
    const r = await mount();
    expect(text(r)).toContain("cannot show its public link");
    expect(r.root.findAll((n) => n.props && n.props.id === "share-link")).toHaveLength(0);
    expect(r.root.findAll((n) => n.type === "svg" && n.props["data-qr"])).toHaveLength(0);
  });

  it("uses the server's canonical URL, not the browser address, and does no directory search", async () => {
    globalThis.window = { location: { origin: "https://evil.example" } };
    install();
    const r = await mount();
    expect(r.root.findByProps({ id: "share-link" }).props.value).toBe("https://fastque.com/in/patna/fade-house");
    expect(apiFetch.mock.calls.map(([p]) => p)).toEqual(["dashboard/salons/s1/share-links"]);
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
  it("never displays the previous shop's public URL or QR while a new shop loads, even when the old response arrives last", async () => {
    const older = deferred();
    const newer = deferred();
    apiFetch.mockImplementation((path) => path.includes("/s1/") ? older.promise : newer.promise);
    let r;
    await act(async () => { r = TestRenderer.create(<ShopSharePanel salonId="s1" settingsHref="/settings/s1" />); });
    await flush();
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => { r.update(<ShopSharePanel salonId="s2" settingsHref="/settings/s2" />); });
    // Old links must never appear even before the new shop responds.
    expect(r.root.findAll((n) => n.props?.id === "share-link")).toHaveLength(0);
    await flush();
    expect(apiFetch).toHaveBeenCalledTimes(2);
    const nextUrl = "https://fastque.com/in/patna/new-shop";
    await act(async () => {
      newer.resolve({ ...READY, salonId: "s2", publicUrl: nextUrl, metadata: { ...READY.metadata, title: "New Shop" } });
      await newer.promise;
    });
    expect(r.root.findByProps({ id: "share-link" }).props.value).toBe(nextUrl);

    await act(async () => { older.resolve(READY); await older.promise; });
    expect(r.root.findByProps({ id: "share-link" }).props.value).toBe(nextUrl);
    const qr = r.root.findAll((n) => n.type === "svg" && n.props["data-qr"]);
    expect(qr[0].props["data-qr"]).toBe(nextUrl);
    expect(r.root.findByProps({ id: "share-message" }).props.value).toContain("New Shop");
    expect(r.root.findByProps({ id: "share-message" }).props.value).not.toContain("Fade House");
  });

  it("clears a previous shop's customized invitation text and feedback when navigating to another shop", async () => {
    const nextUrl = "https://fastque.com/in/patna/new-shop";
    apiFetch.mockImplementation(async (path) => path.includes("/s1/")
      ? READY
      : { ...READY, salonId: "s2", publicUrl: nextUrl, metadata: { ...READY.metadata, title: "New Shop" } });
    const r = await mount();
    await act(async () => { r.root.findByProps({ id: "share-message" }).props.onChange({ target: { value: "Exclusive Fade House invitation" } }); });
    await act(async () => { await button(r, /Copy link/).props.onClick(); });
    expect(text(r)).toContain("Link copied.");

    await act(async () => { r.update(<ShopSharePanel salonId="s2" settingsHref="/settings/s2" />); });
    await flush();
    expect(r.root.findByProps({ id: "share-link" }).props.value).toBe(nextUrl);
    expect(r.root.findByProps({ id: "share-message" }).props.value).toContain("New Shop");
    expect(r.root.findByProps({ id: "share-message" }).props.value).not.toContain("Exclusive Fade House");
    expect(text(r)).not.toContain("Link copied.");
  });

  it("ignores a late error from a previous salon instead of replacing the new salon's working share links", async () => {
    const older = deferred();
    apiFetch.mockImplementation((path) => path.includes("/s1/") ? older.promise : Promise.resolve({
      ...READY, salonId: "s2", publicUrl: "https://fastque.com/in/patna/new-shop",
    }));
    let r;
    await act(async () => { r = TestRenderer.create(<ShopSharePanel salonId="s1" settingsHref="/settings/s1" />); });
    await flush();
    await act(async () => { r.update(<ShopSharePanel salonId="s2" settingsHref="/settings/s2" />); });
    await flush();
    expect(r.root.findByProps({ id: "share-link" }).props.value).toBe("https://fastque.com/in/patna/new-shop");
    await act(async () => { older.reject(new Error("stale shop offline")); try { await older.promise; } catch {} });
    expect(r.root.findByProps({ id: "share-link" }).props.value).toBe("https://fastque.com/in/patna/new-shop");
    expect(text(r)).not.toContain("Could not load your shop's public link.");
  });

});
