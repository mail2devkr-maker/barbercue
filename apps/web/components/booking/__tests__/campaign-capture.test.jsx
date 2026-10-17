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

let replaced;
function setUrl(path, search, hash = "") {
  mockPath = path;
  replaced = [];
  globalThis.window = {
    location: { pathname: path, search, hash },
    history: { state: { marker: 1 }, replaceState: (...args) => { replaced.push(args); } },
    sessionStorage: store,
  };
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

  it("removes the code from the address once it is remembered, keeping other parameters and the hash", () => {
    setUrl("/in/patna/fade-house", `?utm=a&fq_campaign=${TOKEN}`, "#reviews");
    mount();
    expect(replaced).toEqual([[{ marker: 1 }, "", "/in/patna/fade-house?utm=a#reviews"]]);
  });

  it("leaves a plain address plain when the code was the only parameter", () => {
    setUrl("/in/patna/fade-house", `?fq_campaign=${TOKEN}`);
    mount();
    expect(replaced[0][2]).toBe("/in/patna/fade-house");
  });

  it("leaves the address alone when the code could not be remembered", () => {
    setUrl("/in/patna/fade-house", `?fq_campaign=${TOKEN}`);
    globalThis.window.sessionStorage = { getItem: () => null, setItem() { throw new Error("full"); }, removeItem() {} };
    mount();
    expect(replaced).toEqual([]);
  });

  it("does not touch the address for a badly shaped code", () => {
    setUrl("/in/patna/fade-house", "?fq_campaign=short");
    mount();
    expect(replaced).toEqual([]);
  });

  it("still remembers the code if the browser refuses to change the address", () => {
    setUrl("/in/patna/fade-house", `?fq_campaign=${TOKEN}`);
    globalThis.window.history.replaceState = () => { throw new Error("blocked"); };
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
