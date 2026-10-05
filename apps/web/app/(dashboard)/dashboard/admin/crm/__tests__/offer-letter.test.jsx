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
});
