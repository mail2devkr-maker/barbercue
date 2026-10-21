// Excel-compatible (XML) export naming (requirement #17; Codex PR #272/#273 route revenue/report.excel.xml).
import * as R from "../revenue-report";

describe("Excel export wording", () => {
  it("is labelled Excel-compatible (XML), never .xlsx", () => {
    expect(R.EXCEL_EXPORT_LABEL).toBe("Excel-compatible (XML)");
    expect(R.EXCEL_EXPORT_NOTE).toContain("not an .xlsx file");
    expect(R.EXCEL_EXPORT_LABEL.toLowerCase()).not.toContain("xlsx");
  });
  it("names the fallback file from the range, with .xml", () => {
    expect(R.excelFallbackName({ from: "2026-10-01", to: "2026-10-20" })).toBe("fastque-revenue-2026-10-01-2026-10-20.xml");
    expect(R.csvFallbackName({ from: "2026-10-01", to: "2026-10-20" })).toBe("fastque-revenue-2026-10-01-2026-10-20.csv");
  });
});

describe("safeDownloadName", () => {
  const fallback = "fastque-revenue-2026-10-01-2026-10-20.xml";
  it("keeps a plain server name with the expected extension", () => {
    expect(R.safeDownloadName("fastque-revenue-2026-10-01-2026-10-20.xml", fallback, ".xml")).toBe("fastque-revenue-2026-10-01-2026-10-20.xml");
    expect(R.safeDownloadName("Report_1.XML", fallback, ".xml")).toBe("Report_1.XML");
  });
  it("replaces a missing, wrong-type, path-like or odd name with the fallback", () => {
    for (const bad of [null, "", "   ", "report.xlsx", "report.csv", "../x.xml", "a/b.xml", "a\\b.xml", ".hidden.xml", "x..y.xml", "na me.xml", "x\u0000.xml", "é.xml", `${"a".repeat(130)}.xml`]) {
      expect(R.safeDownloadName(bad, fallback, ".xml")).toBe(fallback);
    }
  });
  it("applies the same rule to the CSV", () => {
    expect(R.safeDownloadName("fastque-revenue-server.csv", "f.csv", ".csv")).toBe("fastque-revenue-server.csv");
    expect(R.safeDownloadName("x.xml", "f.csv", ".csv")).toBe("f.csv");
  });
});
