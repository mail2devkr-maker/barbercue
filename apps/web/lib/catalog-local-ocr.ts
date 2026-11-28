/**
 * Keyless salon catalog extraction. All document bytes stay inside the owner's browser:
 * PDF.js reads PDF pages; Tesseract.js recognises images/scanned pages on-device.
 * OCR language/worker assets may be downloaded; never send catalog pixels/text to a
 * third-party API. Users review/correct every draft before any saved service exists.
 */
export interface LocalCatalogCandidate {
  name: string;
  category: string;
  description: string;
  price: number | null;
  durationMinutes: number | null;
  source: string;
}

const digitMap = '०१२३४५६७८९';
function normalizeDigits(value: string): string {
  return value.replace(/[०-९]/g, (d) => String(digitMap.indexOf(d)));
}

export function parseCatalogRateText(input: string, source = 'Local OCR'): LocalCatalogCandidate[] {
  const text = normalizeDigits(input).replace(/\r/g, '\n');
  const lines = text.split(/\n/).map((s) => s.trim()).filter(Boolean);
  const items: LocalCatalogCandidate[] = [];
  const ignored = /^(?:services?|price\s*list|rate\s*list|service\s+price|name\s+price|total|subtotal|gst|tax|discount|सर्विस|सेवाएँ|मूल्य|कीमत|रेट\s*लिस्ट)\s*:?$/i;
  for (const line of lines) {
    if (line.length > 240 || ignored.test(line)) continue;
    const clean = line.replace(/[•●|]+/g, ' ').replace(/\s+/g, ' ').trim();
    const durationMatch = /\b(\d{1,3})\s*(?:minutes?|mins?|min)\b|(?<![\p{L}])(\d{1,3})\s*मिनट/iu.exec(clean);
    const explicitDuration = durationMatch ? Number(durationMatch[1] ?? durationMatch[2]) : null;
    const durationMinutes = explicitDuration !== null && explicitDuration >= 5 && explicitDuration <= 480
      ? explicitDuration : null;
    const withoutDuration = durationMatch ? clean.replace(durationMatch[0], ' ').replace(/\s+/g, ' ') : clean;
    // End-anchored price: never interpret a number in a name or a duration as a price.
    // Handles "Haircut ₹150", "Beard : Rs. 80", "Facial - 500/-" and Hindi names.
    const m = /^(.*?)[\s:–—-]+(?:₹\s*|rs\.?\s*|inr\s*|रु\.?\s*|रुपये\s*)?(\d{1,6}(?:\.\d{1,2})?)\s*(?:\/-|₹|rs\.?|inr|रुपये)?\s*$/iu.exec(withoutDuration)
      ?? /^(.*?)\s*[₹]\s*(\d{1,6}(?:\.\d{1,2})?)\s*$/u.exec(withoutDuration);
    if (!m) continue; // never invent missing prices or descriptions
    const name = m[1].replace(/[-–—:]+$/g, '').trim();
    const price = Number(m[2]);
    if (!name || name.length > 120 || !/[\p{L}]/u.test(name) || !Number.isFinite(price) || price > 1_000_000) continue;
    if (ignored.test(name)) continue;
    items.push({ name, category: '', description: '', price, durationMinutes, source });
    if (items.length >= 300) break;
  }
  return items;
}

export interface LocalCatalogExtraction {
  text: string;
  services: LocalCatalogCandidate[];
  notes: string[];
}

export async function extractCatalogLocally(
  file: File,
  onProgress: (message: string) => void,
): Promise<LocalCatalogExtraction> {
  const ext = file.name.toLowerCase();
  const pdf = ext.endsWith('.pdf');
  if (!pdf && !/\.(jpe?g|png|webp)$/.test(ext)) throw new Error('Unsupported local OCR file format.');
  if (!file.size || file.size > 6 * 1024 * 1024) throw new Error('File must be 1 byte to 6 MB.');
  const notes: string[] = [];
  const pages: string[] = [];
  type OcrWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
  const workerState: { current: OcrWorker | null } = { current: null };
  const recognise = async (image: File | HTMLCanvasElement): Promise<string> => {
    if (!workerState.current) {
      onProgress('Downloading English/Hindi OCR language data (first use may take time)…');
      const { createWorker } = await import('tesseract.js');
      workerState.current = await createWorker(['eng', 'hin'], 1, {
        logger: (status) => {
          if (status.status === 'recognizing text') onProgress('Reading text: ' + Math.round(status.progress * 100) + '%');
        },
      });
    }
    const result = await workerState.current.recognize(image);
    return result.data.text ?? '';
  };

  try {
    if (pdf) {
      onProgress('Opening PDF locally…');
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url,
      ).toString();
      const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
      const pdfDoc = await task.promise;
      if (pdfDoc.numPages > 5) {
        await pdfDoc.destroy();
        throw new Error('Local PDF extraction is limited to 5 pages per file. Split a longer PDF or use CSV/XLSX.');
      }
      try {
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          onProgress('Reading PDF page ' + i + ' of ' + pdfDoc.numPages + '…');
          const page = await pdfDoc.getPage(i);
          try {
            const content = await page.getTextContent();
            const text = content.items.map((item) => (
              'str' in item ? (item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ')) : ''
            )).join('');
            // A selectable PDF needs no OCR or external language data.
            if (text.trim().length >= 25) {
              pages.push(text);
            } else {
              const base = page.getViewport({ scale: 1 });
              const scale = Math.min(1.6, Math.sqrt(3_000_000 / (base.width * base.height)));
              const viewport = page.getViewport({ scale });
              const canvas = document.createElement('canvas');
              canvas.width = Math.ceil(viewport.width);
              canvas.height = Math.ceil(viewport.height);
              const context = canvas.getContext('2d', { willReadFrequently: true });
              if (!context) throw new Error('Cannot create a canvas for scanned PDF OCR.');
              await page.render({ canvas, canvasContext: context, viewport }).promise;
              pages.push(await recognise(canvas));
              canvas.width = 0; canvas.height = 0;
            }
          } finally { page.cleanup(); }
        }
      } finally { await pdfDoc.destroy(); }
    } else {
      onProgress('Recognizing photo text locally…');
      pages.push(await recognise(file));
    }
    const text = pages.join('\n');
    const services = parseCatalogRateText(text, file.name);
    if (!services.length) notes.push('No clear service-and-price pairs found. Edit the recognised text or enter services manually.');
    if (services.some((s) => s.durationMinutes === null)) notes.push('Missing durations remain blank until you explicitly review them.');
    return { text, services, notes };
  } finally {
    if (workerState.current) await workerState.current.terminate();
  }
}
