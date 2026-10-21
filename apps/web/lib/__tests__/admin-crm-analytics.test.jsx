// Platform admin CRM analytics helpers (requirement #29; Codex PR #262, docs/contracts/ADMIN_CRM_ANALYTICS_V1.md).
import * as A from "../admin-crm-analytics";

const EMP = "b2b5df36-f837-4d9e-9866-cddbf064626e";
const DAY_MS = 86_400_000;

describe("analyticsRange", () => {
  it("turns whole UTC days into [from, to) with the day after the last day as the excluded end", () => {
    const r = A.analyticsRange("2026-10-01", "2026-10-20");
    expect(r.ok).toBe(true);
    expect(r.range).toEqual({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-21T00:00:00.000Z", days: 20 });
  });

  it("accepts a single day", () => {
    const r = A.analyticsRange("2026-10-05", "2026-10-05");
    expect(r.ok && r.range).toEqual({ from: "2026-10-05T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z", days: 1 });
  });

  it("allows exactly 366 days and no more, in a leap year too", () => {
    const ok = A.analyticsRange("2027-01-01", "2027-12-31"); // 365
    expect(ok.ok).toBe(true);
    const leap = A.analyticsRange("2028-01-01", "2028-12-31"); // 366
    expect(leap.ok).toBe(true);
    expect(Date.parse(leap.range.to) - Date.parse(leap.range.from)).toBe(366 * DAY_MS);
    const tooMany = A.analyticsRange("2027-01-01", "2028-01-02"); // 367
    expect(tooMany.ok).toBe(false);
    expect(tooMany.problem).toContain("366");
    expect(tooMany.problem).toContain("367");
  });

  it("refuses a reversed range and dates that are not real days", () => {
    expect(A.analyticsRange("2026-10-05", "2026-10-04").ok).toBe(false);
    for (const bad of ["", "abc", "2026-1-1", "2026-02-30", "2026-13-01", "2026-00-10", "1999-12-31", "3000-01-01", "2026-10-01T00:00:00Z"]) {
      const from = A.analyticsRange(bad, "2026-10-04");
      expect(from.ok).toBe(false);
      expect(from.problem).toBe("Choose a valid start date.");
      const to = A.analyticsRange("2026-10-01", bad);
      expect(to.ok).toBe(false);
      expect(to.problem).toBe("Choose a valid end date.");
    }
  });

  it("accepts 29 February only in a leap year", () => {
    expect(A.analyticsRange("2028-02-29", "2028-02-29").ok).toBe(true);
    expect(A.analyticsRange("2027-02-29", "2027-03-01").ok).toBe(false);
  });
});

describe("presetDays", () => {
  const now = new Date("2026-10-21T03:00:00.000Z");

  it("counts presets back from today in UTC", () => {
    expect(A.presetDays("7d", now)).toEqual({ from: "2026-10-15", to: "2026-10-21" });
    expect(A.presetDays("30d", now)).toEqual({ from: "2026-09-22", to: "2026-10-21" });
    expect(A.presetDays("90d", now)).toEqual({ from: "2026-07-24", to: "2026-10-21" });
    expect(A.presetDays("month", now)).toEqual({ from: "2026-10-01", to: "2026-10-21" });
    expect(A.presetDays("lastMonth", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("uses the UTC day, not the local day, near midnight", () => {
    // 01:30 on 21 October in India is still 20 October in UTC.
    expect(A.presetDays("7d", new Date("2026-10-20T20:00:00.000Z")).to).toBe("2026-10-20");
  });

  it("crosses a year boundary for last month and keeps month lengths right", () => {
    expect(A.presetDays("lastMonth", new Date("2027-01-05T12:00:00.000Z"))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(A.presetDays("lastMonth", new Date("2028-03-02T12:00:00.000Z"))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("every preset is a valid range", () => {
    for (const p of A.RANGE_PRESETS) {
      const d = A.presetDays(p.id, now);
      expect(A.analyticsRange(d.from, d.to).ok).toBe(true);
    }
  });
});

describe("analyticsQuery", () => {
  const range = A.analyticsRange("2026-10-01", "2026-10-20").range;

  it("sends the instants and no employee for all employees", () => {
    const q = new URLSearchParams(A.analyticsQuery(range, A.ALL));
    expect(q.get("from")).toBe("2026-10-01T00:00:00.000Z");
    expect(q.get("to")).toBe("2026-10-21T00:00:00.000Z");
    expect(q.has("employeeId")).toBe(false);
  });

  it("sends an employee only when it is an id", () => {
    expect(new URLSearchParams(A.analyticsQuery(range, EMP)).get("employeeId")).toBe(EMP);
    expect(new URLSearchParams(A.analyticsQuery(range, "FQ-FE-00101")).has("employeeId")).toBe(false);
    expect(new URLSearchParams(A.analyticsQuery(range, "")).has("employeeId")).toBe(false);
  });
});

describe("detailParams", () => {
  const range = A.analyticsRange("2026-10-01", "2026-10-20").range;
  const f = (over = {}) => ({ ...A.EMPTY_DETAIL_FILTER, ...over });

  it("carries the period, the employee and a search of two or more characters", () => {
    const p = A.detailParams("leads", f({ search: "  Raj  " }), range, EMP);
    expect(p).toMatchObject({ from: range.from, to: range.to, employeeId: EMP, q: "Raj" });
    expect(A.detailParams("leads", f({ search: "R" }), range, A.ALL).q).toBeUndefined();
    expect(A.detailParams("leads", f(), null, A.ALL)).toMatchObject({ from: undefined, to: undefined, employeeId: undefined });
  });

  it("sends only filters of the kind being listed, and only values the server knows", () => {
    const filter = f({ status: "ONBOARDED", source: "REFERRAL", outcome: "DEMO_COMPLETED", channel: "CALL" });
    const leads = A.detailParams("leads", filter, null, A.ALL);
    expect(leads).toMatchObject({ status: "ONBOARDED", source: "REFERRAL" });
    expect(leads.outcome).toBeUndefined();
    expect(leads.channel).toBeUndefined();
    const visits = A.detailParams("visits", filter, null, A.ALL);
    expect(visits.outcome).toBe("DEMO_COMPLETED");
    expect(visits.status).toBeUndefined();
    expect(visits.source).toBeUndefined();
    const followUps = A.detailParams("follow-ups", f({ status: "OPEN", channel: "WHATSAPP" }), null, A.ALL);
    expect(followUps).toMatchObject({ status: "OPEN", channel: "WHATSAPP" });
    // A lead stage is not a follow-up status: it is never sent to the follow-up route.
    expect(A.detailParams("follow-ups", f({ status: "ONBOARDED" }), null, A.ALL).status).toBeUndefined();
    expect(A.detailParams("leads", f({ status: "SQL;DROP" }), null, A.ALL).status).toBeUndefined();
  });

  it("points at the paged routes", () => {
    expect(A.DETAIL_PATHS).toEqual({ leads: "admin/crm/leads/page", visits: "admin/crm/visits/page", "follow-ups": "admin/crm/follow-ups/page" });
  });
});

describe("error words", () => {
  it("explains the stable analytics error codes", () => {
    expect(A.adminCrmErrorText("ADMIN_DATE_RANGE_TOO_LARGE", "x")).toContain("366");
    expect(A.adminCrmErrorText("ADMIN_CURSOR_UNAVAILABLE", "x")).toMatch(/not available.*try again later/i);
    expect(A.adminCrmErrorText("ADMIN_CURSOR_INVALID", "x")).toContain("starts again");
    expect(A.adminCrmErrorText("VALIDATION_ERROR", "from must be earlier than to")).toBe("from must be earlier than to");
    expect(A.adminCrmErrorText("VALIDATION_ERROR", "")).toBe("One of the filters is not valid.");
    expect(A.adminCrmErrorText("SOMETHING_ELSE", "Server words")).toBe("Server words");
  });

  it("says plainly when the session ended or the account may not see this", () => {
    expect(A.adminCrmFailureText(401, undefined, "", "fb")).toContain("Sign in again");
    expect(A.adminCrmFailureText(403, "FORBIDDEN", "Forbidden resource", "fb")).toBe("Only platform admins can see CRM analytics.");
    expect(A.adminCrmFailureText(null, undefined, "", "Could not load.")).toBe("Could not load.");
    expect(A.adminCrmFailureText(400, "ADMIN_DATE_RANGE_TOO_LARGE", "x", "fb")).toContain("366");
  });
});

describe("number and text helpers", () => {
  it("formats counts, percentages and missing values without printing undefined or NaN", () => {
    expect(A.countText(1234567)).toBe("12,34,567");
    expect(A.countText(undefined)).toBe("—");
    expect(A.countText(Number.NaN)).toBe("—");
    expect(A.percentText(33.3)).toBe("33.3%");
    expect(A.percentText(0)).toBe("0.0%");
    expect(A.percentText(null)).toBe("—");
    expect(A.percentText(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("derives the period conversion with the server's definition and says nothing with no leads", () => {
    expect(A.totalConversion(4, 12)).toBe(33.3);
    expect(A.totalConversion(1, 3)).toBe(33.3);
    expect(A.totalConversion(2, 3)).toBe(66.7);
    expect(A.totalConversion(0, 5)).toBe(0);
    expect(A.totalConversion(0, 0)).toBeNull();
    expect(A.totalConversion(3, Number.NaN)).toBeNull();
  });

  it("labels a missing territory and formats words", () => {
    expect(A.territoryLabel(null)).toBe("No territory");
    expect(A.territoryLabel("   ")).toBe("No territory");
    expect(A.territoryLabel("Patna")).toBe("Patna");
    expect(A.pretty("DEMO_SCHEDULED")).toBe("Demo Scheduled");
  });

  it("writes an instant in UTC and a bad one as a dash", () => {
    expect(A.utcText("2026-10-21T00:00:00.000Z")).toMatch(/21 Oct 2026.*00:00 UTC$/);
    expect(A.utcText("nope")).toBe("—");
    expect(A.utcText(null)).toBe("—");
    expect(A.localText(undefined)).toBe("—");
  });
});

describe("sortRows", () => {
  const rows = [
    { code: "B", territory: "Ranchi", leadsCreated: 5, visits: 2, conversionPercent: 20, openFollowUpsOverdueInPeriod: 0 },
    { code: "A", territory: null, leadsCreated: 9, visits: 1, conversionPercent: 55.5, openFollowUpsOverdueInPeriod: 3 },
    { code: "C", territory: "Patna", leadsCreated: 9, visits: 7, conversionPercent: 10, openFollowUpsOverdueInPeriod: 1 },
  ];

  it("sorts by name with an unnamed row last, and never mutates the input", () => {
    const copy = [...rows];
    expect(A.sortRows(rows, "name", (r) => r.territory).map((r) => r.code)).toEqual(["C", "B", "A"]);
    expect(A.sortRows(rows, "name", (r) => r.code).map((r) => r.code)).toEqual(["A", "B", "C"]);
    expect(rows).toEqual(copy);
  });

  it("sorts a number largest first and breaks a tie by name", () => {
    expect(A.sortRows(rows, "leads", (r) => r.code).map((r) => r.code)).toEqual(["A", "C", "B"]);
    expect(A.sortRows(rows, "visits", (r) => r.code).map((r) => r.code)).toEqual(["C", "B", "A"]);
    expect(A.sortRows(rows, "conversion", (r) => r.code).map((r) => r.code)).toEqual(["A", "B", "C"]);
    expect(A.sortRows(rows, "overdue", (r) => r.code).map((r) => r.code)).toEqual(["A", "C", "B"]);
  });

  it("treats a non-number as zero instead of breaking the order", () => {
    const odd = [{ ...rows[0], leadsCreated: Number.NaN }, rows[1]];
    expect(A.sortRows(odd, "leads", (r) => r.code).map((r) => r.code)).toEqual(["A", "B"]);
  });
});
