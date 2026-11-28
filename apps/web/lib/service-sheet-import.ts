/**
 * Read a salon's service list from an Excel (.xlsx) or CSV file, entirely in the browser.
 * No upload and no extra dependency: .xlsx is a ZIP of XML files, inflated with the
 * built-in DecompressionStream("deflate-raw").
 *
 * Expected columns (header names are matched loosely, any order, extra columns ignored):
 *   Service name | Category | Gender | Price | Price type | Discounted price | Duration (min) | Description
 */

export interface SheetServiceRow {
  serviceName: string;
  category: string | null;
  applicableGender: "MEN" | "WOMEN" | "UNISEX" | null;
  basePrice: number | null;
  priceType: "FIXED" | "STARTS_FROM";
  discountedPrice: number | null;
  durationMinutes: number | null;
  description: string | null;
  /** Fields that were missing or could not be read; the employee must check them. */
  uncertainFields: string[];
}

export interface SheetImportResult {
  rows: SheetServiceRow[];
  notes: string[];
}

export const SERVICE_SHEET_TEMPLATE_CSV =
  "Service name,Category,Gender,Price,Price type,Discounted price,Duration (min),Description\r\n" +
  "Haircut,Hair,Men,200,Fixed,,30,\r\n" +
  "Hair colour,Hair,Women,1500,Starts from,1200,90,Global colour\r\n" +
  "Beard trim,Beard,Men,100,Fixed,,15,\r\n";

const MAX_ROWS = 300;
const MAX_BYTES = 5 * 1024 * 1024;

type Field = "serviceName" | "category" | "gender" | "price" | "priceType" | "discountedPrice" | "duration" | "description";

const HEADER_ALIASES: Record<Field, string[]> = {
  serviceName: ["servicename", "service", "name", "servicetitle", "item"],
  category: ["category", "group", "section", "type"],
  gender: ["gender", "for", "applicablegender", "menwomen"],
  price: ["price", "rate", "baseprice", "amount", "mrp", "pricers", "rs"],
  priceType: ["pricetype", "pricing"],
  discountedPrice: ["discountedprice", "offerprice", "discount", "saleprice", "specialprice"],
  duration: ["duration", "durationmin", "durationminutes", "minutes", "mins", "time", "timemin"],
  description: ["description", "details", "notes", "note"],
};

function normHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function matchHeader(cell: string): Field | null {
  const key = normHeader(cell);
  if (!key) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[Field, string[]]>) {
    if (aliases.includes(key)) return field;
  }
  if (key.startsWith("service")) return "serviceName";
  if (key.startsWith("duration") || key.includes("minute")) return "duration";
  if (key.includes("discount") || key.includes("offer")) return "discountedPrice";
  if (key.includes("pricetype")) return "priceType";
  if (key.includes("price") || key.includes("rate")) return "price";
  return null;
}

function parseMoney(value: string): number | null {
  const cleaned = value.replace(/[₹,\s]|rs\.?|inr/gi, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null;
  return Math.round(n * 100) / 100;
}

function parseDuration(value: string): number | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const hm = v.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(?:(\d+)\s*(?:m|min|mins|minutes?)?)?$/);
  let minutes: number;
  if (hm) minutes = Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  else {
    const m = v.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes?)?$/);
    if (!m) return null;
    minutes = Number(m[1]);
  }
  minutes = Math.round(minutes);
  return minutes >= 1 && minutes <= 600 ? minutes : null;
}

function parseGender(value: string): SheetServiceRow["applicableGender"] {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (/unisex|both|all|any/.test(v)) return "UNISEX";
  if (/^(f|female|women|woman|ladies|lady|girls?)$/.test(v) || /women|female|ladies/.test(v)) return "WOMEN";
  if (/^(m|male|men|man|gents|boys?)$/.test(v) || /\bmen\b|male|gents/.test(v)) return "MEN";
  return null;
}

/** Turn a table (first non-empty row = headers) into service rows. */
export function tableToServices(table: string[][]): SheetImportResult {
  const notes: string[] = [];
  const nonEmpty = table.filter((r) => r.some((c) => c.trim()));
  if (!nonEmpty.length) return { rows: [], notes: ["The file has no rows."] };

  const header = nonEmpty[0];
  const columns = new Map<Field, number>();
  header.forEach((cell, index) => {
    const field = matchHeader(cell);
    if (field && !columns.has(field)) columns.set(field, index);
  });
  if (!columns.has("serviceName")) {
    return { rows: [], notes: ['No "Service name" column found. Download the template to see the expected columns.'] };
  }

  const rows: SheetServiceRow[] = [];
  const get = (r: string[], f: Field) => {
    const i = columns.get(f);
    return i === undefined ? "" : (r[i] ?? "").trim();
  };
  for (const r of nonEmpty.slice(1)) {
    const serviceName = get(r, "serviceName").slice(0, 120);
    if (!serviceName) continue;
    if (rows.length >= MAX_ROWS) {
      notes.push(`Only the first ${MAX_ROWS} services were imported.`);
      break;
    }
    const uncertain: string[] = [];
    const priceRaw = get(r, "price");
    const basePrice = parseMoney(priceRaw);
    if (basePrice === null) uncertain.push("basePrice");
    const discountRaw = get(r, "discountedPrice");
    let discountedPrice = parseMoney(discountRaw);
    if (discountRaw && discountedPrice === null) uncertain.push("discountedPrice");
    if (discountedPrice !== null && basePrice !== null && discountedPrice > basePrice) {
      discountedPrice = null;
      uncertain.push("discountedPrice");
    }
    const durationRaw = get(r, "duration");
    const durationMinutes = parseDuration(durationRaw);
    if (durationMinutes === null) uncertain.push("durationMinutes");
    const genderRaw = get(r, "gender");
    const applicableGender = parseGender(genderRaw);
    if (genderRaw && applicableGender === null) uncertain.push("applicableGender");
    const priceType = /start|from|onward|\+/i.test(get(r, "priceType")) || /\+|onward/i.test(priceRaw) ? "STARTS_FROM" : "FIXED";
    rows.push({
      serviceName,
      category: get(r, "category").slice(0, 80) || null,
      applicableGender,
      basePrice,
      priceType,
      discountedPrice,
      durationMinutes,
      description: get(r, "description").slice(0, 500) || null,
      uncertainFields: uncertain,
    });
  }
  if (!rows.length) notes.push("No services found under the header row.");
  const missingDuration = rows.filter((r) => r.uncertainFields.includes("durationMinutes")).length;
  if (missingDuration) notes.push(`${missingDuration} service(s) have no readable duration. Ask the owner and fill them in.`);
  return { rows, notes };
}

/** RFC 4180-style CSV/TSV parser (quoted fields, doubled quotes, CRLF). */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t"
    : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------- XLSX (ZIP + XML) ----------

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read the named entries of a ZIP archive using its central directory. */
export async function readZipEntries(bytes: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This is not a valid .xlsx file.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("This .xlsx file is damaged.");
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + compSize);
    const data = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
    if (!data) throw new Error("This .xlsx file uses an unsupported compression.");
    // Some writers prefix every element (<x:row>, <x:c>); drop element prefixes, keep attributes.
    out.set(name, decoder.decode(data).replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, "<$1"));
  }
  return out;
}

function xmlText(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** First worksheet of an .xlsx as a table of display strings. */
export async function parseXlsx(bytes: Uint8Array): Promise<string[][]> {
  const files = await readZipEntries(bytes, (n) =>
    n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(n)
  );
  const shared: string[] = [];
  const sst = files.get("xl/sharedStrings.xml");
  if (sst) for (const si of sst.match(/<si\b[\s\S]*?<\/si>/g) ?? []) {
    shared.push((si.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) ?? []).map(xmlText).join(""));
  }
  // First sheet in workbook order -> its target via the relationships file.
  let sheetPath = "";
  const firstSheet = files.get("xl/workbook.xml")?.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  const rels = files.get("xl/_rels/workbook.xml.rels");
  if (firstSheet && rels) {
    const rel = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${firstSheet[1]}"[^>]*>`))?.[0];
    const target = rel?.match(/Target="([^"]+)"/)?.[1];
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
  }
  const sheet = files.get(sheetPath) ?? [...files.entries()].find(([n]) => n.startsWith("xl/worksheets/"))?.[1];
  if (!sheet) throw new Error("The .xlsx file has no worksheet.");

  const table: string[][] = [];
  for (const rowXml of sheet.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) ?? []) {
    const row: string[] = [];
    for (const c of rowXml.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? []) {
      const attrs = c.match(/^<c\b([^>]*)>/)?.[1] ?? c;
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = (c.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) ?? []).map(xmlText).join("");
      else if (v !== undefined) value = xmlText(v);
      const index = ref ? columnIndex(ref) : row.length;
      while (row.length < index) row.push("");
      row[index] = value.trim();
    }
    table.push(row);
  }
  return table;
}

/** Read services from a user-chosen .xlsx / .csv / .tsv file. */
export async function readServiceSheet(file: File): Promise<SheetImportResult> {
  if (file.size === 0) throw new Error("The file is empty.");
  if (file.size > MAX_BYTES) throw new Error("The file is larger than 5 MB.");
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls")) throw new Error("Old .xls files are not supported. In Excel use Save As → .xlsx, then try again.");
  let table: string[][];
  if (name.endsWith(".xlsx")) table = await parseXlsx(new Uint8Array(await file.arrayBuffer()));
  else if (/\.(csv|tsv|txt)$/.test(name)) table = parseDelimited(await file.text());
  else throw new Error("Choose an Excel (.xlsx) or CSV file.");
  return tableToServices(table);
}
