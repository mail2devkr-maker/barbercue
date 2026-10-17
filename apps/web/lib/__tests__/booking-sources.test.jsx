// Pure logic only: no browser, no network. Figures come from the server (PR #230).
import * as S from "../booking-sources";

describe("labels", () => {
  it("uses the owner's words for every server source and shows an unknown one as sent", () => {
    expect(S.sourceLabel("FASTQUE_APP")).toBe("FastQue app");
    expect(S.sourceLabel("FASTQUE_WEB")).toBe("FastQue website");
    expect(S.sourceLabel("WALK_IN")).toBe("Live Queue");
    expect(S.sourceLabel("IN_SHOP")).toBe("In-shop appointment");
    expect(S.sourceLabel("UNKNOWN")).toBe("Not recorded");
    expect(S.sourceLabel("TIKTOK")).toBe("TIKTOK");
  });
  it("offers only the four campaign sources the server accepts", () => {
    expect(S.CAMPAIGN_SOURCES.map((s) => s.value)).toEqual(["FACEBOOK", "INSTAGRAM", "CHATGPT", "OTHER"]);
    expect(S.isCampaignSource("FACEBOOK")).toBe(true);
    expect(S.isCampaignSource("FASTQUE_APP")).toBe(false);
    expect(S.isCampaignSource("")).toBe(false);
  });
});

describe("validateCampaignForm", () => {
  const ok = { source: "INSTAGRAM", label: "Bio link", firstDay: "", lastDay: "" };
  it("accepts a name and a source, with no dates", () => {
    expect(S.validateCampaignForm(ok)).toEqual({});
  });
  it("asks for a name and trims it", () => {
    expect(S.validateCampaignForm({ ...ok, label: "   " }).label).toBeTruthy();
    expect(S.validateCampaignForm({ ...ok, label: "x".repeat(121) }).label).toContain("120");
    expect(S.validateCampaignForm({ ...ok, label: "x".repeat(120) })).toEqual({});
  });
  it("rejects an unknown source, a non-date and a last day before the first", () => {
    expect(S.validateCampaignForm({ ...ok, source: "TIKTOK" }).source).toBeTruthy();
    expect(S.validateCampaignForm({ ...ok, firstDay: "2026-02-30" }).firstDay).toBeTruthy();
    expect(S.validateCampaignForm({ ...ok, firstDay: "2026-10-10", lastDay: "2026-10-09" }).lastDay).toContain("on or after");
    expect(S.validateCampaignForm({ ...ok, firstDay: "2026-10-10", lastDay: "2026-10-10" })).toEqual({});
  });
});

describe("shop-local days", () => {
  it("finds when a shop day begins in its own timezone", () => {
    expect(S.startOfZonedDay("2026-10-12", "Asia/Kolkata")).toBe("2026-10-11T18:30:00.000Z");
    expect(S.startOfZonedDay("2026-10-12", "UTC")).toBe("2026-10-12T00:00:00.000Z");
    expect(S.startOfZonedDay("2026-10-12", "America/New_York")).toBe("2026-10-12T04:00:00.000Z"); // EDT
    expect(S.startOfZonedDay("2026-12-12", "America/New_York")).toBe("2026-12-12T05:00:00.000Z"); // EST
  });
  it("includes the last day by ending the window when the next shop day begins", () => {
    const body = S.toCreateBody({ source: "FACEBOOK", label: "  Diwali  ", firstDay: "2026-10-12", lastDay: "2026-10-31" }, "Asia/Kolkata");
    expect(body).toEqual({ source: "FACEBOOK", label: "Diwali", startsAt: "2026-10-11T18:30:00.000Z", endsAt: "2026-10-31T18:30:00.000Z" });
    expect(Date.parse(body.endsAt)).toBeGreaterThan(Date.parse(body.startsAt));
  });
  it("sends no dates when none are chosen", () => {
    expect(S.toCreateBody({ source: "OTHER", label: "QR poster", firstDay: "", lastDay: "" }, "Asia/Kolkata")).toEqual({ source: "OTHER", label: "QR poster" });
  });
});

describe("campaignStatus", () => {
  const now = new Date("2026-10-15T12:00:00.000Z");
  const c = (over) => ({ revokedAt: null, startsAt: null, endsAt: null, ...over });
  it("reads the campaign's window against the current time", () => {
    expect(S.campaignStatus(c({}), now)).toBe("ACTIVE");
    expect(S.campaignStatus(c({ startsAt: "2026-10-20T00:00:00.000Z" }), now)).toBe("SCHEDULED");
    expect(S.campaignStatus(c({ endsAt: "2026-10-15T12:00:00.000Z" }), now)).toBe("ENDED");
    expect(S.campaignStatus(c({ startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-10-31T00:00:00.000Z" }), now)).toBe("ACTIVE");
  });
  it("a turned-off campaign stays turned off whatever its dates", () => {
    expect(S.campaignStatus(c({ revokedAt: "2026-10-01T00:00:00.000Z" }), now)).toBe("REVOKED");
  });
});

describe("campaign link", () => {
  const TOKEN = "oLeUkicJNsEw6HKmYc_xP3uXRdJ-oxESwdPlmlErmuM";
  it("uses the canonical URL only when the server says the shop is ready and it is an http(s) address", () => {
    expect(S.canonicalBaseUrl({ publicUrl: "https://fastque.com/in/patna/fade-house", readiness: { ready: true } })).toBe("https://fastque.com/in/patna/fade-house");
    expect(S.canonicalBaseUrl({ publicUrl: "https://fastque.com/in/patna/fade-house", readiness: { ready: false } })).toBeNull();
    expect(S.canonicalBaseUrl({ publicUrl: "https://fastque.com/x" })).toBeNull();
    expect(S.canonicalBaseUrl({ publicUrl: null, readiness: { ready: true } })).toBeNull();
    expect(S.canonicalBaseUrl({ publicUrl: "javascript:alert(1)", readiness: { ready: true } })).toBeNull();
    expect(S.canonicalBaseUrl({ publicUrl: "not a url", readiness: { ready: true } })).toBeNull();
    expect(S.canonicalBaseUrl(null)).toBeNull();
  });
  it("adds exactly one fq_campaign parameter and keeps the shop path", () => {
    expect(S.buildCampaignUrl("https://fastque.com/in/patna/fade-house", TOKEN)).toBe(`https://fastque.com/in/patna/fade-house?fq_campaign=${TOKEN}`);
    // an existing value is replaced, never duplicated
    expect(S.buildCampaignUrl(`https://fastque.com/in/patna/fade-house?fq_campaign=old&x=1`, TOKEN)).toBe(`https://fastque.com/in/patna/fade-house?fq_campaign=${TOKEN}&x=1`);
  });
  it("refuses a badly shaped token or address instead of making a link that cannot work", () => {
    expect(S.buildCampaignUrl("https://fastque.com/x", "short")).toBeNull();
    expect(S.buildCampaignUrl("not a url", TOKEN)).toBeNull();
  });
});

describe("helpers", () => {
  it("formats a date on the shop's calendar and tolerates a missing one", () => {
    expect(S.formatShopDate("2026-10-11T18:30:00.000Z", "Asia/Kolkata")).toBe("12 Oct 2026");
    expect(S.formatShopDate(null, "Asia/Kolkata")).toBe("—");
  });
  it("shows the last day a campaign counts, not the exclusive end instant", () => {
    const body = S.toCreateBody({ source: "FACEBOOK", label: "x", firstDay: "2026-10-12", lastDay: "2026-10-31" }, "Asia/Kolkata");
    expect(S.formatLastDay(body.endsAt, "Asia/Kolkata")).toBe("31 Oct 2026");
    expect(S.formatLastDay(null, "Asia/Kolkata")).toBe("—");
    expect(S.formatLastDay("not a date", "Asia/Kolkata")).toBe("—");
  });
  it("builds the summary query and sorts by bookings without dropping rows or mutating", () => {
    expect(S.summaryQueryString({ from: "2026-10-01", to: "2026-10-16" })).toBe("from=2026-10-01&to=2026-10-16");
    const rows = [{ k: "a", bookingCount: 1 }, { k: "b", bookingCount: 5 }, { k: "c", bookingCount: 1 }];
    expect(S.sortByBookings(rows).map((r) => r.k)).toEqual(["b", "a", "c"]);
    expect(rows[0].k).toBe("a");
  });
});
