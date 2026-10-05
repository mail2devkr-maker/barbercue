export type SalaryBasis = "monthly" | "annual";

export type ResumeHints = {
  candidateName: string;
  email: string;
  phone: string;
  role: string;
};

export type OfferLetterData = {
  candidateName: string;
  email?: string;
  phone?: string;
  role?: string;
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
    maximumFractionDigits: 2,
  }).format(amount);
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

export function buildOfferLetterPdf(data: OfferLetterData): Uint8Array {
  const candidateName = data.candidateName.trim();
  const role = (data.role || "Employee").trim() || "Employee";
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());

  const joiningLabel = data.joiningDate
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }).format(new Date(`${data.joiningDate}T00:00:00`))
    : "To be mutually agreed";

  const salaryText =
    data.salaryBasis === "monthly"
      ? `INR ${formatInr(data.baseSalary)} per month (INR ${formatInr(data.baseSalary * 12)} annualized)`
      : `INR ${formatInr(data.baseSalary)} per annum`;

  const pages: string[] = [];
  let commands = "";
  let y = 790;

  const newPage = () => {
    if (commands) pages.push(commands);
    commands = "";
    y = 790;
  };

  const ensureSpace = (height: number) => {
    if (y - height < 58) newPage();
  };

  const addText = (
    text: string,
    size = 10.5,
    bold = false,
    gap = 16,
    color?: string,
  ) => {
    ensureSpace(gap + 4);
    commands += textCommand(text, 48, y, size, bold, color);
    y -= gap;
  };

  const addParagraph = (text: string) => {
    const lines = wrap(text, 89);
    ensureSpace(lines.length * 15 + 10);
    for (const line of lines) {
      commands += textCommand(line, 48, y, 10.2, false);
      y -= 15;
    }
    y -= 7;
  };

  commands += textCommand("FastQue", 48, y, 24, true, "0.97 0.20 0.37");
  commands += textCommand("GOOD LOOKS | LESS WAITING", 48, y - 18, 8.5, true, "0.52 0.52 0.58");
  commands += "0.97 0.20 0.37 RG 1.2 w 48 744 m 547 744 l S\n";
  y = 716;

  addText("OFFER LETTER", 17, true, 28, "0.08 0.08 0.10");
  addText(`Date: ${dateLabel}`, 10, false, 17);
  addText(`To: ${candidateName}`, 11, true, 17);
  if (data.email) addText(`Email: ${data.email}`, 9.5, false, 15);
  if (data.phone) addText(`Phone: ${data.phone}`, 9.5, false, 15);
  y -= 5;

  addText(`Subject: Offer of Employment - ${role}`, 11, true, 22);
  addText(`Dear ${candidateName},`, 10.5, false, 20);

  addParagraph(
    `We are pleased to offer you employment with FastQue, powered by Devdutta Cloud World (DCW), in the role of ${role}. We look forward to the experience, commitment, and energy you will bring to the team.`,
  );

  addText("Compensation", 12, true, 20, "0.12 0.12 0.15");
  addText(`Base salary: ${salaryText}`, 10.3, true, 17);
  addText(`Proposed joining date: ${joiningLabel}`, 10.3, false, 22);

  addParagraph(
    "The amount above records base salary only. Statutory deductions, incentives, reimbursements, benefits, probation, leave, working arrangements, notice obligations, confidentiality, intellectual-property obligations, and other employment terms are governed by the final employment agreement and applicable company policies.",
  );
  addParagraph(
    "This offer is subject to satisfactory verification of the information and documents provided during recruitment and completion of the required onboarding formalities.",
  );
  addParagraph(
    "Please confirm your acceptance by signing and returning this letter, or by completing the acceptance process communicated by the company.",
  );

  addText("Sincerely,", 10.5, false, 18);
  addText("HR Team", 10.5, true, 16);
  addText("FastQue | Devdutta Cloud World (DCW)", 9.5, false, 24);

  addText("Candidate acceptance", 11, true, 20);
  addParagraph(
    "I accept the offer described above, subject to the final employment terms and onboarding requirements.",
  );
  addText("Signature: ______________________________", 9.5, false, 17);
  addText("Date: __________________", 9.5, false, 17);

  if (commands) pages.push(commands);

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  pages.forEach((content, index) => {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    const contentLength = new TextEncoder().encode(content).length;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${contentLength} >>\nstream\n${content}endstream`;
  });

  const encoder = new TextEncoder();
  let pdf = "%PDF-1.4\n%FastQue\n";
  const offsets: number[] = [0];

  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = encoder.encode(pdf).length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return encoder.encode(pdf);
}
