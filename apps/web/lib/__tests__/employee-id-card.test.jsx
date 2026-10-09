const { Role } = require("@barbercue/shared");
const { approvedSignatureSvg, approvedSignaturePdfCommands } = require("../approved-signature-watermark");
const { mayPreviewCompanyIdCard, buildEmployeeIdCardPreview } = require("../employee-id-card");

const employee = {
  employeeCode: "FQ-FE-00101",
  fullName: "Shambhoo Yogi",
  territory: "Delhi-NCR",
  joinedAt: "2026-10-09T00:00:00.000Z",
};
const input = {
  qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0h1v1H0z"/></svg>',
  logoUrl: "https://fastque.com/brand/fastque-clean-lockup-transparent.png",
};

describe("FastQue owner-approved signature watermark", () => {
  test("SVG and PDF use the same D/K in D watermark silhouettes", () => {
    const svg = approvedSignatureSvg(0.24);
    expect(svg).toContain('viewBox="0 0 512 230"');
    expect(svg).toContain('opacity="0.24"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('D K Pandey');
    const drawing = approvedSignaturePdfCommands(48, 280, 150);
    expect(drawing).toContain("q\n0.51 0.59 0.75 rg\n");
    expect(drawing).toContain("f*\nQ\n");
    expect(drawing).not.toContain(String.raw`\\n`);
    expect(() => approvedSignatureSvg(1.5)).toThrow();
  });
});

describe("FastQue draft employee ID cards", () => {
  test.each([0, 1, 99, 100])("reserves ID number %i exclusively for Super Admin", (num) => {
    const code = "FQ-FE-" + String(num).padStart(5, "0");
    for (const role of [Role.HR_ADMIN, Role.CO_FOUNDER, Role.SALES_ADMIN, Role.PLATFORM_VIEWER]) {
      expect(mayPreviewCompanyIdCard([role], code)).toBe(false);
    }
    expect(mayPreviewCompanyIdCard([Role.PLATFORM_ADMIN], code)).toBe(true);
  });

  test("standard range starts at 101, with HR and Co-Founder card template access", () => {
    for (const role of [Role.HR_ADMIN, Role.CO_FOUNDER, Role.PLATFORM_ADMIN]) {
      expect(mayPreviewCompanyIdCard([role], "FQ-FE-00101")).toBe(true);
    }
    expect(mayPreviewCompanyIdCard([], "FQ-FE-00101")).toBe(false);
    expect(mayPreviewCompanyIdCard([Role.SALES_ADMIN], "FQ-FE-00101")).toBe(false);
    expect(mayPreviewCompanyIdCard([Role.HR_ADMIN], "FQ-FE-abcde")).toBe(false);
  });

  test("draft card is ISO ID-1 and uses the employee's real database fields", () => {
    const html = buildEmployeeIdCardPreview(employee, input);
    expect(html).toContain("85.6mm");
    expect(html).toContain("54mm");
    expect(html).toContain("Shambhoo Yogi");
    expect(html).toContain("FQ-FE-00101");
    expect(html).toContain("09 Oct 2026");
    expect(html).toContain("Delhi-NCR");
    expect(html).toContain("Field Executive");
    expect(html).toContain("PHOTO<br>REQUIRED");
    expect(html).toContain("HR SIGNATURE / APPROVAL PENDING");
    expect(html).toContain("DRAFT");
    expect(html).toContain("OFFICIAL WEBSITE");
    expect(html).toContain('viewBox="0 0 512 230"');
    expect(html).not.toContain("Employee verification");
  });

  test("escapes employee text and refuses unsafe photos", () => {
    const html = buildEmployeeIdCardPreview({...employee,fullName:'<script>alert("x")</script>'},input);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(() => buildEmployeeIdCardPreview(employee,{...input,photoDataUrl:'javascript:alert(1)'})).toThrow();
    expect(() => buildEmployeeIdCardPreview(employee,{...input,qrSvg:''})).toThrow();
  });
});