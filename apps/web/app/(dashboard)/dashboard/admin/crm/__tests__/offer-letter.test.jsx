const {
  buildOfferLetterPdf,
  formatInr,
  guessCandidateName,
} = require("../offer-letter");

describe("FastQue CRM offer letter helpers", () => {
  test("guesses candidate name from resume filename", () => {
    expect(guessCandidateName("RAHUL_KUMAR_RESUME.pdf")).toBe("Rahul Kumar");
  });

  test("formats Indian salary grouping", () => {
    expect(formatInr(1250000)).toBe("12,50,000");
  });

  test("builds a PDF payload", () => {
    const bytes = buildOfferLetterPdf({
      candidateName: "Asha Kumar",
      role: "Field Executive",
      baseSalary: 50000,
      salaryBasis: "monthly",
      joiningDate: "2026-10-20",
    });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.4");
    expect(bytes.length).toBeGreaterThan(1000);
  });


  test("shows the entered target and incentive rate in the PDF without conflicting old slabs", () => {
    const bytes = buildOfferLetterPdf({
      candidateName: "Asha Kumar",
      role: "Field Sales Executive",
      baseSalary: 12000,
      salaryBasis: "monthly",
      salesTarget: 120,
      incentiveBeyondTarget: 150,
    });
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("Sales Target: 120 successfully onboarded shops");
    expect(text).toContain("Incentives Beyond Target: INR 150 per additional");
    expect(text).toContain("Sales Target of 120 shops");
    expect(text).not.toContain("Incentive slab: for shops 86 through 100");
    expect(text).not.toContain("From the 101st shop onward");
    expect(text).toContain("Expected Performance Incentive");
  });

  test("preserves standard policy when custom target and rate are blank", () => {
    const bytes = buildOfferLetterPdf({
      candidateName: "Asha Kumar",
      baseSalary: 12000,
      salaryBasis: "monthly",
    });
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("minimum of 85 shops");
    expect(text).toContain("INR 60 per shop");
    expect(text).toContain("INR 100 per shop");
  });

  test("rejects partial, zero, fractional and nonfinite custom policy input", () => {
    const base = { candidateName: "Asha", baseSalary: 12000, salaryBasis: "monthly" };
    expect(() => buildOfferLetterPdf({ ...base, salesTarget: 100 })).toThrow("both sales target");
    expect(() => buildOfferLetterPdf({ ...base, incentiveBeyondTarget: 150 })).toThrow("both sales target");
    expect(() => buildOfferLetterPdf({ ...base, salesTarget: 0, incentiveBeyondTarget: 150 })).toThrow("positive whole number");
    expect(() => buildOfferLetterPdf({ ...base, salesTarget: 100.5, incentiveBeyondTarget: 150 })).toThrow("positive whole number");
    expect(() => buildOfferLetterPdf({ ...base, salesTarget: 100, incentiveBeyondTarget: Infinity })).toThrow("positive whole rupee");
    expect(() => buildOfferLetterPdf({ ...base, salesTarget: 100, incentiveBeyondTarget: -2 })).toThrow("positive whole rupee");
  });
});
