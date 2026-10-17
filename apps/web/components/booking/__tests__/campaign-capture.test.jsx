import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { CampaignCapture } from "../CampaignCapture";
import { recallCampaign } from "../../../lib/campaign-token";

let mockPath = "/in/patna/fade-house";
jest.mock("next/navigation", () => ({ usePathname: () => mockPath }));

const TOKEN = "oLeUkicJNsEw6HKmYc_xP3uXRdJ-oxESwdPlmlErmuM";

function fakeStore() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, v); }, removeItem: (k) => { map.delete(k); } };
}

let store;
const mounted = [];

function setUrl(path, search) {
  mockPath = path;
  globalThis.window = { location: { search }, sessionStorage: store };
}

// The effect is synchronous, so a synchronous act() flushes it deterministically (no timers or microtask races).
function mount(props = {}) {
  let tree;
  act(() => { tree = TestRenderer.create(<CampaignCapture {...props} />); });
  mounted.push(tree);
  return tree;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  store = fakeStore();
});

afterEach(() => {
  // Trees are unmounted before the fake window goes away, so nothing can run against a missing window.
  while (mounted.length) {
    const tree = mounted.pop();
    act(() => tree.unmount());
  }
  delete globalThis.window;
});

describe("CampaignCapture", () => {
  it("remembers the code from a public shop link for that shop", () => {
    setUrl("/in/patna/fade-house", `?fq_campaign=${TOKEN}`);
    mount();
    expect(recallCampaign(store, "in/patna/fade-house")).toBe(TOKEN);
  });

  it("uses the shop key it is given on the booking page", () => {
    setUrl("/book/fade-house", `?city=patna&country=in&fq_campaign=${TOKEN}`);
    mount({ salonKey: "in/patna/fade-house" });
    expect(recallCampaign(store, "in/patna/fade-house")).toBe(TOKEN);
  });

  it("does nothing without a code, or with a badly shaped one", () => {
    setUrl("/in/patna/fade-house", "");
    mount();
    setUrl("/in/patna/fade-house", "?fq_campaign=short");
    mount();
    expect(store.map.size).toBe(0);
  });

  it("does not guess a shop on a page that is not a shop page", () => {
    setUrl("/", `?fq_campaign=${TOKEN}`);
    mount();
    setUrl("/book/fade-house", `?fq_campaign=${TOKEN}`);
    mount();
    expect(store.map.size).toBe(0);
  });

  it("renders nothing and survives blocked storage", () => {
    globalThis.window = { location: { search: `?fq_campaign=${TOKEN}` }, get sessionStorage() { throw new Error("blocked"); } };
    mockPath = "/in/patna/fade-house";
    const tree = mount();
    expect(tree.toJSON()).toBeNull();
  });
});
