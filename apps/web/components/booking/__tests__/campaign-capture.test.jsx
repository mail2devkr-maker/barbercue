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
function setUrl(path, search) {
  mockPath = path;
  globalThis.window = { location: { search }, sessionStorage: store };
}
async function mount(props = {}) {
  await act(async () => { TestRenderer.create(<CampaignCapture {...props} />); });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  store = fakeStore();
});
afterEach(() => { delete globalThis.window; });

describe("CampaignCapture", () => {
  it("remembers the code from a public shop link for that shop", async () => {
    setUrl("/in/patna/fade-house", `?fq_campaign=${TOKEN}`);
    await mount();
    expect(recallCampaign(store, "in/patna/fade-house")).toBe(TOKEN);
  });

  it("uses the shop key it is given on the booking page", async () => {
    setUrl("/book/fade-house", `?city=patna&country=in&fq_campaign=${TOKEN}`);
    await mount({ salonKey: "in/patna/fade-house" });
    expect(recallCampaign(store, "in/patna/fade-house")).toBe(TOKEN);
  });

  it("does nothing without a code, or with a badly shaped one", async () => {
    setUrl("/in/patna/fade-house", "");
    await mount();
    setUrl("/in/patna/fade-house", "?fq_campaign=short");
    await mount();
    expect(store.map.size).toBe(0);
  });

  it("does not guess a shop on a page that is not a shop page", async () => {
    setUrl("/", `?fq_campaign=${TOKEN}`);
    await mount();
    setUrl("/book/fade-house", `?fq_campaign=${TOKEN}`);
    await mount();
    expect(store.map.size).toBe(0);
  });

  it("renders nothing and survives blocked storage", async () => {
    globalThis.window = { location: { search: `?fq_campaign=${TOKEN}` }, get sessionStorage() { throw new Error("blocked"); } };
    mockPath = "/in/patna/fade-house";
    let tree;
    await act(async () => { tree = TestRenderer.create(<CampaignCapture />); });
    expect(tree.toJSON()).toBeNull();
  });
});
