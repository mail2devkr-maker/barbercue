// Visitor Intelligence tracker: consent gating, internal-page exclusion, batching and search mapping.
// Node environment with a minimal window/document stub (no browser needed).
function memStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), clear: () => map.clear() };
}

const sent = [];
beforeAll(() => {
  let n = 0;
  global.window = {
    localStorage: memStore(),
    sessionStorage: memStore(),
    location: { pathname: "/search", search: "?utm_source=instagram&utm_medium=social&fq_c=demo-1" },
    screen: { width: 390 },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` },
    setTimeout: (fn) => { global.__pending = fn; return 1; },
    clearTimeout: () => {},
    addEventListener: () => {},
    dispatchEvent: () => {},
  };
  global.document = { cookie: "", referrer: "https://l.instagram.com/", visibilityState: "visible", addEventListener: () => {}, head: { appendChild: () => {} } };
  global.navigator = { language: "en-IN" };
  global.fetch = (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true }); };
});

const load = () => require("../visitor-intel/tracker");
const consent = () => require("../visitor-intel/consent");

describe("visitor intelligence tracker", () => {
  beforeEach(() => {
    sent.length = 0;
    window.localStorage.clear();
    window.sessionStorage.clear();
    load().__resetViTrackerForTests();
  });

  it("records nothing before the visitor chooses, or after they reject", () => {
    const t = load();
    t.viTrack("page_view");
    expect(t.__pendingViEvents()).toHaveLength(0);
    consent().saveConsent(false, false, t.visitorId(), "BANNER");
    t.viTrack("page_view");
    expect(t.__pendingViEvents()).toHaveLength(0);
    // The choice itself is recorded with only a pseudonymous id.
    expect(sent[0].url).toBe("/api/v1/visitor-intel/consent");
    expect(Object.keys(sent[0].body).sort()).toEqual(["analytics", "marketing", "policyVersion", "source", "visitorId"]);
  });

  it("never tracks internal dashboards", () => {
    const t = load();
    expect(t.isTrackablePath("/dashboard/admin/visitor-intelligence")).toBe(false);
    expect(t.isTrackablePath("/employee/activity")).toBe(false);
    expect(t.isTrackablePath("/search?service=haircut")).toBe(true);
    expect(t.isTrackablePath("/owner/register")).toBe(true);
  });

  it("batches events with session attribution after consent", () => {
    const t = load();
    consent().saveConsent(true, false, t.visitorId(), "BANNER");
    sent.length = 0;
    t.viTrack("page_view");
    t.viTrackSearchFromParams(new URLSearchParams("service=Hair%20cut&city=indore&priceMax=500&minRating=4"), 0);
    expect(t.__pendingViEvents()).toHaveLength(2);
    global.__pending();
    expect(sent).toHaveLength(1);
    const body = sent[0].body;
    expect(body.consent).toEqual({ analytics: true, marketing: false });
    expect(body.context).toMatchObject({ utmSource: "instagram", utmMedium: "social", campaignCode: "demo-1", referrer: "https://l.instagram.com/", landingPath: "/search" });
    const search = body.events[1];
    expect(search.type).toBe("search");
    expect(search.props).toMatchObject({ query: "Hair cut", city: "Indore", resultCount: 0, priceMax: 500, minRating: 4 });
    // Same session for both events, each with its own dedupe id.
    expect(new Set(body.events.map((e) => e.id)).size).toBe(2);
  });
});
