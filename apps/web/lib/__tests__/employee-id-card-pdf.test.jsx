import { buildEmployeeIdCardDraftPdf, cardImagesToA4Pdf, drawApprovedHrSignature, formatEmployeeJoiningDate, ID_CARD_LOGO_FRAME, ID_CARD_HR_SIGNATURE_FRAME, ID_CARD_BACK_SIGNATURE_LAYOUT, OFFICIAL_SITE_QR_URL } from "../../app/(dashboard)/dashboard/admin/crm/employee-id-card";

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
    expect(body).toContain("FastQue Employee ID Card");
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

  test("approved HR signature drawing uses one back-card position", () => {
    const ctx = { drawImage: jest.fn() };
    const signature = {};
    drawApprovedHrSignature(ctx, signature);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledWith(signature, 292, 531, 145, 54);
  });

  test("corrected premium logo sits in the upper-left safe zone", () => {
    expect(ID_CARD_LOGO_FRAME).toEqual({ x: 55, y: 40, width: 570, height: 108 });
    expect(ID_CARD_LOGO_FRAME.x + ID_CARD_LOGO_FRAME.width).toBeLessThan(700);
  });

  test("HR signature stays in one back-only bottom area away from the footer", () => {
    expect(ID_CARD_HR_SIGNATURE_FRAME).toEqual({ x: 292, y: 531, width: 145, height: 54 });
    expect(ID_CARD_HR_SIGNATURE_FRAME.y + ID_CARD_HR_SIGNATURE_FRAME.height).toBeLessThan(595);
    expect(ID_CARD_BACK_SIGNATURE_LAYOUT).toEqual({
      issuedBaselineY: 416, foundBaselineY: 448, emailBaselineY: 478,
      propertyBaselineY: 507, separatorY: 527,
      signatureLabelBaselineY: 573, footerStripeY: 595,
    });
    expect(ID_CARD_HR_SIGNATURE_FRAME.y).toBeGreaterThan(ID_CARD_BACK_SIGNATURE_LAYOUT.separatorY);
    expect(ID_CARD_HR_SIGNATURE_FRAME.y + ID_CARD_HR_SIGNATURE_FRAME.height)
      .toBeLessThan(ID_CARD_BACK_SIGNATURE_LAYOUT.footerStripeY - 5);
    expect(ID_CARD_HR_SIGNATURE_FRAME.x).toBeGreaterThan(275);
    expect(ID_CARD_HR_SIGNATURE_FRAME.width).toBeLessThan(160);
    expect(ID_CARD_BACK_SIGNATURE_LAYOUT.propertyBaselineY + 15)
      .toBeLessThan(ID_CARD_BACK_SIGNATURE_LAYOUT.separatorY);
  });

  test.each([
    ["2026-10-08T18:30:00.000Z", "09-Oct-2026"],
    ["2026-10-09T00:00:00.000Z", "09-Oct-2026"],
    ["2026-10-09", "09-Oct-2026"],
    ["2026-10-09T23:59:59.000+05:30", "09-Oct-2026"],
    ["2026-10-10T00:00:00.000+05:30", "10-Oct-2026"],
  ])("India-local joining calendar preserves %s as %s", (iso, expected) => {
    expect(formatEmployeeJoiningDate(iso)).toBe(expected);
  });

  test("site QR remains explicitly non-verifying until a real employee verification service exists", () => {
    expect(OFFICIAL_SITE_QR_URL).toBe("https://fastque.com");
  });
});
