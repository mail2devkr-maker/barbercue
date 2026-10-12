import { deflateSync } from 'zlib';
import type { InvoiceDetailDto } from '@barbercue/shared';
import { GEIST_REGULAR_TTF_BASE64 } from './invoice-font';
import { TtfFont } from './ttf-font';

/**
 * FastQue invoice PDF - generated server-side with no third-party PDF dependency.
 *
 * The bundled Geist font is embedded (so the rupee sign and every Latin glyph render correctly on
 * any viewer, and the text stays selectable/searchable through a ToUnicode map). A4 portrait.
 * What it prints is exactly what the invoice row froze at issue time: nothing is recalculated here
 * and no value is invented (no GSTIN, no tax line, no customer detail unless the invoice carries it).
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;

type Rgb = readonly [number, number, number];
const INK: Rgb = [0.11, 0.1, 0.09];
const MUTED: Rgb = [0.42, 0.39, 0.34];
const BRAND: Rgb = [0.949, 0.161, 0.361];
const RULE: Rgb = [0.906, 0.878, 0.827];
const PAPER_TINT: Rgb = [0.973, 0.945, 0.902];
const GREEN: Rgb = [0.18, 0.49, 0.2];
const AMBER: Rgb = [0.7, 0.42, 0];
const RED: Rgb = [0.69, 0.25, 0.24];

let cachedFont: TtfFont | null = null;
function font(): TtfFont {
  if (!cachedFont) cachedFont = new TtfFont(Buffer.from(GEIST_REGULAR_TTF_BASE64, 'base64'));
  return cachedFont;
}

export function formatInvoiceMoney(amount: number, currency: string): string {
  const grouped = amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'INR' ? `₹${grouped}` : `${currency} ${grouped}`;
}

class PageBuilder {
  private readonly ops: string[] = [];
  readonly usedGlyphs = new Map<number, number>(); // gid -> code point (first seen)

  constructor(private readonly f: TtfFont) {}

  private color(c: Rgb, stroke = false): string {
    return `${c.map((v) => v.toFixed(3)).join(' ')} ${stroke ? 'RG' : 'rg'}`;
  }

  fillRect(x: number, top: number, w: number, h: number, c: Rgb): void {
    this.ops.push(`q ${this.color(c)} ${x.toFixed(2)} ${(PAGE_H - top - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f Q`);
  }

  hLine(x1: number, x2: number, top: number, c: Rgb, width = 0.6): void {
    const y = (PAGE_H - top).toFixed(2);
    this.ops.push(`q ${this.color(c, true)} ${width} w ${x1.toFixed(2)} ${y} m ${x2.toFixed(2)} ${y} l S Q`);
  }

  text(
    str: string,
    x: number,
    top: number,
    size: number,
    opts: { color?: Rgb; bold?: boolean; align?: 'left' | 'right' | 'center' } = {},
  ): void {
    if (!str) return;
    const width = this.f.measure(str, size);
    const startX = opts.align === 'right' ? x - width : opts.align === 'center' ? x - width / 2 : x;
    let hex = '';
    for (const ch of str) {
      const cp = ch.codePointAt(0)!;
      const gid = this.f.glyphFor(cp);
      if (!this.usedGlyphs.has(gid)) this.usedGlyphs.set(gid, cp);
      hex += gid.toString(16).padStart(4, '0');
    }
    const color = opts.color ?? INK;
    const baseline = (PAGE_H - top - size * 0.8).toFixed(2);
    // Geist ships a single (regular) weight; "bold" is the PDF fill+stroke render mode, which
    // thickens every glyph outline slightly - no second font file needed.
    const bold = opts.bold ? `2 Tr ${this.color(color, true)} ${(size * 0.028).toFixed(3)} w ` : '';
    this.ops.push(`q BT ${this.color(color)} ${bold}/F1 ${size} Tf ${startX.toFixed(2)} ${baseline} Td <${hex}> Tj ET Q`);
  }

  wrap(str: string, maxWidth: number, size: number): string[] {
    const lines: string[] = [];
    for (const paragraph of str.split('\n')) {
      let current = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const attempt = current ? `${current} ${word}` : word;
        if (this.f.measure(attempt, size) <= maxWidth || !current) current = attempt;
        else {
          lines.push(current);
          current = word;
        }
      }
      lines.push(current);
    }
    return lines;
  }

  content(): string {
    return this.ops.join('\n');
  }
}

function pdfString(value: string): string {
  return `(${value.replace(/[\\()]/g, '\\$&')})`;
}

function fmtDate(iso: string, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: timeZone ?? undefined,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function statusLabel(inv: InvoiceDetailDto): { text: string; color: Rgb } {
  switch (inv.paymentStatus) {
    case 'PAID':
      return { text: 'PAID', color: GREEN };
    case 'PARTIALLY_PAID':
      return { text: 'PARTIALLY PAID', color: AMBER };
    case 'REFUNDED':
      return { text: 'REFUNDED', color: MUTED };
    case 'VOID':
      return { text: 'VOID', color: RED };
    default:
      return { text: 'UNPAID', color: AMBER };
  }
}

const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', OTHER: 'Other' };

export function renderInvoicePdf(inv: InvoiceDetailDto, options: { timeZone?: string | null } = {}): Buffer {
  const f = font();
  const page = new PageBuilder(f);
  const tz = options.timeZone ?? null;
  const money = (n: number) => formatInvoiceMoney(n, inv.currency);
  const right = PAGE_W - MARGIN;
  let y = MARGIN;

  // ---- Brand header
  page.fillRect(0, 0, PAGE_W, 6, BRAND);
  page.text('FastQue', MARGIN, y + 4, 22, { color: BRAND, bold: true });
  const title = inv.seller.gstin && inv.taxTotal > 0 ? 'TAX INVOICE' : 'INVOICE';
  page.text(title, right, y + 6, 18, { align: 'right', bold: true });
  y += 40;

  // ---- Seller / invoice meta
  const colW = (PAGE_W - 2 * MARGIN) / 2 - 10;
  let leftY = y;
  page.text(inv.seller.legalName, MARGIN, leftY, 12, { bold: true });
  leftY += 17;
  const sellerLines = [
    ...(inv.seller.address ? page.wrap(inv.seller.address, colW, 9) : []),
    ...(inv.seller.phone ? [`Phone: ${inv.seller.phone}`] : []),
    ...(inv.seller.email ? [inv.seller.email] : []),
    ...(inv.seller.gstin ? [`GSTIN: ${inv.seller.gstin}`] : []),
  ];
  for (const line of sellerLines) {
    page.text(line, MARGIN, leftY, 9, { color: MUTED });
    leftY += 13;
  }
  if (inv.salonName && inv.salonName !== inv.seller.legalName) {
    page.text(`Trading as ${inv.salonName}`, MARGIN, leftY, 9, { color: MUTED });
    leftY += 13;
  }

  let rightY = y;
  const metaX = PAGE_W / 2 + 20;
  const meta: [string, string][] = [
    ['Invoice no.', inv.number],
    ['Invoice date', fmtDate(inv.issuedAt, tz)],
    ['Service date', fmtDate(inv.serviceDate, tz)],
    [inv.sourceType === 'BOOKING' ? 'Booking ref.' : 'Live Queue visit', (inv.bookingId ?? inv.queueEntryId ?? '').slice(0, 8).toUpperCase()],
  ];
  for (const [label, value] of meta) {
    page.text(label, metaX, rightY, 9, { color: MUTED });
    page.text(value, right, rightY, 10, { align: 'right', bold: true });
    rightY += 16;
  }
  const status = statusLabel(inv);
  const badgeW = f.measure(status.text, 9) + 18;
  page.fillRect(right - badgeW, rightY + 2, badgeW, 18, PAPER_TINT);
  page.text(status.text, right - badgeW / 2, rightY + 6, 9, { align: 'center', bold: true, color: status.color });
  rightY += 28;

  y = Math.max(leftY, rightY) + 8;
  page.hLine(MARGIN, right, y, RULE);
  y += 14;

  // ---- Bill to
  page.text('Billed to', MARGIN, y, 9, { color: MUTED });
  y += 14;
  page.text(inv.customerName ?? 'Customer', MARGIN, y, 11, { bold: true });
  y += 15;
  if (inv.customerPhone) {
    page.text(inv.customerPhone, MARGIN, y, 9, { color: MUTED });
    y += 13;
  }
  if (inv.staffName) {
    page.text(`Served by ${inv.staffName}`, MARGIN, y, 9, { color: MUTED });
    y += 13;
  }
  y += 10;

  // ---- Lines table
  const cols = { desc: MARGIN + 8, qty: 330, unit: 410, disc: 478, amt: right - 8 };
  page.fillRect(MARGIN, y, right - MARGIN, 22, PAPER_TINT);
  page.text('Description', cols.desc, y + 6, 9, { bold: true });
  page.text('Qty', cols.qty, y + 6, 9, { bold: true, align: 'right' });
  page.text('Unit price', cols.unit, y + 6, 9, { bold: true, align: 'right' });
  page.text('Discount', cols.disc, y + 6, 9, { bold: true, align: 'right' });
  page.text('Amount', cols.amt, y + 6, 9, { bold: true, align: 'right' });
  y += 30;
  for (const line of inv.lines) {
    const wrapped = page.wrap(line.description, 250, 10);
    page.text(wrapped[0] ?? '', cols.desc, y, 10);
    page.text(String(line.quantity), cols.qty, y, 10, { align: 'right' });
    page.text(money(line.unitPrice), cols.unit, y, 10, { align: 'right' });
    page.text(line.discount > 0 ? `-${money(line.discount)}` : '—', cols.disc, y, 10, { align: 'right', color: line.discount > 0 ? INK : MUTED });
    page.text(money(line.lineTotal), cols.amt, y, 10, { align: 'right', bold: true });
    let lh = 15;
    for (const extra of wrapped.slice(1)) {
      page.text(extra, cols.desc, y + lh - 1, 10);
      lh += 13;
    }
    y += lh + 3;
    page.hLine(MARGIN, right, y - 4, RULE, 0.4);
  }
  y += 8;

  // ---- Totals
  const totalsX = 360;
  const totalRow = (label: string, value: string, opts: { bold?: boolean; size?: number; color?: Rgb } = {}) => {
    const size = opts.size ?? 10;
    page.text(label, totalsX, y, size, { color: opts.color ?? MUTED, bold: opts.bold });
    page.text(value, right - 8, y, size, { align: 'right', bold: opts.bold, color: opts.color });
    y += size + 8;
  };
  totalRow('Subtotal', money(inv.subtotal));
  if (inv.discountTotal > 0) totalRow('Discount', `-${money(inv.discountTotal)}`);
  if (inv.taxLabel && inv.taxTotal > 0) {
    const rate = inv.taxRatePercent !== null ? ` ${inv.taxRatePercent}%` : '';
    totalRow(`${inv.taxLabel}${rate}${inv.taxMode === 'INCLUSIVE' ? ' (included)' : ''}`, money(inv.taxTotal));
  }
  page.hLine(totalsX, right, y - 2, INK, 0.8);
  y += 4;
  totalRow('Total', money(inv.total), { bold: true, size: 13, color: INK });
  if (inv.amountPaid > 0) totalRow('Amount received', money(inv.amountPaid));
  if (inv.amountRefunded > 0) totalRow('Refunded', `-${money(inv.amountRefunded)}`);
  totalRow('Balance due', money(inv.balanceDue), { bold: true, size: 11, color: inv.balanceDue > 0 ? AMBER : GREEN });
  y += 6;

  // ---- Payments
  if (inv.payments.length > 0) {
    page.text('Payments', MARGIN, y, 9, { color: MUTED, bold: true });
    y += 15;
    for (const p of inv.payments) {
      const label = `${p.kind === 'REFUND' ? 'Refund' : 'Payment'} · ${METHOD_LABEL[p.method] ?? p.method}${p.reference ? ` · ref ${p.reference}` : ''}`;
      page.text(`${fmtDate(p.recordedAt, tz)}   ${label}`, MARGIN, y, 9);
      page.text(`${p.kind === 'REFUND' ? '-' : ''}${money(p.amount)}`, 300, y, 9, { align: 'right' });
      y += 13;
    }
    y += 6;
  }
  if (inv.status === 'VOID' && inv.voidReason) {
    page.text(`Voided: ${inv.voidReason}`, MARGIN, y, 9, { color: RED });
    y += 14;
  }

  // ---- Footer
  const footerTop = PAGE_H - 62;
  page.hLine(MARGIN, right, footerTop, RULE);
  page.text('Payment status reflects payments recorded by the shop. This invoice was generated with FastQue.', MARGIN, footerTop + 10, 8, { color: MUTED });
  page.text(`${inv.number} · ${inv.seller.legalName}`, right, footerTop + 24, 8, { align: 'right', color: MUTED });

  return assemblePdf(f, page);
}

function assemblePdf(f: TtfFont, page: PageBuilder): Buffer {
  const objects: (Buffer | string)[] = [];
  const add = (body: Buffer | string): number => {
    objects.push(body);
    return objects.length; // 1-based object number
  };
  const stream = (dict: string, data: Buffer): Buffer =>
    Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);

  // Reserve numbers in a fixed order so references can be written before the targets exist.
  const CATALOG = 1, PAGES = 2, PAGE = 3, CONTENT = 4, FONT = 5, CID = 6, DESC = 7, FILE = 8, TOUNI = 9;
  const used = [...page.usedGlyphs.entries()].sort((a, b) => a[0] - b[0]);

  const scale = (units: number) => Math.round((units * 1000) / f.unitsPerEm);
  const widths = used.map(([gid]) => `${gid} [${scale(f.advance(gid))}]`).join(' ');

  let bf = '';
  for (let i = 0; i < used.length; i += 100) {
    const chunk = used.slice(i, i + 100);
    bf += `${chunk.length} beginbfchar\n${chunk
      .map(([gid, cp]) => `<${gid.toString(16).padStart(4, '0')}> <${cpToUtf16Hex(cp)}>`)
      .join('\n')}\nendbfchar\n`;
  }
  const toUnicode =
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
    bf +
    'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';

  add(`<< /Type /Catalog /Pages ${PAGES} 0 R >>`); // 1
  add(`<< /Type /Pages /Kids [${PAGE} 0 R] /Count 1 >>`); // 2
  add(
    `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${FONT} 0 R >> >> /Contents ${CONTENT} 0 R >>`,
  ); // 3
  add(stream('/Filter /FlateDecode', deflateSync(Buffer.from(page.content(), 'latin1')))); // 4
  add(`<< /Type /Font /Subtype /Type0 /BaseFont /GeistRegular /Encoding /Identity-H /DescendantFonts [${CID} 0 R] /ToUnicode ${TOUNI} 0 R >>`); // 5
  add(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /GeistRegular /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${DESC} 0 R /DW 600 /W [${widths}] /CIDToGIDMap /Identity >>`,
  ); // 6
  add(
    `<< /Type /FontDescriptor /FontName /GeistRegular /Flags 32 /FontBBox [${scale(-200)} ${scale(f.descent)} ${scale(f.unitsPerEm + 200)} ${scale(f.ascent)}] /ItalicAngle 0 /Ascent ${scale(f.ascent)} /Descent ${scale(f.descent)} /CapHeight ${scale(f.ascent * 0.8)} /StemV 80 /FontFile2 ${FILE} 0 R >>`,
  ); // 7
  add(stream(`/Filter /FlateDecode /Length1 ${f.data.length}`, deflateSync(f.data))); // 8
  add(stream('', Buffer.from(toUnicode, 'latin1'))); // 9

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%âãÏÓ\n', 'latin1')];
  const offsets: number[] = [];
  let position = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(position);
    const head = Buffer.from(`${index + 1} 0 obj\n`, 'latin1');
    const buf = typeof body === 'string' ? Buffer.from(body, 'latin1') : body;
    const tail = Buffer.from('\nendobj\n', 'latin1');
    chunks.push(head, buf, tail);
    position += head.length + buf.length + tail.length;
  });
  const xrefStart = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${CATALOG} 0 R /Info << /Producer ${pdfString('FastQue')} /Title ${pdfString('Invoice')} >> >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}

function cpToUtf16Hex(cp: number): string {
  if (cp <= 0xffff) return cp.toString(16).padStart(4, '0');
  const v = cp - 0x10000;
  const hi = 0xd800 + (v >> 10);
  const lo = 0xdc00 + (v & 0x3ff);
  return hi.toString(16).padStart(4, '0') + lo.toString(16).padStart(4, '0');
}
