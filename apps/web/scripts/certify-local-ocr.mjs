// Real dependency smoke test: synthetic on-device OCR + selectable PDF. No salon data or API keys.
// Uses locally generated test fixtures only; does NOT upload file bytes to any AI service.
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="240"><rect width="100%" height="100%" fill="#fff"/><text x="45" y="125" font-family="DejaVu Sans" font-size="72" fill="#000">Haircut 150</text></svg>');
const png = await sharp(svg).png().toBuffer();

console.log('Starting synthetic local OCR smoke (English + Hindi language assets)...');
const worker = await createWorker(['eng', 'hin']);
try {
  const { data } = await worker.recognize(png);
  const text = data.text.replace(/\s+/g, ' ').toLowerCase();
  assert.match(text, /haircut/, 'OCR should recognize synthetic service name');
  assert.match(text, /150/, 'OCR should recognize explicit synthetic price');
  console.log('PASS: Tesseract.js extracted synthetic Haircut 150 with no API key');
} finally {
  await worker.terminate();
}

function makePdf() {
  const message = 'BT /F1 24 Tf 40 750 Td (Haircut 150) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(message) + ' >>\nstream\n' + message + '\nendstream',
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(source));
    source += (index + 1) + ' 0 obj\n' + obj + '\nendobj\n';
  });
  const xrefAt = Buffer.byteLength(source);
  source += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    source += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  source += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\n';
  source += 'startxref\n' + xrefAt + '\n%%EOF';
  return new Uint8Array(Buffer.from(source));
}
const task = getDocument({ data: makePdf(), useSystemFonts: true, isEvalSupported: false, disableFontFace: true });
const pdf = await task.promise;
try {
  assert.equal(pdf.numPages, 1);
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ');
  assert.match(text, /Haircut 150/);
  console.log('PASS: PDF.js extracted synthetic selectable PDF text locally');
} finally {
  await pdf.destroy();
}
console.log('PASS: keyless OCR/PDF runtime dependency smoke completed');
