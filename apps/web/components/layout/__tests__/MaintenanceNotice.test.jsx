import React, { act } from "react";
import fs from "fs";
import path from "path";
import TestRenderer from "react-test-renderer";
import { MaintenanceNotice } from "../MaintenanceNotice";

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join("");
  return collect(node.children);
};

async function mount(variant, nowIso) {
  jest.spyOn(Date, "now").mockReturnValue(Date.parse(nowIso));
  let r;
  await act(async () => { r = TestRenderer.create(<MaintenanceNotice variant={variant} />); });
  return r;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("MaintenanceNotice", () => {
  it("shows the approved Oct 23 start and a hedged message before the window", async () => {
    const r = await mount("banner", "2026-10-22T08:00:00.000Z");
    const text = collect(r.toJSON());
    expect(text).toContain("Scheduled maintenance:");
    expect(text).toContain("Starting Friday, 23 October 2026, at 12:00 AM IST");
    expect(text).not.toContain("4:00 AM");
    expect(text).toContain("may be unavailable or slow");
    expect(text).toContain("Please complete any bookings and queue work before then.");
    const region = r.root.findByProps({ "data-testid": "maintenance-notice" });
    expect(region.props.role).toBe("region");
    expect(region.props["aria-label"]).toBe("Scheduled maintenance notice");
    await act(async () => r.unmount());
  });

  it("is still shown after the approved start", async () => {
    const r = await mount("banner", "2026-10-22T19:00:00.000Z");
    expect(collect(r.toJSON())).toContain("Starting Friday, 23 October 2026, at 12:00 AM IST");
    await act(async () => r.unmount());
  });

  it("does not invent an end time when none is approved", async () => {
    const r = await mount("banner", "2026-10-22T22:30:00.000Z");
    expect(collect(r.toJSON())).toContain("Scheduled maintenance:");
    await act(async () => r.unmount());
  });

  it("the header's spacer carries the same text, is hidden from assistive technology and is not a second visible notice", async () => {
    const r = await mount("spacer", "2026-10-22T08:00:00.000Z");
    const root = r.toJSON();
    expect(root.props["aria-hidden"]).toBe("true");
    expect(root.props.role).toBeUndefined();
    expect(collect(root)).toContain("Starting Friday, 23 October 2026, at 12:00 AM IST");
    expect(r.root.findAllByProps({ "data-testid": "maintenance-notice" })).toHaveLength(0);
    await act(async () => r.unmount());
  });

  it("the spacer remains while no end time is approved", async () => {
    const r = await mount("spacer", "2026-10-22T22:30:00.000Z");
    expect(r.toJSON()).not.toBeNull();
    await act(async () => r.unmount());
  });

  it("renders for the owner dashboard too", async () => {
    const r = await mount("inline", "2026-10-22T08:00:00.000Z");
    expect(collect(r.toJSON())).toContain("Scheduled maintenance:");
    expect(r.root.findAllByProps({ "data-testid": "maintenance-notice" }).length).toBeGreaterThan(0);
    await act(async () => r.unmount());
  });
});

// Every surface the owner named must carry the notice: the fixed site header (landing, customer pages, admin, login and
// registration, mobile) with its height-reserving spacer, and the owner dashboard, whose shell hides the site header.
describe("where the notice is placed", () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

  it("is the first thing inside the fixed site header, with a matching spacer after the header's own spacer", () => {
    const src = read("components/layout/SiteHeader.tsx");
    expect(src).toContain('import { MaintenanceNotice } from "./MaintenanceNotice";');
    expect(src).toMatch(/<header className=\{styles\.landingHeader\}>\n\s*<MaintenanceNotice \/>\n\s*<div className=\{styles\.hiringBar\}>/);
    expect(src).toMatch(/<div className=\{styles\.siteHeaderSpacer\} aria-hidden="true" \/>[\s\S]*<MaintenanceNotice variant="spacer" \/>/);
  });

  it("is rendered for every route through the root layout's SiteHeader", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain("<SiteHeader />");
  });

  it("sits at the top of the owner dashboard's content column", () => {
    const src = read("components/owner/OwnerShell.tsx");
    expect(src).toContain('import { MaintenanceNotice } from "../layout/MaintenanceNotice";');
    expect(src).toMatch(/<div id="owner-main"[^>]*>\n\s*<MaintenanceNotice variant="inline" \/>/);
  });

  it("only displays: it changes no maintenance mode, connection or request", () => {
    const src = read("components/layout/MaintenanceNotice.tsx") + read("lib/maintenance-notice.ts");
    expect(src).not.toMatch(/fetch\(|apiFetch|process\.env|localStorage|document\.cookie/);
  });
});
