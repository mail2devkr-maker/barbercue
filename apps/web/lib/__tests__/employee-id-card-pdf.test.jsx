import { buildEmployeeIdCardDraftPdf, cardImagesToA4Pdf, OFFICIAL_SITE_QR_URL } from "../../app/(dashboard)/dashboard/admin/crm/employee-id-card";

describe("CRM employee ID card HR draft PDF", () => {
  test("A4 contains two physical ISO ID-1 faces without claiming ID verification", () => {
    // Tiny JPEG markers are enough to certify the PDF container layout. Card-image
    // rendering and barcode scanning must be tested separately in a real browser.
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = cardImagesToA4Pdf(jpeg, jpeg);
    const body = Buffer.from(pdf).toString("latin1");
    expect(body.startsWith("%PDF-1.4")).toBe(true);
    expect(body).toContain("/MediaBox [0 0 595 842]");
    expect(body).toContain("/Count 1");
    expect(body).toContain("/Width 1028 /Height 648");
    expect(body).toContain("242.646"); // 85.6 mm at 72 PDF points/inch
    expect(body).toContain("153.071"); // 54 mm at 72 PDF points/inch
    expect(body).toContain("QR opens fastque.com only; it does not verify employee identity.");
    expect(body).toContain("HR Draft");
    expect(body).toContain("startxref");
    expect(body).toContain("%%EOF");

    const expectedXref = Buffer.byteLength(body.slice(0, body.indexOf("xref\n0 ")), "utf8");
    expect(body).toContain("startxref\n" + expectedXref + "\n");
  });


  const input = (employeeCode, photo = { type: "image/jpeg", size: 128 }) => ({
    employeeCode, fullName: "Test Employee", designation: "Field Executive",
    territory: "Delhi NCR", joinedAt: "2026-10-09T00:00:00.000Z", photo,
    siteQrCanvas: {},
  });

  test.each([
    "FQ-FE-1234",
    "FQ-FE-12345suffix",
    "FQ-FE-12345\\n",
    "FQ-XX-12345",
    "FQ-FE-12345 ",
  ])("refuses untrusted or malformed employee identifier: %p", async (code) => {
    await expect(buildEmployeeIdCardDraftPdf(input(code)))
      .rejects.toThrow("Select a valid registered employee.");
  });

  test.each([
    { type: "application/pdf", size: 128 },
    { type: "image/jpeg", size: 0 },
    { type: "image/png", size: 5 * 1024 * 1024 + 1 },
  ])("rejects invalid photo input before rendering: %p", async (photo) => {
    await expect(buildEmployeeIdCardDraftPdf(input("FQ-FE-12345", photo)))
      .rejects.toThrow("Choose a PNG, JPG or WebP photo up to 5 MB.");
  });

  test("site QR remains explicitly non-verifying until a real employee verification service exists", () => {
    expect(OFFICIAL_SITE_QR_URL).toBe("https://fastque.com");
  });
});
