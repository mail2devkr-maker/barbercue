// Pure logic only (PR #246 contract). The provider is not configured, so "not available" is the expected honest answer.
import * as D from "../description-assistant";

describe("parseHighlights", () => {
  it("reads one fact per line and drops blank lines", () => {
    expect(D.parseHighlights("  Open since 2012 \n\nWedding packages\r\n")).toEqual({ highlights: ["Open since 2012", "Wedding packages"], error: null });
    expect(D.parseHighlights("")).toEqual({ highlights: [], error: null });
  });
  it("refuses too many facts or a too-long fact instead of cutting text off", () => {
    expect(D.parseHighlights("1\n2\n3\n4\n5\n6").error).toContain("at most 5");
    expect(D.parseHighlights("ok\n" + "x".repeat(121)).error).toContain("Fact 2 is too long");
    expect(D.parseHighlights("x".repeat(120)).error).toBeNull();
    expect(D.parseHighlights("1\n2\n3\n4\n5").error).toBeNull();
  });
});

describe("request and answer", () => {
  it("sends only language, tone and the owner's own facts (never shop details)", () => {
    expect(D.buildRequest("hi", "premium", ["a"])).toEqual({ language: "hi", tone: "premium", ownerAttestedHighlights: ["a"] });
  });
  it("accepts only the offered languages and tones", () => {
    expect(D.isLanguage("en")).toBe(true);
    expect(D.isLanguage("fr")).toBe(false);
    expect(D.isTone("friendly")).toBe(true);
    expect(D.isTone("pushy")).toBe(false);
    expect(D.LANGUAGES.map((l) => l.value)).toEqual(["en", "hi"]);
    expect(D.TONES.map((t) => t.value)).toEqual(["professional", "friendly", "premium"]);
  });
  it("reads a usable draft and nothing else", () => {
    expect(D.parseSuggestion({ draft: "Text", language: "en", persisted: false, requiresOwnerReview: true, notice: "Review it." })).toEqual({ draft: "Text", notice: "Review it." });
    expect(D.parseSuggestion({ draft: "Text" })).toEqual({ draft: "Text", notice: null });
    for (const bad of [null, undefined, "x", [], {}, { draft: "" }, { draft: "  " }, { draft: 5 }]) expect(D.parseSuggestion(bad)).toBeNull();
  });
});

describe("describeLength", () => {
  it("compares against the server's draft range", () => {
    expect(D.describeLength("").state).toBe("short");
    expect(D.describeLength("x".repeat(40))).toMatchObject({ state: "short" });
    expect(D.describeLength("x".repeat(80))).toEqual({ state: "ok", message: "80 characters." });
    expect(D.describeLength("x".repeat(600)).state).toBe("ok");
    expect(D.describeLength("x".repeat(601)).state).toBe("long");
  });
});

describe("describeFailure", () => {
  it("says AI writing is not available when the provider is not configured, and offers manual writing", () => {
    const f = D.describeFailure(503, "SALON_DESCRIPTION_PROVIDER_NOT_CONFIGURED", "raw");
    expect(f.kind).toBe("UNAVAILABLE");
    expect(f.message).toContain("not available yet");
    expect(f.message).toContain("write your description yourself");
    expect(D.describeFailure(503, undefined, "raw").kind).toBe("UNAVAILABLE");
  });
  it("explains the rate limit with the real numbers", () => {
    const f = D.describeFailure(429, "THROTTLED", "raw");
    expect(f.kind).toBe("RATE_LIMITED");
    expect(f.message).toContain("3 drafts every 10 minutes");
  });
  it("treats a timeout or a failed generation as try-again, and says nothing was changed", () => {
    for (const [s, c] of [[504, "SALON_DESCRIPTION_PROVIDER_TIMEOUT"], [503, "SALON_DESCRIPTION_PROVIDER_TIMEOUT"], [502, "SALON_DESCRIPTION_GENERATION_FAILED"], [502, "SALON_DESCRIPTION_INVALID_PROVIDER_RESPONSE"]]) {
      const f = D.describeFailure(s, c, "raw");
      expect(f.kind).toBe("TRY_LATER");
      expect(f.message).toContain("Nothing was changed");
    }
  });
  it("keeps the server's message for anything else", () => {
    expect(D.describeFailure(403, "FORBIDDEN", "Not your shop.")).toEqual({ kind: "REJECTED", message: "Not your shop." });
    expect(D.describeFailure(400, "SALON_DESCRIPTION_INPUT_TOO_LARGE", "x").message).toMatch(/write your description yourself/i);
  });
});
