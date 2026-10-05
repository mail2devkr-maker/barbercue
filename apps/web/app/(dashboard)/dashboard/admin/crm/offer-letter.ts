export type SalaryBasis = "monthly" | "annual";

export type ResumeHints = {
  candidateName: string;
  email: string;
  phone: string;
  role: string;
  address: string;
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
  if (words.length < 1 || words.length > 6) return "";
  if (!words.every((word) => /^[A-Za-z][A-Za-z.'-]*$/.test(word))) return "";
  return titleCase(cleaned);
}

function normalizedResumeLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function looksLikePersonName(value: string): boolean {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > 60 || /[@\d]/.test(cleaned)) return false;
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 6) return false;
  return words.every((word) => /^[A-Za-z][A-Za-z.'-]*$/.test(word));
}

function candidateNameFromText(text: string): string {
  const lines = normalizedResumeLines(text).slice(0, 80);
  const heading =
    /^(resume|curriculum vitae|cv|profile|summary|objective|career objective|professional summary|personal profile|personal details|contact|contact details|experience|work experience|employment history|education|educational qualification|academic qualification|qualification|qualifications|skills|technical skills|key skills|projects?|certifications?|achievements?|declaration|languages?|interests?|hobbies|references?|address|present address|current address|permanent address|year of passing|year|board|university|college|school|percentage|marks|degree|course)$/i;

  for (const line of lines) {
    const explicit = line.match(
      /^(?:candidate\s+name|applicant\s+name|full\s+name|name)\s*[:\-]\s*(.+)$/i,
    );
    if (explicit?.[1] && looksLikePersonName(explicit[1])) {
      return explicit[1].trim();
    }
  }

  for (const line of lines.slice(0, 25)) {
    const cleaned = line.replace(/^[•\-–—]+\s*/, "").trim();
    if (
      heading.test(cleaned) ||
      cleaned.includes("@") ||
      /\b(?:phone|mobile|email|address|dob|date of birth|gender|nationality)\b/i.test(cleaned) ||
      /\d{4,}/.test(cleaned) ||
      cleaned.includes(":")
    ) {
      continue;
    }
    if (looksLikePersonName(cleaned)) return cleaned;
  }

  return "";
}

function addressFromText(text: string): string {
  const lines = normalizedResumeLines(text).slice(0, 160);
  const sectionStop =
    /^(?:email|e-mail|phone|mobile|contact|dob|date of birth|gender|nationality|marital status|education|qualification|qualifications|experience|work experience|skills|technical skills|projects?|declaration|languages?|references?)\s*[:\-]?/i;
  const headingOnly =
    /^(?:education|qualification|qualifications|experience|work experience|skills|technical skills|projects?|declaration|languages?|references?|year of passing)$/i;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(
      /^(?:(?:present|current|permanent|residential|postal|correspondence|communication)\s+)?address\s*[:\-]?\s*(.*)$/i,
    );
    if (!match) continue;

    const parts: string[] = [];
    if (match[1]?.trim()) parts.push(match[1].trim());

    for (let next = index + 1; next < Math.min(lines.length, index + 5); next += 1) {
      const candidate = lines[next].trim();
      if (
        !candidate ||
        sectionStop.test(candidate) ||
        headingOnly.test(candidate) ||
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(candidate) ||
        /(?<!\d)(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}(?!\d)/.test(candidate)
      ) {
        break;
      }
      parts.push(candidate);
      if (/\b[1-9]\d{5}\b/.test(candidate)) break;
    }

    const joined = parts.join(", ").replace(/\s+,/g, ",").trim();
    if (joined.length >= 5) return joined.slice(0, 240);
  }

  const pinIndex = lines.findIndex((line) => /\b[1-9]\d{5}\b/.test(line));
  if (pinIndex >= 0) {
    const fallback = lines
      .slice(Math.max(0, pinIndex - 2), pinIndex + 1)
      .filter(
        (line) =>
          !sectionStop.test(line) &&
          !headingOnly.test(line) &&
          !/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(line),
      )
      .join(", ")
      .trim();
    if (fallback.length >= 8) return fallback.slice(0, 240);
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

function concreteArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function decompressBytes(
  bytes: Uint8Array,
  format: "deflate" | "deflate-raw",
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([concreteArrayBuffer(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream(format));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");
  const targets = new Set([
    "word/document.xml",
    "word/header1.xml",
    "word/header2.xml",
    "word/header3.xml",
    "word/footer1.xml",
  ]);
  const parts: string[] = [];

  for (let offset = 0; offset + 46 <= bytes.byteLength; ) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      offset += 1;
      continue;
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    const filename = decoder.decode(bytes.slice(nameStart, nameEnd));

    if (targets.has(filename) && localHeaderOffset + 30 <= bytes.byteLength) {
      const localNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;

      if (dataEnd <= bytes.byteLength) {
        let xmlBytes = bytes.slice(dataStart, dataEnd);
        if (method === 8) {
          xmlBytes = await decompressBytes(xmlBytes, "deflate-raw");
        }
        if (method === 0 || method === 8) {
          const xml = decoder.decode(xmlBytes)
            .replace(/<w:tab[^>]*\/>/g, "\t")
            .replace(/<w:br[^>]*\/>/g, "\n")
            .replace(/<\/w:p>/g, "\n")
            .replace(/<[^>]+>/g, "");
          parts.push(decodeXmlEntities(xml));
        }
      }
    }

    offset = nameEnd + extraLength + commentLength;
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n");
}

function decodePdfLiteral(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      output += char;
      continue;
    }

    const next = value[index + 1];
    if (next === undefined) break;
    if (next === "n") {
      output += "\n";
      index += 1;
    } else if (next === "r") {
      output += "\r";
      index += 1;
    } else if (next === "t") {
      output += "\t";
      index += 1;
    } else if (next === "b") {
      output += "\b";
      index += 1;
    } else if (next === "f") {
      output += "\f";
      index += 1;
    } else if (next === "\n" || next === "\r") {
      index += 1;
      if (next === "\r" && value[index + 1] === "\n") index += 1;
    } else if (/[0-7]/.test(next)) {
      let octal = next;
      let consumed = 1;
      while (consumed < 3 && /[0-7]/.test(value[index + 1 + consumed] ?? "")) {
        octal += value[index + 1 + consumed];
        consumed += 1;
      }
      output += String.fromCharCode(parseInt(octal, 8));
      index += consumed;
    } else {
      output += next;
      index += 1;
    }
  }
  return output;
}

function decodePdfHex(value: string): string {
  const cleaned = value.replace(/\s+/g, "");
  const padded = cleaned.length % 2 === 0 ? cleaned : cleaned + "0";
  const bytes = new Uint8Array(padded.length / 2);

  for (let index = 0; index < padded.length; index += 2) {
    bytes[index / 2] = parseInt(padded.slice(index, index + 2), 16);
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let output = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      output += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    }
    return output;
  }

  return new TextDecoder("latin1").decode(bytes);
}

function extractPdfTextOperators(streamText: string): string {
  const lines: string[] = [];
  const tokenRegex = /(\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>)\s*Tj|\[((?:.|\n|\r)*?)\]\s*TJ/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(streamText)) !== null) {
    if (match[1]) {
      const token = match[1];
      lines.push(
        token.startsWith("(")
          ? decodePdfLiteral(token.slice(1, -1))
          : decodePdfHex(match[2] ?? ""),
      );
      continue;
    }

    const arrayBody = match[3] ?? "";
    const fragments: string[] = [];
    const fragmentRegex = /\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>/g;
    let fragment: RegExpExecArray | null;
    while ((fragment = fragmentRegex.exec(arrayBody)) !== null) {
      const token = fragment[0];
      fragments.push(
        token.startsWith("(")
          ? decodePdfLiteral(token.slice(1, -1))
          : decodePdfHex(fragment[1] ?? ""),
      );
    }
    if (fragments.length) lines.push(fragments.join(""));
  }

  return lines.join("\n");
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const raw = new TextDecoder("latin1").decode(bytes);
  const parts: string[] = [extractPdfTextOperators(raw)];
  let cursor = 0;

  while (cursor < raw.length) {
    const streamIndex = raw.indexOf("stream", cursor);
    if (streamIndex < 0) break;
    const endIndex = raw.indexOf("endstream", streamIndex + 6);
    if (endIndex < 0) break;

    let dataStart = streamIndex + 6;
    if (raw[dataStart] === "\r" && raw[dataStart + 1] === "\n") dataStart += 2;
    else if (raw[dataStart] === "\n" || raw[dataStart] === "\r") dataStart += 1;

    let dataEnd = endIndex;
    while (dataEnd > dataStart && (raw[dataEnd - 1] === "\n" || raw[dataEnd - 1] === "\r")) {
      dataEnd -= 1;
    }

    const dictionaryStart = Math.max(0, raw.lastIndexOf("<<", streamIndex));
    const dictionary = raw.slice(dictionaryStart, streamIndex);
    const streamBytes = bytes.slice(dataStart, dataEnd);

    try {
      let decoded = streamBytes;
      if (/\/FlateDecode\b/.test(dictionary)) {
        decoded = await decompressBytes(streamBytes, "deflate");
      }
      const decodedText = new TextDecoder("latin1").decode(decoded);
      const extracted = extractPdfTextOperators(decodedText);
      if (extracted) parts.push(extracted);
    } catch {
      // Some PDF streams use filters or encodings this lightweight extractor cannot decode.
    }

    cursor = endIndex + 9;
  }

  return parts.filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n");
}

async function extractResumeText(file: File): Promise<{ reliableText: string; searchable: string }> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "txt" || file.type.startsWith("text/")) {
    const text = await file.text();
    return { reliableText: text, searchable: text };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > 8 * 1024 * 1024) {
    return { reliableText: "", searchable: "" };
  }

  const rawSearchable = new TextDecoder("latin1")
    .decode(bytes)
    .replace(/[^\x20-\x7E\r\n]+/g, " ");

  if (extension === "pdf") {
    const text = await extractPdfText(bytes);
    return { reliableText: text, searchable: text + "\n" + rawSearchable };
  }

  if (extension === "docx") {
    const text = await extractDocxText(bytes);
    return { reliableText: text, searchable: text + "\n" + rawSearchable };
  }

  return { reliableText: "", searchable: rawSearchable };
}

export async function extractResumeHints(file: File): Promise<ResumeHints> {
  const { reliableText, searchable } = await extractResumeText(file);

  const email =
    searchable.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? "";
  const phone =
    searchable.match(/(?<!\d)(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}(?!\d)/)?.[0]?.trim() ?? "";

  return {
    candidateName: candidateNameFromText(reliableText) || guessCandidateName(file.name),
    email,
    phone,
    role: roleFromText(reliableText || searchable),
    address: addressFromText(reliableText || searchable),
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

      context.fillStyle = "#0d0d12";
      context.fillRect(0, 0, width, height);
      context.globalAlpha = 0.82;
      context.drawImage(image, 0, 0, width, height);
      context.globalAlpha = 1;
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

const COMPANY_SIGNATURE_CONTOURS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [[[497,154],[483,145],[448,140],[445,145],[467,149],[467,153],[386,148],[399,120],[405,123],[410,118],[403,110],[428,59],[430,41],[392,92],[387,91],[397,84],[398,78],[382,86],[383,57],[378,60],[375,89],[362,93],[341,91],[346,75],[350,80],[363,79],[375,66],[369,57],[354,55],[330,72],[332,89],[319,95],[312,80],[335,20],[331,1],[325,1],[316,10],[303,48],[304,71],[288,75],[277,84],[269,75],[261,75],[245,88],[234,79],[217,93],[218,82],[214,78],[195,90],[180,81],[166,83],[152,72],[123,74],[121,63],[97,43],[67,33],[30,36],[14,43],[4,54],[9,76],[36,90],[25,134],[10,170],[14,171],[37,147],[50,142],[61,155],[37,161],[29,172],[50,184],[98,194],[101,200],[109,196],[204,209],[278,209],[316,203],[345,192],[364,179],[384,154],[493,159]],[[101,189],[69,184],[39,170],[60,160],[79,165],[98,159],[103,170]],[[114,153],[118,155],[117,178],[108,169],[108,160]],[[105,191],[108,178],[115,183],[121,181],[125,152],[243,149],[377,154],[365,172],[343,188],[290,204],[204,205]],[[115,143],[114,149],[111,147]],[[93,115],[96,149],[67,154],[58,143]],[[86,108],[82,118],[58,137],[62,128]],[[192,100],[184,108],[180,106]],[[116,87],[114,109],[107,105],[107,100]],[[163,96],[175,86],[191,92],[173,102]],[[412,81],[378,150],[279,145],[124,148],[120,144],[118,129],[125,114],[156,98],[165,106],[185,112],[194,105],[197,95],[211,85],[210,108],[232,84],[238,90],[235,107],[239,108],[245,94],[267,79],[268,108],[284,113],[298,107],[310,94],[317,99],[335,93],[352,98],[375,94],[381,104]],[[301,76],[306,82],[305,89],[287,108],[278,108],[276,93],[286,82]],[[161,83],[158,92],[143,102],[123,106],[124,79],[148,76]],[[346,64],[360,59],[365,67],[371,67],[355,75]],[[90,45],[99,53],[94,58],[97,66],[101,57],[108,61],[95,98],[72,110],[54,132],[50,131],[48,138],[28,146],[42,91],[71,96],[91,94],[45,87],[44,61],[37,84],[22,79],[9,67],[9,55],[38,39],[69,38]],[[328,8],[328,33],[311,73],[307,66],[310,34],[318,15]]];

function companySignatureCommands(x: number, y: number, width: number): string {
  const sourceWidth = 500;
  const sourceHeight = 212;
  const scale = width / sourceWidth;
  let output = "0.97 0.96 0.96 rg\n";

  for (const contour of COMPANY_SIGNATURE_CONTOURS) {
    if (contour.length < 3) continue;
    const [firstX, firstY] = contour[0];
    output += (x + firstX * scale).toFixed(2) + " " +
      (y + (sourceHeight - firstY) * scale).toFixed(2) + " m\n";
    for (let index = 1; index < contour.length; index += 1) {
      const [pointX, pointY] = contour[index];
      output += (x + pointX * scale).toFixed(2) + " " +
        (y + (sourceHeight - pointY) * scale).toFixed(2) + " l\n";
    }
    output += "h\n";
  }

  output += "f*\n";
  return output;
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
  rgb = "0.97 0.96 0.96",
): string {
  return `BT /${bold ? "F2" : "F1"} ${size} Tf ${rgb} rg 1 0 0 1 ${x} ${y} Tm (${pdfEscape(text)}) Tj ET\n`;
}

function centeredText(
  text: string,
  y: number,
  size = 10,
  bold = false,
  rgb = "0.97 0.96 0.96",
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
  output += fillRect(0, 0, 595, 842, rgb255(9, 9, 12));
  output += fillRect(32, 742, 531, 72, rgb255(13, 13, 18));
  if (brandImage) {
    const displayWidth = 136;
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
  output += centeredText("support@fastque.com  |  fastque.com", 37, 8.6, true, "0.93 0.92 0.94");
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
  const employerPf = 0;
  const insurance = 0;
  const pfService = 0;
  const statutoryBonus = round(monthlyCtc * 0.0333);
  const employeeCompensation = 0;
  const specialAllowance = Math.max(
    0,
    round(monthlyCtc) - basic - hra - employerPf - insurance - pfService - statutoryBonus - employeeCompensation,
  );
  const grossEarnings = basic + hra + specialAllowance + statutoryBonus;
  const employeePf = 0;
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
  page1.y -= 14;
  page1.commands += textCommand("Probation:", 48, page1.y, 9, true);
  page1.commands += textCommand("3 months (extendable based on performance)", 112, page1.y, 9, true);
  page1.y -= 23;

  page1.commands += centeredText("Offer Letter", page1.y, 12, true, "0.97 0.96 0.96");
  page1.commands += strokeLine(257, page1.y - 2, 338, page1.y - 2, "0.97 0.96 0.96", 0.7);
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
    "2. You are being appointed on a probation period of three (3) months from your joining date. The probation period may be extended by the company based on your performance and performance assessment during probation.",
  );
  addWrapped(
    page1,
    "3. You will fully perform the responsibilities assigned to your role in a professional manner and in accordance with lawful instructions, company policies, service standards and applicable customer requirements.",
  );
  addWrapped(
    page1,
    "4. During your employment you will protect confidential information, customer information, credentials, source code, business data and intellectual property and will use them only for authorized business purposes.",
  );
  addWrapped(
    page1,
    "5. You will avoid conflicts of interest, unauthorized commitments, improper payments and conduct that could be detrimental to Fastque Digital Technology Private Limited, its customers, partners or employees.",
  );
  addWrapped(
    page1,
    "6. Your work location, field assignment, remote-work arrangement, customer location or reasonable business travel may change according to operational requirements, subject to applicable law and your final employment terms.",
    8.8, 11.7, 106, false, 0,
  );
  page1.commands += footerCommands();
  pages.push(page1.commands);

  const page2 = { commands: headerCommands(brandImage), y: 718 };
  addWrapped(
    page2,
    "7. You will comply with applicable attendance, working-hours, information-security, safety, acceptable-use and code-of-conduct requirements communicated by the company.",
    8.9, 12, 105, false, 6,
  );
  addWrapped(
    page2,
    "8. If you wish to resign from employment, you are required to provide at least one (1) month / 30 days prior written notice to the company. Any reduction or waiver of this notice period will be subject to written company approval and applicable law.",
    8.9, 12, 105, false, 6,
  );
  addWrapped(
    page2,
    "9. Compensation will be paid through the company's authorized payroll process. Statutory contributions, taxes, deductions and benefits will apply according to eligibility, applicable law and the final payroll configuration.",
    8.9, 12, 105, false, 6,
  );
  addWrapped(
    page2,
    "10. This offer and continued employment are subject to satisfactory verification of the information, identity, qualifications, experience and documents provided during recruitment and onboarding.",
    8.9, 12, 105, false, 6,
  );
  addWrapped(
    page2,
    "11. The detailed salary structure is shown in the attached Salary Annexure. The annexure is an HR/payroll template and final statutory treatment will follow applicable law and approved company policy.",
    8.9, 12, 105, false, 6,
  );
  addWrapped(
    page2,
    "12. Your employment may also be governed by additional policies, confidentiality obligations, data-protection requirements, intellectual-property provisions and workplace rules communicated in writing.",
    8.9, 12, 105, false, 6,
  );
  addWrapped(
    page2,
    "13. This offer is governed by applicable laws of India. Any dispute-resolution mechanism, venue or jurisdiction will be as stated in the final employment agreement and applicable law.",
    8.9, 12, 105, false, 8,
  );
  addWrapped(
    page2,
    "At FastQue we are building a culture focused on customer trust, speed, ownership, quality and respectful collaboration. We welcome you to contribute to that culture and to the continuous improvement of our products and operations.",
    8.9, 12, 105, false, 8,
  );
  addWrapped(
    page2,
    "Fastque Digital Technology Private Limited does not require candidates to make unauthorized cash or in-kind payments to employees or intermediaries in exchange for employment. Any such request should be reported to the company.",
    8.9, 12, 105, false, 12,
  );

  page2.commands += textCommand("ENDORSEMENT", 48, page2.y, 9.5, true, "0.97 0.96 0.96");
  page2.commands += strokeLine(48, page2.y - 2, 112, page2.y - 2, "0.97 0.96 0.96", 0.6);
  page2.y -= 18;
  addWrapped(
    page2,
    "I hereby confirm acceptance of the above offer and the terms and conditions stated in this letter, subject to the final employment agreement and onboarding formalities.",
    9, 12, 104, false, 18,
  );

  page2.commands += textCommand("Fastque Digital Technology Private Limited", 48, page2.y, 7.6, true);
  page2.commands += textCommand("Accepted and Agreed", 383, page2.y, 9, true);
  const signatureBottom = page2.y - 72;
  page2.commands += companySignatureCommands(48, signatureBottom, 150);
  const signatureLineY = signatureBottom - 4;
  page2.commands += strokeLine(48, signatureLineY, 220, signatureLineY, "0.72 0.70 0.75", 0.6);
  page2.commands += strokeLine(383, signatureLineY, 547, signatureLineY, "0.72 0.70 0.75", 0.6);
  page2.y = signatureLineY - 14;
  page2.commands += textCommand("(Authorized Signatory)", 48, page2.y, 8, false, "0.72 0.70 0.75");
  page2.commands += textCommand("Signature and date", 383, page2.y, 8, false, "0.72 0.70 0.75");
  page2.y -= 14;
  page2.commands += textCommand("Name: " + candidateName, 383, page2.y, 8, false, "0.72 0.70 0.75");
  page2.commands += footerCommands();
  pages.push(page2.commands);

  let page3 = headerCommands(brandImage);
  page3 += centeredText("Salary Annexure", 710, 11.5, true, "0.97 0.96 0.96");
  page3 += strokeLine(247, 707, 348, 707, "0.97 0.96 0.96", 0.7);
  page3 += textCommand("Employee No: " + employeeCode, 96, 685, 9);
  page3 += textCommand("Name: " + candidateName, 300, 685, 9);

  const annualRows = [
    { cells: ["Particulars", "Annual Amount (INR)"], bold: true, fill: "0.09 0.075 0.08" },
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
    { cells: ["Particulars", "Monthly Amount (INR)"], bold: true, fill: "0.09 0.075 0.08" },
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

  page3 += centeredText("Net Pay Annexure", monthlyTable.bottomY - 28, 10.5, true, "0.97 0.96 0.96");
  const netRows = [
    { cells: ["EARNINGS", "Amount (INR)"], bold: true, fill: "0.09 0.075 0.08" },
    { cells: ["Basic", formatInr(salary.basic)] },
    { cells: ["House Rent Allowance", formatInr(salary.hra)] },
    { cells: ["Special Allowance", formatInr(salary.specialAllowance)] },
    { cells: ["Statutory Bonus", formatInr(salary.statutoryBonus)] },
    { cells: ["Gross Earnings", formatInr(salary.grossEarnings)], bold: true },
    { cells: ["DEDUCTIONS", "Amount (INR)"], bold: true, fill: "0.09 0.075 0.08" },
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
    page3 += textCommand(line, 62, noteY, 7.4, false, "0.72 0.70 0.75");
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
