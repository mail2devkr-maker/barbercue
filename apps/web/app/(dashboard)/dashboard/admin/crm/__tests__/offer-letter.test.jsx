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
    // PDF text is wrapped into separate drawing commands across lines.
    const drawnText = Array.from(text.matchAll(/\((.*?)\) Tj/g), (match) => match[1]).join(" ");
    expect(drawnText).toContain("Sales Target of 120 shops");
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

  test("uses INR 5,000 every month, INR 60,000 annually, for all future offers", () => {
    // Match rendered PDF text commands, not the raw salaryBreakdown implementation.
    for (const baseSalary of [12000, 20000, 50000]) {
      const bytes = buildOfferLetterPdf({
        candidateName: "Shambhoo Yogi",
        baseSalary,
        salaryBasis: "monthly",
      });
      const pdf = new TextDecoder().decode(bytes);
      // Decode escaped PDF text operators (such as \(INR\)) correctly.
      const draws = [...pdf.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
        .map(m => m[1].replace(/\\([()\\])/g, "$1"));
      const annualIndex = draws.indexOf("Annual Amount (INR)");
      const monthlyIndex = draws.indexOf("Monthly Amount (INR)");
      expect(annualIndex).toBeGreaterThan(0);
      expect(monthlyIndex).toBeGreaterThan(annualIndex);
      const annual = draws.slice(annualIndex, monthlyIndex);
      const monthly = draws.slice(monthlyIndex);
      function valueFollowing(rows, label) {
        const i = rows.indexOf(label);
        expect(i).toBeGreaterThanOrEqual(0);
        return rows[i + 1];
      }
      expect(valueFollowing(annual, "Expected Performance Incentive")).toBe("60,000");
      expect(valueFollowing(monthly, "Expected Performance Incentive")).toBe("5,000");
      expect(valueFollowing(annual, "Total Expected Package")).toBe(
        formatInr(baseSalary * 12 + 60000),
      );
      expect(valueFollowing(monthly, "Total Expected Package")).toBe(
        formatInr(baseSalary + 5000),
      );
      const visible = draws.join(" ");
      expect(visible).toContain("INR 5,000 per month");
      expect(visible).not.toContain("up to approximately INR 20,000 per month");
    }
  });

  test("does not double count the 5k illustrative incentive with custom beyond-target slabs", () => {
    const pdf = new TextDecoder().decode(buildOfferLetterPdf({
      candidateName: "Shambhoo Yogi",
      baseSalary: 20000,
      salaryBasis: "monthly",
      salesTarget: 100,
      incentiveBeyondTarget: 150,
    }));
    expect(pdf).toContain("Sales Target: 100 successfully onboarded shops");
    expect(pdf).toContain("Incentives Beyond Target: INR 150");
    const drawnText = [...pdf.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
      .map(m => m[1].replace(/\\([()\\])/g, "$1")).join(" ");
    expect(drawnText).toContain("INR 5,000 per month");
    expect(drawnText).toContain("not an additional guaranteed payment");
    expect(pdf).not.toContain("up to approximately INR 20,000 per month");
  });
  test("stamps the approved D K Pandey watermark on future offers without disturbing pay policy", () => {
    const pdf = new TextDecoder().decode(buildOfferLetterPdf({
      candidateName: "Shambhoo Yogi",
      role: "Field Executive",
      baseSalary: 20000,
      salaryBasis: "monthly",
    }));
    expect(pdf).toContain("0.51 0.59 0.75 rg");
    expect(pdf).toContain("Authorized Signatory");
    expect(pdf).toContain("Expected Performance Incentive");
    expect(pdf).toContain("5,000");
    expect(pdf).not.toContain("COMPANY_SIGNATURE_CONTOURS");
  });

});
