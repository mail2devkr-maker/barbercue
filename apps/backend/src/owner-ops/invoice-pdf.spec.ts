import { inflateSync } from 'zlib';
import type { InvoiceDetailDto } from '@barbercue/shared';
import { formatInvoiceMoney, renderInvoicePdf } from './invoice-pdf';
import { TtfFont } from './ttf-font';
import { GEIST_REGULAR_TTF_BASE64 } from './invoice-font';

export function sampleInvoice(overrides: Partial<InvoiceDetailDto> = {}): InvoiceDetailDto {
  return {
    id: 'inv-1',
    number: 'FQ-000042',
    salonId: 'salon-1',
    salonName: 'Handsome Center',
    sourceType: 'BOOKING',
    bookingId: 'b3f5a2c1-0000-4000-8000-000000000001',
    queueEntryId: null,
    customerName: 'Ravi Kumar',
    customerPhone: '+919876543210',
    staffName: 'Marcus',
    currency: 'INR',
    subtotal: 450,
    discountTotal: 45,
    taxTotal: 72.9,
    total: 477.9,
    amountPaid: 200,
    amountRefunded: 0,
    balanceDue: 277.9,
    paymentStatus: 'PARTIALLY_PAID',
    status: 'ISSUED',
    issuedAt: '2026-10-13T08:30:00.000Z',
    serviceDate: '2026-10-13T07:00:00.000Z',
    taxLabel: 'GST',
    taxRatePercent: 18,
    taxMode: 'EXCLUSIVE',
    seller: {
      legalName: 'Handsome Center Pvt Ltd',
      gstin: '22AAAAA0000A1Z5',
      address: '12 MG Road, Jharsuguda, Odisha 768201',
      phone: '+919800000000',
      email: 'hello@example.test',
    },
    lines: [
      { id: 'l1', description: 'Classic Haircut', quantity: 1, unitPrice: 250, discount: 25, lineTotal: 225 },
      { id: 'l2', description: 'Beard trim with hot towel and a long description that needs to wrap across lines', quantity: 1, unitPrice: 200, discount: 20, lineTotal: 180 },
    ],
    payments: [
      { id: 'p1', kind: 'PAYMENT', method: 'UPI', amount: 200, reference: 'UPI123', note: null, recordedAt: '2026-10-13T08:45:00.000Z' },
    ],
    voidReason: null,
    ...overrides,
  };
}

describe('TtfFont', () => {
  const font = new TtfFont(Buffer.from(GEIST_REGULAR_TTF_BASE64, 'base64'));
  it('has real glyphs for Latin text and the rupee sign', () => {
    expect(font.glyphFor('A'.codePointAt(0)!)).toBeGreaterThan(0);
    expect(font.glyphFor(0x20b9)).toBeGreaterThan(0);
    expect(font.measure('FastQue', 10)).toBeGreaterThan(20);
  });
});

describe('formatInvoiceMoney', () => {
  it('prints Indian rupees with the sign and Indian digit grouping', () => {
    expect(formatInvoiceMoney(1234567.5, 'INR')).toBe('₹12,34,567.50');
  });
  it('prefixes other currencies with their ISO code instead of guessing a symbol', () => {
    expect(formatInvoiceMoney(12.5, 'USD')).toBe('USD 12.50');
  });
});

describe('renderInvoicePdf', () => {
  it('produces a structurally valid PDF with an embedded font and selectable text', () => {
    const pdf = renderInvoicePdf(sampleInvoice(), { timeZone: 'Asia/Kolkata' });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/FontFile2');
    expect(text).toContain('/ToUnicode');
    // xref offsets must point at "N 0 obj"
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    entries.forEach((offset, index) => {
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
  });

  it('prints only what the invoice carries: no GSTIN or tax rows when none exist', () => {
    const invoice = sampleInvoice({
      taxTotal: 0,
      taxLabel: null,
      taxRatePercent: null,
      taxMode: null,
      total: 405,
      balanceDue: 205,
      seller: { legalName: 'Handsome Center', gstin: null, address: null, phone: null, email: null },
    });
    const pdf = renderInvoicePdf(invoice);
    const content = contentStream(pdf);
    // The heading is chosen from the data: no GSTIN => plain "INVOICE", never "TAX INVOICE".
    expect(decodeGlyphs(pdf, content)).toContain('INVOICE');
    expect(decodeGlyphs(pdf, content)).not.toContain('TAX INVOICE');
    expect(decodeGlyphs(pdf, content)).not.toContain('GSTIN');
  });

  it('shows the rupee amounts, the invoice number and the unpaid balance as text', () => {
    const pdf = renderInvoicePdf(sampleInvoice());
    const shown = decodeGlyphs(pdf, contentStream(pdf));
    expect(shown).toContain('FQ-000042');
    expect(shown).toContain('₹477.90');
    expect(shown).toContain('₹277.90');
    expect(shown).toContain('PARTIALLY PAID');
    expect(shown).toContain('TAX INVOICE');
  });
});

// ---- helpers: decode the page content stream back to text through the ToUnicode map ----
function contentStream(pdf: Buffer): string {
  const text = pdf.toString('latin1');
  const objStart = text.indexOf('4 0 obj');
  const streamStart = text.indexOf('stream\n', objStart) + 'stream\n'.length;
  const len = Number(/\/Length (\d+)/.exec(text.slice(objStart, streamStart))![1]);
  return inflateSync(pdf.subarray(streamStart, streamStart + len)).toString('latin1');
}
function decodeGlyphs(pdf: Buffer, content: string): string {
  const text = pdf.toString('latin1');
  const toUniObj = text.indexOf('9 0 obj');
  const bfStart = text.indexOf('beginbfchar', toUniObj);
  const map = new Map<string, string>();
  for (const m of text.slice(bfStart).matchAll(/<([0-9a-f]{4})> <([0-9a-f]{4})>/g)) {
    map.set(m[1], String.fromCharCode(parseInt(m[2], 16)));
  }
  const parts: string[] = [];
  for (const m of content.matchAll(/<([0-9a-f]+)> Tj/g)) {
    let s = '';
    for (let i = 0; i < m[1].length; i += 4) s += map.get(m[1].slice(i, i + 4)) ?? '?';
    parts.push(s);
  }
  return parts.join('\n');
}
