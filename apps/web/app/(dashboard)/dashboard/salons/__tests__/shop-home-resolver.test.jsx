import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import SalonsDashboardHomePage from "../page";
import { useAuth } from "../../../../../lib/auth-context";
import { apiFetch } from "../../../../../lib/api";

// Owner requirement: LOGIN -> authorised shop selection -> OWNER DASHBOARD HOME. A single-shop owner is
// not stranded on a shop list, a multi-shop owner gets their last shop back, and the picker only
// appears when there is a real choice (or the user asked for it).

jest.mock("../../../../../lib/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../../../../lib/api", () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...rest }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: jest.fn() }) }));

const shop = (id, name, extra = {}) => ({ id, publicId: `P-${id}`, slug: id, name, status: "ACTIVE", isOwner: true, ...extra });

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

async function render({ shops, search = "", remembered = null, user = { id: "u1", email: "owner@example.test" } }) {
  globalThis.window = {
    location: { search },
    localStorage: storage(remembered ? { "fastque.owner.lastShop.v1": JSON.stringify({ u: user.id, s: remembered }) } : {}),
  };
  useAuth.mockReturnValue({ user, status: "authenticated", logout: jest.fn() });
  apiFetch.mockImplementation((path) => (String(path).includes("workplaces") ? Promise.resolve(shops) : Promise.resolve({})));
  let tree;
  await act(async () => {
    tree = TestRenderer.create(<SalonsDashboardHomePage />);
  });
  await act(async () => {});
  return tree;
}

const text = (tree) => JSON.stringify(tree.toJSON());

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  replace.mockClear();
  apiFetch.mockReset();
});
afterEach(() => {
  delete globalThis.window;
});

describe("Owner dashboard landing (shop home resolver)", () => {
  it("takes a single-shop owner straight to their shop's dashboard home, showing a loading state instead of a shop list", async () => {
    const tree = await render({ shops: [shop("s1", "Only Shop")] });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/dashboard/salons/s1");
    expect(text(tree)).toContain("Opening your shop");
    expect(text(tree)).not.toContain("Your shops");
  });

  it("restores a multi-shop owner's last shop when the server still lists it", async () => {
    await render({ shops: [shop("s1", "One"), shop("s2", "Two")], remembered: "s2" });
    expect(replace).toHaveBeenCalledWith("/dashboard/salons/s2");
  });

  it("shows the shop picker when a multi-shop owner has no valid last shop - with an 'Open dashboard' link per shop", async () => {
    const tree = await render({ shops: [shop("s1", "One"), shop("s2", "Two")], remembered: "a-shop-they-lost" });
    expect(replace).not.toHaveBeenCalled();
    const hrefs = tree.root.findAllByType("a").map((a) => a.props.href);
    expect(hrefs).toContain("/dashboard/salons/s1");
    expect(hrefs).toContain("/dashboard/salons/s2");
    const openLabels = tree.root.findAllByType("a").filter((a) => a.props["aria-label"]?.startsWith("Open the dashboard for"));
    expect(openLabels).toHaveLength(2);
  });

  it("never uses a remembered shop the server does not list (no unauthorised salon is ever chosen)", async () => {
    await render({ shops: [shop("s1", "One"), shop("s2", "Two")], remembered: "s9" });
    expect(replace).not.toHaveBeenCalledWith("/dashboard/salons/s9");
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows the picker on request (?select=1) even for a single-shop owner", async () => {
    const tree = await render({ shops: [shop("s1", "Only Shop")], search: "?select=1" });
    expect(replace).not.toHaveBeenCalled();
    expect(text(tree)).toContain("Your shops");
    expect(text(tree)).toContain("Only Shop");
  });

  it("keeps the registration path for a new owner with no shop yet", async () => {
    const tree = await render({ shops: [] });
    expect(replace).not.toHaveBeenCalled();
    expect(text(tree)).toContain("not part of a shop yet");
    expect(tree.root.findAllByType("a").map((a) => a.props.href)).toContain("/dashboard/register-shop");
  });

  it("a barber with one workplace goes straight to it as well", async () => {
    await render({ shops: [shop("s5", "Their Shop", { isOwner: false })], user: { id: "b1", email: "barber@example.test" } });
    expect(replace).toHaveBeenCalledWith("/dashboard/salons/s5");
  });

  it("does not redirect and shows the problem when the shop list cannot be loaded", async () => {
    globalThis.window = { location: { search: "" }, localStorage: storage() };
    useAuth.mockReturnValue({ user: { id: "u1", email: "o@example.test" }, status: "authenticated", logout: jest.fn() });
    apiFetch.mockRejectedValue(new Error("offline"));
    let tree;
    await act(async () => {
      tree = TestRenderer.create(<SalonsDashboardHomePage />);
    });
    await act(async () => {});
    expect(replace).not.toHaveBeenCalled();
    expect(text(tree)).toContain("Could not load your shops");
  });
});
