// Pure logic only (PR #245 contract). A check, not an import: nothing is saved or sent, and consent is the owner's statement.
import * as P from "../contact-preview";

describe("parseContactList", () => {
  it("reads one contact per line and skips blank lines, keeping the original line numbers", () => {
    const r = P.parseContactList("98765 43210\n\n+44 7700 900123\r\n  9123456780  ");
    expect(r.rows.map((x) => [x.line, x.phone])).toEqual([[1, "98765 43210"], [3, "+44 7700 900123"], [4, "9123456780"]]);
    expect(r.problems).toEqual([]);
  });

  it("reads an optional source and date on a line, with commas, semicolons or tabs", () => {
    const r = P.parseContactList("98765 43210, in person, 2026-09-30\n9123456780;WRITTEN\n9000000001\tVERBAL\t2026-10-01");
    expect(r.rows[0]).toMatchObject({ source: "IN_PERSON", date: "2026-09-30" });
    expect(r.rows[1]).toMatchObject({ source: "WRITTEN", date: null });
    expect(r.rows[2]).toMatchObject({ source: "VERBAL", date: "2026-10-01" });
  });

  it("reports a line it cannot use against its own line number and never guesses", () => {
    const r = P.parseContactList("9876543210, maybe\n9876543211, IN_PERSON, 2026-02-30\n, IN_PERSON\n9876543212, VERBAL, 2026-10-01, extra\n" + "9".repeat(41));
    expect(r.rows).toEqual([]);
    expect(r.problems.map((p) => p.line)).toEqual([1, 2, 3, 4, 5]);
    expect(r.problems[0].message).toContain("not a known way of agreeing");
    expect(r.problems[1].message).toContain("not a real date");
    expect(r.problems[4].message).toContain("at most 40");
  });
});

describe("batch consent", () => {
  it("needs no date check when nobody is attested", () => {
    expect(P.validateBatch({ attested: false, source: "OWNER_ATTESTED", date: "" })).toBeNull();
  });
  it("needs a real date that is not in the future when attested", () => {
    expect(P.validateBatch({ attested: true, source: "OWNER_ATTESTED", date: "2026-10-16" }, "2026-10-17")).toBeNull();
    expect(P.validateBatch({ attested: true, source: "OWNER_ATTESTED", date: "2026-10-17" }, "2026-10-17")).toBeNull();
    expect(P.validateBatch({ attested: true, source: "OWNER_ATTESTED", date: "2026-10-18" }, "2026-10-17")).toContain("future");
    expect(P.validateBatch({ attested: true, source: "OWNER_ATTESTED", date: "" })).toContain("date");
    expect(P.validateBatch({ attested: true, source: "OWNER_ATTESTED", date: "2026-02-30" })).toContain("date");
  });
  it("reads today's date in UTC", () => {
    expect(P.todayIso(new Date("2026-10-17T23:30:00Z"))).toBe("2026-10-17");
  });
});

describe("buildRequest", () => {
  const rows = [
    { line: 1, phone: "98765 43210", source: null, date: null },
    { line: 2, phone: "9123456780", source: "WRITTEN", date: "2026-09-01" },
  ];
  it("states no consent for anyone the owner did not attest for", () => {
    expect(P.buildRequest([rows[0]], { attested: false, source: "OWNER_ATTESTED", date: "2026-10-01" })).toEqual({ contacts: [{ phone: "98765 43210" }] });
  });
  it("applies the owner's statement to every line, and a line's own details win for that line", () => {
    expect(P.buildRequest(rows, { attested: true, source: "IN_PERSON", date: "2026-10-01" })).toEqual({
      contacts: [
        { phone: "98765 43210", consent: { granted: true, source: "IN_PERSON", capturedAt: "2026-10-01T00:00:00.000Z" } },
        { phone: "9123456780", consent: { granted: true, source: "WRITTEN", capturedAt: "2026-09-01T00:00:00.000Z" } },
      ],
    });
  });
  it("sends a line's own consent details even without a batch statement (the server will flag what is incomplete)", () => {
    expect(P.buildRequest([rows[1]], { attested: false, source: "OWNER_ATTESTED", date: "2026-10-01" }).contacts[0].consent).toEqual({ granted: true, source: "WRITTEN", capturedAt: "2026-09-01T00:00:00.000Z" });
  });
  it("sends only phone and consent, never names or anything else", () => {
    const body = P.buildRequest(rows, { attested: true, source: "VERBAL", date: "2026-10-01" });
    for (const c of body.contacts) expect(Object.keys(c).sort()).toEqual(["consent", "phone"]);
  });
});

describe("status words", () => {
  it("explains every server status in plain words, and shows an unknown one as sent", () => {
    for (const s of ["VALIDATED_FOR_REVIEW", "INVALID_PHONE", "CONSENT_REQUIRED", "CONSENT_EVIDENCE_INCOMPLETE", "CONSENT_TIMESTAMP_INVALID", "DUPLICATE_IN_BATCH"]) {
      expect(P.statusText(s).label).not.toBe(s);
      expect(P.statusText(s).help).not.toBe("");
    }
    expect(P.statusText("VALIDATED_FOR_REVIEW").ok).toBe(true);
    expect(P.statusText("INVALID_PHONE").ok).toBe(false);
    expect(P.statusText("NEW_THING")).toEqual({ label: "NEW_THING", help: "", ok: false });
  });
  it("does not describe a complete line as permission to invite", () => {
    expect(P.statusText("VALIDATED_FOR_REVIEW").help).toContain("not a decision to invite");
  });
  it("masks all but the last four digits", () => {
    expect(P.maskedPhone("+91 98765 43210")).toBe("••••3210");
    expect(P.maskedPhone("123")).toBe("••••");
  });
});

describe("consent sources", () => {
  it("offers the five sources the server accepts", () => {
    expect(P.CONSENT_SOURCES.map((s) => s.value).sort()).toEqual(["IN_PERSON", "OWNER_ATTESTED", "VERBAL", "WEBSITE_FORM", "WRITTEN"]);
    expect(P.isConsentSource("IN_PERSON")).toBe(true);
    expect(P.isConsentSource("EMAIL")).toBe(false);
  });
  it("matches the server's limit", () => {
    expect(P.MAX_CONTACTS).toBe(250);
  });
});
