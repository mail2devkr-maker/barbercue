import { MAX_CONTACTS, MAX_PHONE_LENGTH } from "./contact-preview";

// Contact file reader (owner issue #14). Turns a phone's contacts export (.vcf), a spreadsheet export (.csv) or a plain list
// (.txt) into the one-number-per-line text the contact list check already understands. It runs ENTIRELY in the browser: the
// file is read from the device and nothing is uploaded; only the numbers left in the box are sent, and only when the owner
// presses Check.
//
// It never guesses. A column is used only when its header says it is a phone number (or the file has a single column);
// anything that is not a plain phone number - letters, formulas, links - is left out and reported.

/** A contacts export is small; anything bigger is not a contact list this page should read into memory. */
export const MAX_FILE_BYTES = 512 * 1024;
export const ACCEPTED_EXTENSIONS = [".csv", ".txt", ".vcf", ".vcard"] as const;

export type FileFormat = "vcard" | "csv" | "text";

export interface FileProblem {
  where: string;
  message: string;
}

export interface FileReadResult {
  format: FileFormat;
  /** One phone number per line, ready for the list box. */
  text: string;
  /** How many numbers made it into `text`. */
  found: number;
  problems: FileProblem[];
}

const PHONE_HEADERS = ["phone", "phone number", "mobile", "mobile number", "mobile phone", "cell", "cell phone", "cellphone", "telephone", "tel", "contact number", "contact", "whatsapp", "number"];

/** A plain phone number: digits with an optional leading + and the usual separators, nothing else. */
export function plainPhone(value: string): string | null {
  const v = value.trim();
  if (!v || v.length > MAX_PHONE_LENGTH) return null;
  if (!/^\+?\(?[0-9][0-9\s().\-]*$/.test(v)) return null;
  const digits = v.replace(/\D/g, "");
  return digits.length >= 6 ? v : null;
}

export function hasAcceptedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Splits one CSV line, honouring double quotes and doubled quotes; the delimiter is a comma, semicolon or tab. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { cells.push(cell); cell = ""; }
    else cell += c;
  }
  cells.push(cell);
  return cells.map((x) => x.trim());
}

function pickDelimiter(headerLine: string): string {
  const counts = [",", ";", "\t"].map((d) => [d, headerLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

function finish(format: FileFormat, numbers: string[], problems: FileProblem[]): FileReadResult {
  let kept = numbers;
  if (numbers.length > MAX_CONTACTS) {
    kept = numbers.slice(0, MAX_CONTACTS);
    problems.push({ where: "File", message: `The file has ${numbers.length} numbers. Only the first ${MAX_CONTACTS} were read; check the rest in another batch.` });
  }
  return { format, text: kept.join("\n"), found: kept.length, problems };
}

function readVcard(content: string): FileReadResult {
  // Unfold: a line that starts with a space or tab continues the previous one.
  const lines = content.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const numbers: string[] = [];
  const problems: FileProblem[] = [];
  let card = 0;
  let inCard = false;
  let tels: string[] = [];
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VCARD") { inCard = true; card += 1; tels = []; continue; }
    if (upper === "END:VCARD") {
      if (inCard) {
        const where = `Contact ${card}`;
        const usable = tels.map((t) => plainPhone(t)).filter((t): t is string => t !== null);
        if (tels.length === 0) problems.push({ where, message: "No phone number." });
        else if (usable.length === 0) problems.push({ where, message: "Its phone number is not a plain number." });
        else {
          numbers.push(usable[0]);
          if (usable.length > 1) problems.push({ where, message: "Has more than one number; only the first was used." });
        }
      }
      inCard = false;
      continue;
    }
    if (inCard && /^TEL[;:]/i.test(line.trim())) {
      const value = line.slice(line.indexOf(":") + 1).trim();
      tels.push(value.replace(/^tel:/i, ""));
    }
  }
  return finish("vcard", numbers, problems);
}

function readTable(content: string, format: "csv" | "text"): FileReadResult {
  const lines = content.replace(/\r\n|\r/g, "\n").split("\n").filter((l) => l.trim() !== "");
  const numbers: string[] = [];
  const problems: FileProblem[] = [];
  if (lines.length === 0) return finish(format, numbers, problems);

  const delimiter = pickDelimiter(lines[0]);
  const first = splitCsvLine(lines[0], delimiter);
  const headerIndex = first.findIndex((h) => PHONE_HEADERS.includes(h.trim().toLowerCase().replace(/[_\-]+/g, " ")));
  const looksLikeHeader = headerIndex >= 0 && plainPhone(first[headerIndex]) === null;
  let column = -1;
  let start = 0;
  if (looksLikeHeader) {
    column = headerIndex;
    start = 1;
  } else if (first.length === 1) {
    column = 0;
  } else if (plainPhone(first[0]) !== null) {
    column = 0; // no header, and the first column is itself a phone number
  } else {
    problems.push({ where: "Line 1", message: "Could not tell which column holds the phone number. Add a header such as “Phone” or “Mobile”." });
    return finish(format, numbers, problems);
  }

  for (let i = start; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delimiter);
    const cell = cells[column] ?? "";
    const where = `Line ${i + 1}`;
    if (!cell) { problems.push({ where, message: "No phone number on this line." }); continue; }
    const phone = plainPhone(cell);
    if (!phone) { problems.push({ where, message: "Not a plain phone number, so it was left out." }); continue; }
    numbers.push(phone);
  }
  return finish(format, numbers, problems);
}

/** Reads the text of a contacts file. `fileName` only chooses how to read it; the content decides whether it is a vCard. */
export function contactFileToList(content: string, fileName: string): FileReadResult {
  const clean = content.replace(/^﻿/, "");
  if (/BEGIN:VCARD/i.test(clean)) return readVcard(clean);
  return readTable(clean, fileName.toLowerCase().endsWith(".csv") ? "csv" : "text");
}
