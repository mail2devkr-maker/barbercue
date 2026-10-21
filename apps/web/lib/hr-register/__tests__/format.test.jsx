import { formatDay, formatInstant, isEmployeeCode, normalizeEmployeeCodeInput, parseRupees, todayInIndia, validateReason } from "../format";

describe("India-time display", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  test("an instant is always shown in IST with the zone label, whatever the machine's time zone", () => {
    for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Auckland"]) {
      process.env.TZ = tz;
      expect(formatInstant("2026-10-21T20:00:00.000Z")).toBe("22 Oct 2026, 01:30 IST");
    }
  });

  test("a calendar date never shifts by time zone", () => {
    for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Auckland"]) {
      process.env.TZ = tz;
      expect(formatDay("2026-10-22")).toBe("22 Oct 2026");
    }
  });

  test("bad or missing values render as a dash, never 'Invalid Date'", () => {
    expect(formatInstant(null)).toBe("—");
    expect(formatInstant("garbage")).toBe("—");
    expect(formatDay(undefined)).toBe("—");
    expect(formatDay("2026-13-45")).toBe("—");
  });

  test("today is the Indian calendar day: just after midnight IST is already the next day", () => {
    expect(todayInIndia(new Date("2026-10-21T19:00:00.000Z"))).toBe("2026-10-22");
    expect(todayInIndia(new Date("2026-10-21T17:00:00.000Z"))).toBe("2026-10-21");
  });
});

describe("employee code input", () => {
  test("accepts only the canonical code shape", () => {
    expect(isEmployeeCode("FQ-FE-00101")).toBe(true);
    for (const bad of ["fq-fe-00101", "FQ-FE-101", "FQ-FE-001010", "FQ-FE-0010A", "", "EMP-00101"]) expect(isEmployeeCode(bad)).toBe(false);
  });

  test("search input is normalised, never invented", () => {
    expect(normalizeEmployeeCodeInput("FQ-FE-00123")).toBe("FQ-FE-00123");
    expect(normalizeEmployeeCodeInput("fq-fe-123")).toBe("FQ-FE-00123");
    expect(normalizeEmployeeCodeInput("fqfe123")).toBe("FQ-FE-00123");
    expect(normalizeEmployeeCodeInput("123")).toBe("FQ-FE-00123");
    expect(normalizeEmployeeCodeInput("")).toBeNull();
    expect(normalizeEmployeeCodeInput("Asha")).toBeNull();
    expect(normalizeEmployeeCodeInput("123456")).toBeNull();
  });
});

describe("input validation", () => {
  test("reasons need real content and a sane length", () => {
    expect(validateReason("  no ").ok).toBe(false);
    expect(validateReason("Candidate relocated").ok).toBe(true);
    expect(validateReason("x".repeat(501)).ok).toBe(false);
    expect(validateReason("  Candidate relocated  ")).toEqual({ ok: true, value: "Candidate relocated" });
  });

  test("rupee amounts must be positive and well formed", () => {
    expect(parseRupees("50,000")).toBe(50000);
    expect(parseRupees("1,25,000.50")).toBe(125000.5);
    for (const bad of ["", "0", "-5", "abc", "12.345", "1e5", "NaN"]) expect(parseRupees(bad)).toBeNull();
  });
});
