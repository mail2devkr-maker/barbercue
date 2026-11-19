import { HttpStatus } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { unzipSync } from 'fflate';
import { parseCsv, type UploadCell } from '@barbercue/shared';
import { AppException } from '../../common/exceptions/app.exception';

/**
 * A deliberately small, tolerant reader for uploaded spreadsheets. It reads cell VALUES only
 * (cached formula results are used as text; nothing is ever evaluated), keeps every cell as text so
 * barcodes keep their leading zeros, and reports where embedded pictures are anchored so a barcode
 * image can be associated with its row. Works with namespace-prefixed workbooks (`<x:row>`), which
 * several generators (OpenXML SDK, .NET) write and some libraries cannot read.
 */

export interface SheetData {
  name: string;
  /** rows[r][c] — 0-based; sparse rows/columns become empty cells. */
  rows: UploadCell[][];
  /** 0-based (row, col) of each embedded picture's top-left anchor. */
  images: Array<{ row: number; col: number }>;
}

export interface WorkbookData {
  type: 'XLSX' | 'CSV';
  sheets: SheetData[];
}

const MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5000;
const MAX_COLUMNS = 200;

function invalid(message: string): never {
  throw new AppException(
    'INVENTORY_UPLOAD_INVALID_FILE',
    message,
    HttpStatus.BAD_REQUEST,
  );
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: false,
  isArray: (name) =>
    [
      'sheet',
      'row',
      'c',
      'si',
      'r',
      'Relationship',
      'twoCellAnchor',
      'oneCellAnchor',
      'absoluteAnchor',
      'pic',
      'grpSp',
    ].includes(name),
});

const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Plain text of an XML text node / rich text (<t>, <r><t>). */
function textOf(node: unknown): string {
  if (node === undefined || node === null) return '';
  // <xdr:from><xdr:row> is named like a sheet row, so the parser may wrap it in an array.
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if ('#text' in o) return String(o['#text']);
    let out = '';
    if ('t' in o) out += textOf(o.t);
    for (const run of asArray(o.r as unknown[])) out += textOf(run);
    return out;
  }
  return '';
}

/** "AB12" → 27 (0-based column index). */
export function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel stores numbers as doubles; render integers without exponent/decimals (13-digit EANs fit). */
function numberText(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (Number.isInteger(n) && Math.abs(n) < 1e21)
    return BigInt(Math.round(n)).toString();
  return String(n);
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

export function readXlsx(buffer: Buffer): WorkbookData {
  let totalSize = 0;
  let entries = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer), {
      filter: (file) => {
        entries += 1;
        if (entries > MAX_ZIP_ENTRIES)
          invalid('The workbook contains too many parts.');
        if (file.name === 'xl/vbaProject.bin')
          invalid(
            'Macro-enabled workbooks are not accepted. Save it as a plain .xlsx file.',
          );
        // Only XML parts are read; pictures and other binaries are skipped (their position is enough).
        if (!/\.(xml|rels)$/i.test(file.name)) return false;
        totalSize += file.originalSize;
        if (totalSize > MAX_UNCOMPRESSED_BYTES)
          invalid('The workbook is too large once unpacked.');
        return true;
      },
    });
  } catch (error) {
    if (error instanceof AppException) throw error;
    invalid('That file is not a readable .xlsx workbook.');
  }
  const xml = (path: string): Record<string, unknown> | null => {
    const bytes = files[path];
    if (!bytes) return null;
    const text = Buffer.from(bytes).toString('utf8');
    if (/<!DOCTYPE|<!ENTITY/i.test(text))
      invalid('The workbook contains XML features that are not accepted.');
    return parser.parse(text) as Record<string, unknown>;
  };
  const rels = (
    path: string,
  ): Map<string, { target: string; type: string }> => {
    const relPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    const doc = xml(relPath);
    const map = new Map<string, { target: string; type: string }>();
    const list = asArray(
      (doc?.Relationships as Record<string, unknown> | undefined)
        ?.Relationship as Array<Record<string, string>>,
    );
    for (const r of list)
      map.set(r['@Id'], {
        target: resolvePath(path, r['@Target']),
        type: r['@Type'] ?? '',
      });
    return map;
  };

  const workbook = xml('xl/workbook.xml');
  if (!workbook) invalid('That file is not a readable .xlsx workbook.');
  const workbookRels = rels('xl/workbook.xml');
  const sheetsNode = (workbook.workbook as Record<string, unknown>)?.sheets as
    Record<string, unknown> | undefined;
  const sheetList = asArray(
    sheetsNode?.sheet as Array<Record<string, string>> | undefined,
  );

  const shared: string[] = [];
  const sst = xml('xl/sharedStrings.xml');
  for (const si of asArray(
    (sst?.sst as Record<string, unknown> | undefined)?.si as unknown[],
  ))
    shared.push(textOf(si));

  const sheets: SheetData[] = [];
  for (const s of sheetList) {
    const relId = s['@id'] ?? s['@r:id'];
    const target = relId ? workbookRels.get(relId)?.target : undefined;
    if (!target) continue;
    const doc = xml(target);
    const worksheet = doc?.worksheet as Record<string, unknown> | undefined;
    const sheetData = worksheet?.sheetData as
      Record<string, unknown> | undefined;
    const rows: UploadCell[][] = [];
    let nextRow = 0;
    for (const row of asArray(
      sheetData?.row as Array<Record<string, unknown>>,
    )) {
      const r = row['@r'] ? Number(row['@r']) - 1 : nextRow;
      nextRow = r + 1;
      if (r > 1_000_000) break;
      const cells: UploadCell[] = [];
      let nextCol = 0;
      for (const c of asArray(row.c as Array<Record<string, unknown>>)) {
        const ref = c['@r'] as string | undefined;
        const col = ref ? columnIndex(ref) : nextCol;
        nextCol = col + 1;
        if (col >= MAX_COLUMNS) continue;
        const type = (c['@t'] as string | undefined) ?? 'n';
        const v = c.v === undefined ? undefined : textOf(c.v);
        let cell: UploadCell;
        if (type === 's') cell = { text: shared[Number(v)] ?? '' };
        else if (type === 'inlineStr') cell = { text: textOf(c.is) };
        else if (type === 'str' || type === 'e') cell = { text: v ?? '' };
        else if (type === 'b') cell = { text: v === '1' ? 'TRUE' : 'FALSE' };
        else if (v === undefined || v === '') cell = { text: '' };
        else cell = { text: numberText(v), numeric: true };
        while (cells.length < col) cells.push({ text: '' });
        cells[col] = cell;
      }
      while (rows.length < r) rows.push([]);
      rows[r] = cells;
    }

    // Embedded pictures: sheet → drawing → anchors (top-left cell of each picture).
    const images: Array<{ row: number; col: number }> = [];
    for (const rel of rels(target).values()) {
      if (!/\/drawing$/.test(rel.type)) continue;
      const drawing = xml(rel.target)?.wsDr as
        Record<string, unknown> | undefined;
      if (!drawing) continue;
      for (const kind of ['twoCellAnchor', 'oneCellAnchor'] as const)
        for (const anchor of asArray(
          drawing[kind] as Array<Record<string, unknown>>,
        )) {
          const from = anchor.from as Record<string, unknown> | undefined;
          const pics =
            asArray(anchor.pic as unknown[]).length +
            asArray(anchor.grpSp as unknown[]).length;
          if (!from || pics === 0) continue;
          images.push({
            row: Number(textOf(from.row)),
            col: Number(textOf(from.col)),
          });
        }
    }
    sheets.push({
      name: s['@name'] ?? `Sheet ${sheets.length + 1}`,
      rows,
      images,
    });
  }
  if (!sheets.length) invalid('The workbook has no worksheets.');
  return { type: 'XLSX', sheets };
}

export function readCsv(buffer: Buffer): WorkbookData {
  if (buffer.includes(0)) invalid('That file is not a text CSV file.');
  let text = buffer.toString('utf8');
  if (text.includes('�')) text = buffer.toString('latin1'); // Excel "CSV" saved in a legacy code page
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].reduce(
    (best, d) =>
      firstLine.split(d).length > firstLine.split(best).length ? d : best,
    ',',
  );
  const normalized =
    delimiter === ','
      ? text
      : // parseCsv speaks commas; swap delimiters outside quotes.
        text.replace(/("(?:[^"]|"")*")|[;\t]/g, (m, quoted: string) =>
          quoted ? quoted : m === delimiter ? ',' : m,
        );
  const rows = parseCsv(normalized).map((r) =>
    r.slice(0, MAX_COLUMNS).map((t) => ({ text: t })),
  );
  return { type: 'CSV', sheets: [{ name: 'CSV', rows, images: [] }] };
}

/** Picks the reader from the file's bytes (never only from its name). */
export function readSpreadsheet(
  buffer: Buffer,
  fileName: string,
): WorkbookData {
  const isZip =
    buffer.length > 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;
  const lower = fileName.toLowerCase();
  if (isZip) {
    if (!lower.endsWith('.xlsx'))
      invalid('Upload an .xlsx workbook or a .csv file.');
    return readXlsx(buffer);
  }
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0xd0cf11e0)
    invalid(
      'Old .xls files are not supported. Save the sheet as .xlsx and upload again.',
    );
  if (!lower.endsWith('.csv') && !lower.endsWith('.txt'))
    invalid('Upload an .xlsx workbook or a .csv file.');
  return readCsv(buffer);
}
