// Pure logic and a fake session store. The server alone validates a token; the browser only carries a well-shaped one for
// the same shop for a short time (decision on issue #221).
import * as C from "../campaign-token";

const TOKEN = "oLeUkicJNsEw6HKmYc_xP3uXRdJ-oxESwdPlmlErmuM"; // 43 base64url characters, the server's shape
const OTHER = "A".repeat(43);

function fakeStore() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe("parseCampaignParam", () => {
  it("accepts a token of the server's shape and ignores everything else in the query", () => {
    expect(C.parseCampaignParam(`?fq_campaign=${TOKEN}`)).toBe(TOKEN);
    expect(C.parseCampaignParam(`?utm=x&fq_campaign=${TOKEN}&city=patna`)).toBe(TOKEN);
  });
  it("rejects a missing, short, long or oddly-shaped value so nothing unbounded is stored or sent", () => {
    for (const bad of ["", "?x=1", "?fq_campaign=", "?fq_campaign=short", `?fq_campaign=${"a".repeat(39)}`, `?fq_campaign=${"a".repeat(129)}`, `?fq_campaign=${TOKEN}%20x`, "?fq_campaign=<script>alert(1)</script>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "?fq_campaign=a b"]) {
      expect(C.parseCampaignParam(bad)).toBeNull();
    }
    expect(C.parseCampaignParam(`?fq_campaign=${"a".repeat(40)}`)).not.toBeNull();
    expect(C.parseCampaignParam(`?fq_campaign=${"a".repeat(128)}`)).not.toBeNull();
  });
  it("never reads a client-asserted source as attribution", () => {
    expect(C.parseCampaignParam("?source=FACEBOOK")).toBeNull();
    expect(C.parseCampaignParam("?campaign=FACEBOOK")).toBeNull();
  });
});

describe("shop keys", () => {
  it("normalises case so the public page and the booking page agree", () => {
    expect(C.salonKey("IN", "Patna", "Fade-House")).toBe("in/patna/fade-house");
  });
  it("reads the shop from a public shop path only", () => {
    expect(C.salonKeyFromPublicPath("/in/patna/fade-house")).toBe("in/patna/fade-house");
    expect(C.salonKeyFromPublicPath("/IN/patna/fade-house/")).toBe("in/patna/fade-house");
    for (const other of ["/", "/in", "/in/patna", "/in/patna/fade-house/extra", "/book/fade-house", "/account/bookings", "/india/patna/fade-house", "/dashboard/salons/abc"]) {
      expect(C.salonKeyFromPublicPath(other)).toBeNull();
    }
  });
  it("survives a malformed escape in the path", () => {
    expect(C.salonKeyFromPublicPath("/in/pa%E0%A4%A/fade")).toBeNull();
  });
});

describe("remember / recall / forget", () => {
  const key = "in/patna/fade-house";
  it("remembers a token for one shop and returns it", () => {
    const store = fakeStore();
    C.rememberCampaign(store, key, TOKEN, 1000);
    expect(C.recallCampaign(store, key, 2000)).toBe(TOKEN);
  });
  it("never gives one shop's token to another", () => {
    const store = fakeStore();
    C.rememberCampaign(store, key, TOKEN, 1000);
    expect(C.recallCampaign(store, "in/patna/other-shop", 2000)).toBeNull();
    expect(C.recallCampaign(store, "in/delhi/fade-house", 2000)).toBeNull();
  });
  it("forgets a token after the short time-to-live, and removes it", () => {
    const store = fakeStore();
    C.rememberCampaign(store, key, TOKEN, 1000);
    expect(C.recallCampaign(store, key, 1000 + C.CAMPAIGN_TTL_MS)).toBe(TOKEN);
    expect(C.recallCampaign(store, key, 1000 + C.CAMPAIGN_TTL_MS + 1)).toBeNull();
    expect(store.map.size).toBe(0);
  });
  it("a newer link for the same shop replaces the older token", () => {
    const store = fakeStore();
    C.rememberCampaign(store, key, TOKEN, 1000);
    C.rememberCampaign(store, key, OTHER, 2000);
    expect(C.recallCampaign(store, key, 3000)).toBe(OTHER);
  });
  it("does not store a badly shaped token", () => {
    const store = fakeStore();
    C.rememberCampaign(store, key, "short", 1000);
    expect(store.map.size).toBe(0);
  });
  it("ignores a stored value that was tampered with or is not a token record", () => {
    const store = fakeStore();
    for (const raw of ["not json", "null", "5", JSON.stringify({ token: 5, at: 1 }), JSON.stringify({ token: "short", at: 1 }), JSON.stringify({ token: TOKEN }), JSON.stringify({ token: TOKEN, at: "now" }), JSON.stringify({ token: TOKEN, at: 10 ** 15 })]) {
      store.setItem(`fq:campaign:${key}`, raw);
      expect(C.recallCampaign(store, key, 1000)).toBeNull();
    }
  });
  it("forgets on request", () => {
    const store = fakeStore();
    C.rememberCampaign(store, key, TOKEN, 1000);
    C.forgetCampaign(store, key);
    expect(C.recallCampaign(store, key, 1500)).toBeNull();
  });
  it("copes with storage that is missing or throws", () => {
    const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("blocked"); } };
    expect(() => C.rememberCampaign(null, key, TOKEN)).not.toThrow();
    expect(() => C.rememberCampaign(throwing, key, TOKEN)).not.toThrow();
    expect(C.recallCampaign(null, key)).toBeNull();
    expect(C.recallCampaign(throwing, key)).toBeNull();
    expect(() => C.forgetCampaign(throwing, key)).not.toThrow();
    expect(() => C.forgetCampaign(null, key)).not.toThrow();
  });
});

describe("sessionTokenStore", () => {
  afterEach(() => { delete globalThis.window; });
  it("is null on the server render", () => {
    expect(C.sessionTokenStore()).toBeNull();
  });
  it("is the tab's session storage when the browser provides it", () => {
    const sessionStorage = fakeStore();
    globalThis.window = { sessionStorage };
    expect(C.sessionTokenStore()).toBe(sessionStorage);
  });
  it("is null when the browser blocks storage", () => {
    globalThis.window = { get sessionStorage() { throw new Error("blocked"); } };
    expect(C.sessionTokenStore()).toBeNull();
  });
});
