const {
  buildOfferLetterPdf,
  formatInr,
  guessCandidateName,
} = require("../offer-letter");

const CODE = "FQ-FE-00101";

describe("FastQue CRM offer letter helpers", () => {
  test("guesses candidate name from resume filename", () => {
    expect(guessCandidateName("RAHUL_KUMAR_RESUME.pdf")).toBe("Rahul Kumar");
  });

  test("formats Indian salary grouping", () => {
    expect(formatInr(1250000)).toBe("12,50,000");
  });

  test("builds a PDF payload", () => {
    const bytes = buildOfferLetterPdf({ employeeCode: CODE,
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
    const bytes = buildOfferLetterPdf({ employeeCode: CODE,
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
    const bytes = buildOfferLetterPdf({ employeeCode: CODE,
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
    expect(() => buildOfferLetterPdf({ employeeCode: CODE, ...base, salesTarget: 100 })).toThrow("both sales target");
    expect(() => buildOfferLetterPdf({ employeeCode: CODE, ...base, incentiveBeyondTarget: 150 })).toThrow("both sales target");
    expect(() => buildOfferLetterPdf({ employeeCode: CODE, ...base, salesTarget: 0, incentiveBeyondTarget: 150 })).toThrow("positive whole number");
    expect(() => buildOfferLetterPdf({ employeeCode: CODE, ...base, salesTarget: 100.5, incentiveBeyondTarget: 150 })).toThrow("positive whole number");
    expect(() => buildOfferLetterPdf({ employeeCode: CODE, ...base, salesTarget: 100, incentiveBeyondTarget: Infinity })).toThrow("positive whole rupee");
    expect(() => buildOfferLetterPdf({ employeeCode: CODE, ...base, salesTarget: 100, incentiveBeyondTarget: -2 })).toThrow("positive whole rupee");
  });

  test("uses INR 5,000 every month, INR 60,000 annually, for all future offers", () => {
    // Match rendered PDF text commands, not the raw salaryBreakdown implementation.
    for (const baseSalary of [12000, 20000, 50000]) {
      const bytes = buildOfferLetterPdf({ employeeCode: CODE,
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
    const pdf = new TextDecoder().decode(buildOfferLetterPdf({ employeeCode: CODE,
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
});

describe("permanent employee ID from the HR register", () => {
  const base = { candidateName: "Asha Kumar", baseSalary: 12000, salaryBasis: "monthly" };
  const drawn = (bytes) =>
    [...new TextDecoder().decode(bytes).matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
      .map((m) => m[1].replace(/\\([()\\])/g, "$1"));

  test("prints the register-issued code and never the old 'Pending onboarding' placeholder", () => {
    const text = drawn(buildOfferLetterPdf({ ...base, employeeCode: "FQ-FE-00123" })).join(" ");
    expect(text).toContain("FQ-FE-00123");
    expect(text).toContain("Employee No: FQ-FE-00123");
    expect(text).not.toContain("Pending onboarding");
  });

  test("refuses to build a letter without a valid permanent code (no manual or blank IDs)", () => {
    for (const bad of [undefined, "", "   ", "pending", "FQ-FE-123", "FQ-FE-001234", "fq-fe-00123", "EMP-0001"]) {
      expect(() => buildOfferLetterPdf({ ...base, employeeCode: bad })).toThrow("permanent FastQue employee ID");
    }
  });

  test("a reprint with the stored issue instant is byte-identical and shows the original letter date", () => {
    const input = { ...base, employeeCode: "FQ-FE-00123", issuedAt: "2026-10-22T05:30:00.000Z" };
    const first = buildOfferLetterPdf(input);
    const second = buildOfferLetterPdf({ ...input });
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    expect(drawn(first).join(" ")).toContain("22 Oct 2026");
  });

  test("the letter date follows the stored instant in India time, whatever the viewer's zone", () => {
    // 20:00 UTC on 21 Oct is already 22 Oct 01:30 in India.
    const text = drawn(buildOfferLetterPdf({ ...base, employeeCode: "FQ-FE-00123", issuedAt: "2026-10-21T20:00:00.000Z" })).join(" ");
    expect(text).toContain("22 Oct 2026");
  });

  test("rejects an unreadable issue date", () => {
    expect(() => buildOfferLetterPdf({ ...base, employeeCode: "FQ-FE-00123", issuedAt: "not-a-date" })).toThrow("issue date");
  });

  test("keeps the standard INR 5,000 Expected Performance Incentive default unchanged", () => {
    const { DEFAULT_EXPECTED_PERFORMANCE_INCENTIVE_MONTHLY_INR } = require("../offer-letter");
    expect(DEFAULT_EXPECTED_PERFORMANCE_INCENTIVE_MONTHLY_INR).toBe(5000);
    const text = drawn(buildOfferLetterPdf({ ...base, employeeCode: "FQ-FE-00123" })).join(" ");
    expect(text).toContain("INR 5,000 per month");
  });
});
