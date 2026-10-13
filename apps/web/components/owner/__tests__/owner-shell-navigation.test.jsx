import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { Role } from "@barbercue/shared";
import { OwnerShell } from "../OwnerShell";
import { useAuth } from "../../../lib/auth-context";
import { apiFetch } from "../../../lib/api";

// Owner requirement: ordinary dashboard navigation never leaves the signed-in owner area. The logo and the
// Dashboard entry open the SELECTED shop's home, there is no public "Site" link, nothing sends an owner to
// the customer account area (which would bounce them to the customer login), and public pages open in a
// new tab so the dashboard session stays exactly where it was.

jest.mock("../../../lib/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../../lib/api", () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock("../../../lib/realtime", () => ({
  getRealtimeSocket: () => ({ on: jest.fn(), off: jest.fn(), connected: true }),
  joinSalonRoom: jest.fn(),
  onReconnect: () => () => {},
}));
jest.mock("../../dashboard/AdminManagingBanner", () => ({ AdminManagingBanner: () => null }));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...rest }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const replace = jest.fn();
const push = jest.fn();
let pathname = "/dashboard/salons/s1";
jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(""),
}));

const shop = (id, name, isOwner = true) => ({ id, publicId: `P-${id}`, slug: id, name, status: "ACTIVE", isOwner });

function installBrowserStubs() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.document = { addEventListener: () => {}, removeEventListener: () => {} };
  return store;
}

async function renderShell({ workplaces, roles = [Role.SALON_OWNER], user = { id: "u1", email: "owner@example.test", roles } }) {
  useAuth.mockReturnValue({ user, status: "authenticated", logout: jest.fn().mockResolvedValue(undefined) });
  apiFetch.mockImplementation((path) => {
    const p = String(path);
    if (p.includes("workplaces")) return Promise.resolve(workplaces);
    if (p.includes("capacity")) return Promise.resolve({ waitingCustomers: 2, currentServices: 1 });
    if (p.includes("unread-count")) return Promise.resolve({ count: 0 });
    return Promise.resolve({});
  });
  let tree;
  await act(async () => {
    tree = TestRenderer.create(
      <OwnerShell salonId="s1">
        <p>page body</p>
      </OwnerShell>,
    );
  });
  await act(async () => {});
  return tree;
}

const anchors = (tree) => tree.root.findAllByType("a");
const textOf = (node) => (typeof node === "string" ? node : (node.children ?? []).map(textOf).join(""));
const labelOf = (a) => textOf(a);
const hrefs = (tree) => anchors(tree).map((a) => a.props.href);

let store;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  store = installBrowserStubs();
  replace.mockClear();
  push.mockClear();
  pathname = "/dashboard/salons/s1";
});
afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

describe("owner shell navigation", () => {
  it("the logo is the Dashboard home of the SELECTED shop, not the shop list", async () => {
    const tree = await renderShell({ workplaces: [shop("s1", "Alpha"), shop("s2", "Beta")] });
    const logo = anchors(tree).find((a) => a.props["aria-label"] === "Dashboard home");
    expect(logo).toBeTruthy();
    expect(logo.props.href).toBe("/dashboard/salons/s1");
  });

  it("the Dashboard entry in the navigation opens the selected shop's home, and is current on that page", async () => {
    const tree = await renderShell({ workplaces: [shop("s1", "Alpha")] });
    const dashboard = anchors(tree).find((a) => labelOf(a).includes("Dashboard") && a.props.href === "/dashboard/salons/s1" && a.props["aria-current"] === "page");
    expect(dashboard).toBeTruthy();
  });

  it("has no public 'Site' link and no link to the public home page anywhere", async () => {
    const tree = await renderShell({ workplaces: [shop("s1", "Alpha")] });
    expect(hrefs(tree)).not.toContain("/");
    expect(anchors(tree).some((a) => labelOf(a).includes("Site"))).toBe(false);
    expect(JSON.stringify(tree.toJSON())).not.toContain("Visit the public");
  });

  it("never links into the customer account area (it would bounce an owner to the customer login)", async () => {
    const tree = await renderShell({ workplaces: [shop("s1", "Alpha")] });
    expect(hrefs(tree).filter((h) => String(h).startsWith("/account"))).toEqual([]);
    // the account menu too
    const avatar = tree.root.findAllByType("button").find((b) => b.props["aria-label"] === "Account menu");
    await act(async () => avatar.props.onClick());
    expect(hrefs(tree).filter((h) => String(h).startsWith("/account"))).toEqual([]);
  });

  it("opens public Help pages in a new tab, safely, so the dashboard stays where it is", async () => {
    const tree = await renderShell({ workplaces: [shop("s1", "Alpha")] });
    const avatar = tree.root.findAllByType("button").find((b) => b.props["aria-label"] === "Account menu");
    await act(async () => avatar.props.onClick());
    const help = anchors(tree).filter((a) => a.props.href === "/contact-us");
    expect(help.length).toBeGreaterThanOrEqual(2); // the sidebar entry and the account menu entry
    for (const link of help) {
      expect(link.props.target).toBe("_blank");
      expect(link.props.rel).toContain("noopener");
    }
  });

  it("the account menu offers Shop settings (owner), a shop switcher only when there is more than one shop, and Log out", async () => {
    const one = await renderShell({ workplaces: [shop("s1", "Alpha")] });
    await act(async () => one.root.findAllByType("button").find((b) => b.props["aria-label"] === "Account menu").props.onClick());
    expect(hrefs(one)).toContain("/dashboard/salons/s1/settings");
    expect(hrefs(one)).not.toContain("/dashboard/salons?select=1");

    const many = await renderShell({ workplaces: [shop("s1", "Alpha"), shop("s2", "Beta")] });
    await act(async () => many.root.findAllByType("button").find((b) => b.props["aria-label"] === "Account menu").props.onClick());
    expect(hrefs(many)).toContain("/dashboard/salons?select=1");
    const logout = many.root.findAllByType("button").filter((b) => textOf(b).includes("Log out"));
    expect(logout.length).toBeGreaterThanOrEqual(1);
  });

  it("remembers the shop being worked in - once the server confirms the user may operate it", async () => {
    await renderShell({ workplaces: [shop("s1", "Alpha")] });
    expect(JSON.parse(store.get("fastque.owner.lastShop.v1"))).toEqual({ u: "u1", s: "s1" });
  });

  it("does not remember, and sends the user to the shop picker, for a shop the server does not list for them", async () => {
    await renderShell({ workplaces: [shop("other", "Someone Else's")] });
    expect(store.has("fastque.owner.lastShop.v1")).toBe(false);
    expect(replace).toHaveBeenCalledWith("/dashboard/salons?select=1");
  });

  it("a platform admin managing a shop on someone's behalf is not bounced to the picker", async () => {
    await renderShell({ workplaces: [], roles: [Role.PLATFORM_ADMIN], user: { id: "admin1", email: "admin@example.test", roles: [Role.PLATFORM_ADMIN] } });
    expect(replace).not.toHaveBeenCalled();
  });

  it("a barber gets 'My day' as the home entry and the barber menu only", async () => {
    const tree = await renderShell({ workplaces: [shop("s1", "Alpha", false)], roles: [Role.SALON_STAFF], user: { id: "b1", email: "barber@example.test", roles: [Role.SALON_STAFF] } });
    expect(JSON.stringify(tree.toJSON())).toContain("My day");
    expect(hrefs(tree)).not.toContain("/dashboard/salons/s1/invoices");
    expect(hrefs(tree)).toContain("/dashboard/salons/s1");
  });

  it("the bottom bar's first entry (phones) is the Dashboard home too", async () => {
    const tree = await renderShell({ workplaces: [shop("s1", "Alpha")] });
    const bottom = tree.root.findAllByProps({ "aria-label": "Quick navigation" })[0];
    const first = bottom.findAllByType("a")[0];
    expect(first.props.href).toBe("/dashboard/salons/s1");
  });
});
