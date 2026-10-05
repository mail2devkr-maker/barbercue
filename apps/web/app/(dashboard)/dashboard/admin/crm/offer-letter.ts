export type SalaryBasis = "monthly" | "annual";

export type ResumeHints = {
  candidateName: string;
  email: string;
  phone: string;
  role: string;
};

export type PdfBrandImage = {
  hex: string;
  width: number;
  height: number;
};

export type OfferLetterData = {
  candidateName: string;
  email?: string;
  phone?: string;
  role?: string;
  employeeCode?: string;
  address?: string;
  baseSalary: number;
  salaryBasis: SalaryBasis;
  joiningDate?: string;
};

const ROLE_TERMS = [
  "engineer", "developer", "manager", "analyst", "executive", "consultant",
  "designer", "specialist", "lead", "architect", "administrator", "recruiter",
  "accountant", "associate", "officer", "coordinator", "technician", "supervisor",
  "sales", "operations",
];

function titleCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function guessCandidateName(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, "");
  const cleaned = withoutExtension
    .replace(/\b(resume|cv|curriculum|vitae|profile|latest|final|updated|copy|document)\b/gi, " ")
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || /\d{4,}/.test(cleaned)) return "";
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 6) return "";
  return titleCase(cleaned);
}

function candidateNameFromText(text: string): string {
  const skip = /^(resume|curriculum vitae|cv|profile|summary|objective|contact|experience|education|skills|professional summary)$/i;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 30);

  for (const line of lines) {
    if (skip.test(line) || line.includes("@") || /\d{6,}/.test(line) || line.length > 70) continue;
    const words = line.split(" ");
    if (
      words.length >= 2 &&
      words.length <= 6 &&
      words.every((word) => /^[A-Za-z][A-Za-z.'-]*$/.test(word))
    ) {
      return line === line.toUpperCase() ? titleCase(line) : line;
    }
  }
  return "";
}

function roleFromText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 80);

  for (const line of lines) {
    const explicit = line.match(/^(?:designation|current role|job title|position)\s*[:\-]\s*(.+)$/i);
    if (explicit?.[1]) return explicit[1].slice(0, 120);
  }

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (line.length <= 100 && ROLE_TERMS.some((term) => lower.includes(term))) {
      return line.slice(0, 120);
    }
  }
  return "";
}

export async function extractResumeHints(file: File): Promise<ResumeHints> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  let searchable = "";
  let reliableText = "";

  if (extension === "txt" || file.type.startsWith("text/")) {
    reliableText = await file.text();
    searchable = reliableText;
  } else {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength <= 8 * 1024 * 1024) {
      searchable = new TextDecoder("latin1")
        .decode(bytes)
        .replace(/[^\x20-\x7E\r\n]+/g, " ");
    }
  }

  const email =
    searchable.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? "";
  const phone =
    searchable.match(/(?<!\d)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\d)/)?.[0] ?? "";

  return {
    candidateName: candidateNameFromText(reliableText) || guessCandidateName(file.name),
    email,
    phone,
    role: roleFromText(reliableText || searchable),
  };
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

function bytesToHex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0").toUpperCase();
  return output;
}

export async function loadFastQueLogoForPdf(): Promise<PdfBrandImage | null> {
  if (typeof document === "undefined") return null;

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = 720;
      const height = Math.max(1, Math.round(width * image.naturalHeight / image.naturalWidth));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(null);
        return;
      }

      context.fillStyle = "#09090c";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob(async (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        resolve({ hex: bytesToHex(bytes), width, height });
      }, "image/jpeg", 0.94);
    };
    image.onerror = () => resolve(null);
    image.src = "/brand/fastque-clean-lockup-transparent.png";
  });
}

function ascii(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7E]/g, "");
}

function pdfEscape(value: string): string {
  return ascii(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrap(value: string, max = 88): string[] {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function textCommand(
  text: string,
  x: number,
  y: number,
  size = 10.5,
  bold = false,
  rgb = "0.12 0.12 0.15",
): string {
  return `BT /${bold ? "F2" : "F1"} ${size} Tf ${rgb} rg 1 0 0 1 ${x} ${y} Tm (${pdfEscape(text)}) Tj ET\n`;
}

function centeredText(
  text: string,
  y: number,
  size = 10,
  bold = false,
  rgb = "0.12 0.12 0.15",
): string {
  const width = ascii(text).length * size * 0.51;
  return textCommand(text, Math.max(48, (595 - width) / 2), y, size, bold, rgb);
}

function fillRect(x: number, y: number, width: number, height: number, rgb: string): string {
  return rgb + " rg " + x + " " + y + " " + width + " " + height + " re f\n";
}

function strokeLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rgb = "0.78 0.78 0.82",
  width = 0.6,
): string {
  return rgb + " RG " + width + " w " + x1 + " " + y1 + " m " + x2 + " " + y2 + " l S\n";
}

function rgb255(red: number, green: number, blue: number): string {
  return [red, green, blue].map((value) => (value / 255).toFixed(3)).join(" ");
}

function gradientBand(x: number, y: number, width: number, height: number): string {
  const stops = [
    [242, 10, 131],
    [255, 62, 87],
    [255, 122, 69],
  ];
  const segments = 30;
  let output = "";

  for (let index = 0; index < segments; index += 1) {
    const progress = index / (segments - 1);
    const left = progress <= 0.55 ? stops[0] : stops[1];
    const right = progress <= 0.55 ? stops[1] : stops[2];
    const local = progress <= 0.55 ? progress / 0.55 : (progress - 0.55) / 0.45;
    const red = Math.round(left[0] + (right[0] - left[0]) * local);
    const green = Math.round(left[1] + (right[1] - left[1]) * local);
    const blue = Math.round(left[2] + (right[2] - left[2]) * local);
    output += fillRect(x + index * width / segments, y, width / segments + 0.2, height, rgb255(red, green, blue));
  }

  return output;
}

function headerCommands(brandImage?: PdfBrandImage | null): string {
  let output = "";
  output += fillRect(32, 742, 531, 72, rgb255(9, 9, 12));
  if (brandImage) {
    const displayWidth = 146;
    const displayHeight = Math.min(48, displayWidth * brandImage.height / brandImage.width);
    output += "q " + displayWidth + " 0 0 " + displayHeight + " 48 " + (790 - displayHeight) + " cm /Im1 Do Q\n";
  } else {
    output += textCommand("FastQue", 48, 780, 23, true, rgb255(255, 62, 87));
    output += textCommand("GOOD LOOKS | LESS WAITING", 48, 762, 7.8, true, "0.88 0.88 0.90");
  }
  output += textCommand("GOOD LOOKS. LESS WAITING.", 387, 768, 7.2, true, "0.82 0.80 0.83");
  output += gradientBand(32, 736, 531, 6);
  return output;
}

function footerCommands(): string {
  let output = "";
  output += gradientBand(32, 62, 531, 6);
  output += fillRect(32, 20, 531, 42, rgb255(13, 13, 18));
  output += centeredText("FastQue | Devdutta Cloud World (DCW)", 45, 9.2, true, "0.97 0.96 0.96");
  output += centeredText("fastque.com | GOOD LOOKS, LESS WAITING", 31, 7.6, false, "0.74 0.72 0.76");
  return output;
}

function moneyWordsBelow1000(value: number): string {
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  if (value === 0) return "";
  if (value < 20) return ones[value];
  if (value < 100) return tens[Math.floor(value / 10)] + (value % 10 ? " " + ones[value % 10] : "");
  return ones[Math.floor(value / 100)] + " Hundred" + (value % 100 ? " " + moneyWordsBelow1000(value % 100) : "");
}

export function numberToIndianWords(amount: number): string {
  let value = Math.max(0, Math.round(amount));
  if (value === 0) return "Zero Rupees";

  const parts: string[] = [];
  const crore = Math.floor(value / 10000000);
  if (crore) {
    parts.push(moneyWordsBelow1000(crore) + " Crore");
    value %= 10000000;
  }
  const lakh = Math.floor(value / 100000);
  if (lakh) {
    parts.push(moneyWordsBelow1000(lakh) + " Lakh");
    value %= 100000;
  }
  const thousand = Math.floor(value / 1000);
  if (thousand) {
    parts.push(moneyWordsBelow1000(thousand) + " Thousand");
    value %= 1000;
  }
  if (value) parts.push(moneyWordsBelow1000(value));
  return parts.join(" ") + " Rupees";
}

function salaryBreakdown(monthlyCtc: number) {
  const round = (value: number) => Math.round(value);
  const basic = round(monthlyCtc * 0.40);
  const hra = round(monthlyCtc * 0.16);
  const employerPf = round(monthlyCtc * 0.04);
  const insurance = round(monthlyCtc * 0.0056);
  const pfService = round(monthlyCtc * 0.0033);
  const statutoryBonus = round(monthlyCtc * 0.0333);
  const employeeCompensation = round(monthlyCtc * 0.0014);
  const specialAllowance = Math.max(
    0,
    round(monthlyCtc) - basic - hra - employerPf - insurance - pfService - statutoryBonus - employeeCompensation,
  );
  const grossEarnings = basic + hra + specialAllowance + statutoryBonus;
  const employeePf = employerPf;
  return {
    basic,
    hra,
    employerPf,
    insurance,
    pfService,
    statutoryBonus,
    employeeCompensation,
    specialAllowance,
    grossEarnings,
    employeePf,
    totalDeduction: employeePf,
    netSalary: Math.max(0, grossEarnings - employeePf),
  };
}

function drawTable(
  x: number,
  yTop: number,
  widths: number[],
  rows: Array<{ cells: string[]; bold?: boolean; fill?: string }>,
  rowHeight = 17,
): { commands: string; bottomY: number } {
  const totalWidth = widths.reduce((sum, value) => sum + value, 0);
  let output = "";
  let y = yTop;

  for (const row of rows) {
    const bottom = y - rowHeight;
    if (row.fill) output += fillRect(x, bottom, totalWidth, rowHeight, row.fill);
    output += "0.72 0.72 0.76 RG 0.55 w " + x + " " + bottom + " " + totalWidth + " " + rowHeight + " re S\n";

    let cellX = x;
    row.cells.forEach((cell, index) => {
      if (index > 0) output += strokeLine(cellX, bottom, cellX, y, "0.72 0.72 0.76", 0.55);
      const maxChars = Math.max(10, Math.floor(widths[index] / 4.2));
      const visible = ascii(cell);
      const clipped = visible.length > maxChars ? visible.slice(0, maxChars - 1) + "." : visible;
      output += textCommand(clipped, cellX + 6, bottom + 5.1, 8, Boolean(row.bold));
      cellX += widths[index];
    });

    y = bottom;
  }

  return { commands: output, bottomY: y };
}

export function buildOfferLetterPdf(
  data: OfferLetterData,
  brandImage?: PdfBrandImage | null,
): Uint8Array {
  const candidateName = data.candidateName.trim();
  const role = (data.role || "Employee").trim() || "Employee";
  const employeeCode = data.employeeCode?.trim() || "Pending onboarding";
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());
  const joiningLabel = data.joiningDate
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(data.joiningDate + "T00:00:00"))
    : "To be mutually agreed";

  const monthlyCtc = data.salaryBasis === "monthly" ? data.baseSalary : data.baseSalary / 12;
  const annualCtc = monthlyCtc * 12;
  const salary = salaryBreakdown(monthlyCtc);
  const pages: string[] = [];

  const addWrapped = (
    page: { commands: string; y: number },
    text: string,
    size = 8.8,
    leading = 11.7,
    maxChars = 106,
    bold = false,
    gap = 4,
  ) => {
    for (const line of wrap(text, maxChars)) {
      page.commands += textCommand(line, 48, page.y, size, bold);
      page.y -= leading;
    }
    page.y -= gap;
  };

  const page1 = { commands: headerCommands(brandImage), y: 718 };
  page1.commands += textCommand("Date:", 48, page1.y, 9.2, true);
  page1.commands += textCommand(dateLabel, 112, page1.y, 9.2);
  page1.y -= 18;
  addWrapped(page1, candidateName, 9.5, 13, 86, true, 1);
  if (data.address?.trim()) addWrapped(page1, data.address.trim(), 8.9, 12, 82, false, 1);
  if (data.email?.trim()) {
    page1.commands += textCommand("Email:", 48, page1.y, 9, true);
    page1.commands += textCommand(data.email.trim(), 112, page1.y, 9);
    page1.y -= 14;
  }
  if (data.phone?.trim()) {
    page1.commands += textCommand("Phone:", 48, page1.y, 9, true);
    page1.commands += textCommand(data.phone.trim(), 112, page1.y, 9);
    page1.y -= 14;
  }
  page1.commands += textCommand("Employee No:", 48, page1.y, 9, true);
  page1.commands += textCommand(employeeCode, 112, page1.y, 9);
  page1.y -= 23;

  page1.commands += centeredText("Offer Letter", page1.y, 12, true, "0.035 0.035 0.047");
  page1.commands += strokeLine(257, page1.y - 2, 338, page1.y - 2, "0.035 0.035 0.047", 0.7);
  page1.y -= 25;

  addWrapped(page1, "Dear " + candidateName + ",", 9.2, 13, 103, false, 6);
  addWrapped(
    page1,
    "We are pleased to appoint you in our organization as " + role + ", subject to the following terms and conditions:",
    9.1, 12.4, 106, false, 7,
  );
  addWrapped(
    page1,
    "1. Your employment will commence from " + joiningLabel + ". Your Annual CTC would be INR " +
      formatInr(annualCtc) + " per annum (" + numberToIndianWords(annualCtc) +
      " only), subject to the attached salary annexure and applicable deductions.",
  );
  addWrapped(
    page1,
    "2. You will fully perform the responsibilities assigned to your role in a professional manner and in accordance with lawful instructions, company policies, service standards and applicable customer requirements.",
  );
  addWrapped(
    page1,
    "3. During your employment you will protect confidential information, customer information, credentials, source code, business data and intellectual property and will use them only for authorized business purposes.",
  );
  addWrapped(
    page1,
    "4. You will avoid conflicts of interest, unauthorized commitments, improper payments and conduct that could be detrimental to FastQue, Devdutta Cloud World (DCW), its customers, partners or employees.",
  );
  addWrapped(
    page1,
    "5. Your work location, field assignment, remote-work arrangement, customer location or reasonable business travel may change according to operational requirements, subject to applicable law and your final employment terms.",
  );
  addWrapped(
    page1,
    "6. You will comply with applicable attendance, working-hours, information-security, safety, acceptable-use and code-of-conduct requirements communicated by the company.",
    8.8, 11.7, 106, false, 0,
  );
  page1.commands += footerCommands();
  pages.push(page1.commands);

  const page2 = { commands: headerCommands(brandImage), y: 718 };
  addWrapped(
    page2,
    "7. Either party may end the employment relationship in accordance with the final employment agreement and applicable law. Unless otherwise specified, the standard notice period is 30 days or salary in lieu where legally and contractually applicable.",
    8.9, 12, 105, false, 6,
  );
  addWrapped(
    page2,
    "8. Compensation will be paid through the company's authorized payroll process. Statutory contributions, taxes, deductions and benefits will apply according to eligibility, applicable law and the final payroll configuration.",
    8.9, 12, 105, false, 6,
  );
  addWrapped(
    page2,
    "9. This offer and continued employment are subject to satisfactory verification of the information, identity, qualifications, experience and documents provided during recruitment and onboarding.",
    8.9, 12, 105, false, 6,
  );
  addWrapped(
    page2,
    "10. The detailed salary structure is shown in the attached Salary Annexure. The annexure is an HR/payroll template and final statutory treatment will follow applicable law and approved company policy.",
    8.9, 12, 105, false, 6,
  );
  addWrapped(
    page2,
    "11. Your employment may also be governed by additional policies, confidentiality obligations, data-protection requirements, intellectual-property provisions and workplace rules communicated in writing.",
    8.9, 12, 105, false, 6,
  );
  addWrapped(
    page2,
    "12. This offer is governed by applicable laws of India. Any dispute-resolution mechanism, venue or jurisdiction will be as stated in the final employment agreement and applicable law.",
    8.9, 12, 105, false, 10,
  );
  addWrapped(
    page2,
    "At FastQue we are building a culture focused on customer trust, speed, ownership, quality and respectful collaboration. We welcome you to contribute to that culture and to the continuous improvement of our products and operations.",
    8.9, 12, 105, false, 8,
  );
  addWrapped(
    page2,
    "FastQue and DCW do not require candidates to make unauthorized cash or in-kind payments to employees or intermediaries in exchange for employment. Any such request should be reported to the company.",
    8.9, 12, 105, false, 12,
  );

  page2.commands += textCommand("ENDORSEMENT", 48, page2.y, 9.5, true, "0.035 0.035 0.047");
  page2.commands += strokeLine(48, page2.y - 2, 112, page2.y - 2, "0.035 0.035 0.047", 0.6);
  page2.y -= 18;
  addWrapped(
    page2,
    "I hereby confirm acceptance of the above offer and the terms and conditions stated in this letter, subject to the final employment agreement and onboarding formalities.",
    9, 12, 104, false, 18,
  );

  page2.commands += textCommand("For FastQue | Devdutta Cloud World (DCW)", 48, page2.y, 9, true);
  page2.commands += textCommand("Accepted and Agreed", 383, page2.y, 9, true);
  page2.y -= 46;
  page2.commands += strokeLine(48, page2.y, 220, page2.y, "0.12 0.12 0.15", 0.6);
  page2.commands += strokeLine(383, page2.y, 547, page2.y, "0.12 0.12 0.15", 0.6);
  page2.y -= 14;
  page2.commands += textCommand("(Authorized Signatory)", 48, page2.y, 8, false, "0.40 0.39 0.44");
  page2.commands += textCommand("Signature and date", 383, page2.y, 8, false, "0.40 0.39 0.44");
  page2.y -= 14;
  page2.commands += textCommand("Name: " + candidateName, 383, page2.y, 8, false, "0.40 0.39 0.44");
  page2.commands += footerCommands();
  pages.push(page2.commands);

  let page3 = headerCommands(brandImage);
  page3 += centeredText("Salary Annexure", 710, 11.5, true, "0.035 0.035 0.047");
  page3 += strokeLine(247, 707, 348, 707, "0.035 0.035 0.047", 0.7);
  page3 += textCommand("Employee No: " + employeeCode, 96, 685, 9);
  page3 += textCommand("Name: " + candidateName, 300, 685, 9);

  const annualRows = [
    { cells: ["Particulars", "Annual Amount (INR)"], bold: true, fill: "1 0.965 0.975" },
    { cells: ["Basic", formatInr(salary.basic * 12)] },
    { cells: ["House Rent Allowance", formatInr(salary.hra * 12)] },
    { cells: ["Special Allowance", formatInr(salary.specialAllowance * 12)] },
    { cells: ["Employer PF Contribution", formatInr(salary.employerPf * 12)] },
    { cells: ["Insurance", formatInr(salary.insurance * 12)] },
    { cells: ["PF Service Charges", formatInr(salary.pfService * 12)] },
    { cells: ["Statutory Bonus", formatInr(salary.statutoryBonus * 12)] },
    { cells: ["Employee Compensation", formatInr(salary.employeeCompensation * 12)] },
    { cells: ["Total Amount", formatInr(annualCtc)], bold: true },
    { cells: ["Amount in Words", numberToIndianWords(annualCtc)], bold: true },
  ];
  const annualTable = drawTable(96, 664, [214, 190], annualRows, 14);
  page3 += annualTable.commands;

  const monthlyRows = [
    { cells: ["Particulars", "Monthly Amount (INR)"], bold: true, fill: "1 0.965 0.975" },
    { cells: ["Basic", formatInr(salary.basic)] },
    { cells: ["House Rent Allowance", formatInr(salary.hra)] },
    { cells: ["Special Allowance", formatInr(salary.specialAllowance)] },
    { cells: ["Employer PF Contribution", formatInr(salary.employerPf)] },
    { cells: ["Insurance", formatInr(salary.insurance)] },
    { cells: ["PF Service Charges", formatInr(salary.pfService)] },
    { cells: ["Statutory Bonus", formatInr(salary.statutoryBonus)] },
    { cells: ["Employee Compensation", formatInr(salary.employeeCompensation)] },
    { cells: ["Total Amount", formatInr(monthlyCtc)], bold: true },
    { cells: ["Amount in Words", numberToIndianWords(monthlyCtc)], bold: true },
  ];
  const monthlyTable = drawTable(96, annualTable.bottomY - 10, [214, 190], monthlyRows, 14);
  page3 += monthlyTable.commands;

  page3 += centeredText("Net Pay Annexure", monthlyTable.bottomY - 28, 10.5, true, "0.035 0.035 0.047");
  const netRows = [
    { cells: ["EARNINGS", "Amount (INR)"], bold: true, fill: "1 0.965 0.975" },
    { cells: ["Basic", formatInr(salary.basic)] },
    { cells: ["House Rent Allowance", formatInr(salary.hra)] },
    { cells: ["Special Allowance", formatInr(salary.specialAllowance)] },
    { cells: ["Statutory Bonus", formatInr(salary.statutoryBonus)] },
    { cells: ["Gross Earnings", formatInr(salary.grossEarnings)], bold: true },
    { cells: ["DEDUCTIONS", "Amount (INR)"], bold: true, fill: "1 0.965 0.975" },
    { cells: ["Employee PF", formatInr(salary.employeePf)] },
    { cells: ["Total Deduction", formatInr(salary.totalDeduction)], bold: true },
    { cells: ["Net Salary", formatInr(salary.netSalary)], bold: true },
  ];
  const netTable = drawTable(130, monthlyTable.bottomY - 38, [200, 135], netRows, 13);
  page3 += netTable.commands;

  let noteY = Math.max(104, netTable.bottomY - 16);
  for (const line of wrap(
    "Note: This salary annexure is an illustrative payroll template generated from the entered salary/CTC. Statutory contributions, tax deductions, insurance, bonus eligibility and final net pay are subject to applicable law and approved company payroll policy.",
    102,
  )) {
    page3 += textCommand(line, 62, noteY, 7.4, false, "0.40 0.39 0.44");
    noteY -= 10;
  }
  page3 += footerCommands();
  pages.push(page3);

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  let firstPageObject = 5;
  if (brandImage) {
    const imageStream = brandImage.hex + ">\n";
    const imageLength = new TextEncoder().encode(imageStream).length;
    objects[5] =
      "<< /Type /XObject /Subtype /Image /Width " + brandImage.width +
      " /Height " + brandImage.height +
      " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length " +
      imageLength + " >>\nstream\n" + imageStream + "endstream";
    firstPageObject = 6;
  }

  const pageIds = pages.map((_, index) => firstPageObject + index * 2);
  objects[2] =
    "<< /Type /Pages /Kids [" + pageIds.map((id) => id + " 0 R").join(" ") +
    "] /Count " + pages.length + " >>";

  pages.forEach((pageContent, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const xObjects = brandImage ? " /XObject << /Im1 5 0 R >>" : "";
    objects[pageId] =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>" +
      xObjects + " >> /Contents " + contentId + " 0 R >>";
    const contentLength = new TextEncoder().encode(pageContent).length;
    objects[contentId] =
      "<< /Length " + contentLength + " >>\nstream\n" + pageContent + "endstream";
  });

  const encoder = new TextEncoder();
  let pdf = "%PDF-1.4\n%FastQue\n";
  const offsets: number[] = [0];

  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = encoder.encode(pdf).length;
    pdf += id + " 0 obj\n" + objects[id] + "\nendobj\n";
  }

  const xrefOffset = encoder.encode(pdf).length;
  pdf += "xref\n0 " + objects.length + "\n";
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id < objects.length; id += 1) {
    pdf += String(offsets[id]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += "trailer\n<< /Size " + objects.length + " /Root 1 0 R >>\nstartxref\n" +
    xrefOffset + "\n%%EOF\n";

  return encoder.encode(pdf);
}
