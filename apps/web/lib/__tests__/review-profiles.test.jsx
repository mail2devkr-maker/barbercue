// Owner review sources and outside profile links (Codex PR #261 contract EXTERNAL_REVIEW_PROFILES_V1).
import * as R from "../review-profiles";

const SOURCES = [
  { source: "FASTQUE", state: "CONNECTED", profileUrl: null },
  { source: "GOOGLE", state: "LINK_ONLY", profileUrl: "https://g.page/example" },
  { source: "FACEBOOK", state: "UNAVAILABLE", profileUrl: null },
  { source: "INSTAGRAM", state: "UNAVAILABLE", profileUrl: null },
];

describe("parseSources", () => {
  it("reads the server list and drops rows it does not know", () => {
    expect(R.parseSources(SOURCES)).toEqual(SOURCES);
    expect(R.parseSources([{ source: "TWITTER", state: "LINK_ONLY" }, { source: "GOOGLE", state: "WEIRD" }, null, { source: "GOOGLE", state: "LINK_ONLY", profileUrl: " " }])).toEqual([
      { source: "GOOGLE", state: "LINK_ONLY", profileUrl: null },
    ]);
  });
  it("returns null when the server reports no sources", () => {
    for (const raw of [undefined, null, {}, "x"]) expect(R.parseSources(raw)).toBeNull();
  });
});

describe("words", () => {
  it("labels sources and states", () => {
    expect(R.sourceLabel("FASTQUE")).toBe("FastQue");
    expect(R.sourceLabel("GOOGLE")).toBe("Google");
    expect(R.stateText("LINK_ONLY")).toBe("Link only");
    expect(R.stateText("UNAVAILABLE")).toBe("No link added");
    expect(R.stateText("CONNECTED")).toBe("Reviews shown here");
  });
  it("says outside reviews are never fetched, with or without a link", () => {
    expect(R.externalSourceNote("Google", true)).toContain("does not fetch, count or show reviews");
    expect(R.externalSourceNote("Google", false)).toContain("have not added");
  });
});

describe("checkProfileUrl", () => {
  const google = R.PROVIDERS[0];
  const instagram = R.PROVIDERS[2];
  it("accepts an https link from the right site and returns it as the server stores it", () => {
    expect(R.checkProfileUrl(google, " https://g.page/example ").url).toBe("https://g.page/example");
    expect(R.checkProfileUrl(instagram, "https://www.instagram.com/shop").url).toBe("https://www.instagram.com/shop");
  });
  it("treats an empty box as no link", () => {
    expect(R.checkProfileUrl(google, "  ")).toEqual({ url: null, error: null });
  });
  it("refuses http, another site, credentials, tokens and a redirecting Google path", () => {
    for (const bad of ["http://g.page/x", "https://evil.example/x", "https://user:pw@g.page/x", "https://g.page/x?token=1", "https://www.google.com/url?q=https://evil.example", "https://g.page:8443/x", "g.page/x"]) {
      expect(R.checkProfileUrl(google, bad).error).toBeTruthy();
    }
    expect(R.checkProfileUrl(google, "https://www.google.com/maps/place/x").error).toBeNull();
    expect(R.checkProfileUrl(instagram, "https://g.page/x").error).toContain("Instagram");
  });
  it("refuses a link over 500 characters", () => {
    expect(R.checkProfileUrl(google, `https://g.page/${"a".repeat(500)}`).error).toContain("500");
  });
});

describe("buildProfileUpdate", () => {
  it("sends nothing when nothing changed", () => {
    expect(R.buildProfileUpdate(SOURCES, R.formFromSources(SOURCES))).toEqual({ body: null, errors: {} });
  });
  it("sends only the links that changed, and null for a cleared one", () => {
    const form = { ...R.formFromSources(SOURCES), googleUrl: "", facebookUrl: "https://www.facebook.com/shop" };
    expect(R.buildProfileUpdate(SOURCES, form).body).toEqual({ googleUrl: null, facebookUrl: "https://www.facebook.com/shop" });
  });
  it("does not send an empty box that was already empty", () => {
    const form = { ...R.formFromSources(SOURCES), instagramUrl: "" };
    expect(R.buildProfileUpdate(SOURCES, form).body).toBeNull();
  });
  it("names the box with a bad link and sends nothing", () => {
    const form = { ...R.formFromSources(SOURCES), facebookUrl: "https://evil.example/x" };
    const r = R.buildProfileUpdate(SOURCES, form);
    expect(r.body).toBeNull();
    expect(r.errors.facebookUrl).toContain("Facebook");
  });
  it("works without a server source list", () => {
    expect(R.buildProfileUpdate(null, { googleUrl: "https://g.page/x", facebookUrl: "", instagramUrl: "" }).body).toEqual({ googleUrl: "https://g.page/x" });
  });
});

describe("error words", () => {
  it("explains the server's refusals", () => {
    expect(R.reviewProfileErrorText("INVALID_REVIEW_SOURCE", "m")).toContain("not supported");
    expect(R.reviewProfileErrorText("VALIDATION_ERROR", "m")).toContain("https://");
    expect(R.reviewProfileErrorText("X", "as sent")).toBe("as sent");
  });
});
