/**
 * Small, readable address footer for the printed 4 x 6 inch queue poster.
 * The owner's saved address is used verbatim (except whitespace normalization);
 * never fabricate a street, city or location from a postal code.
 */
export function formatQueueQrPrintAddress(addressLine: string, postalCode: string | null): string {
  const address = addressLine.trim().replace(/\s+/gu, " ");
  const pin = (postalCode ?? "").trim().replace(/\s+/gu, " ");
  if (!address) return "";
  return pin && !address.includes(pin) ? `${address}, ${pin}` : address;
}

export type QueueQrAddressLayout = {
  lines: string[];
  fontSize: number;
  firstBaseline: number;
  lineHeight: number;
  maxWidth: number;
};

type MeasureText = (text: string, fontSize: number) => number;
const MAX_WIDTH = 350;
const LAST_BASELINE = 587;
const LINE_HEIGHT = 8;

function wrapWords(address: string, size: number, measure: MeasureText): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of address.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (measure(next, size) <= MAX_WIDTH) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = "";
    if (measure(word, size) <= MAX_WIDTH) {
      current = word;
      continue;
    }
    // Extremely long single tokens (non-spaced addresses) still wrap by code point.
    for (const char of Array.from(word)) {
      if (current && measure(current + char, size) > MAX_WIDTH) {
        lines.push(current);
        current = char;
      } else {
        current += char;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function layoutQueueQrPrintAddress(address: string, measure: MeasureText): QueueQrAddressLayout {
  const normalized = address.trim().replace(/\s+/gu, " ");
  if (!normalized) return { lines: [], fontSize: 10, firstBaseline: LAST_BASELINE, lineHeight: LINE_HEIGHT, maxWidth: MAX_WIDTH };

  for (const option of [
    { fontSize: 10, maxLines: 2 },
    { fontSize: 9, maxLines: 3 },
    { fontSize: 8, maxLines: 4 },
    { fontSize: 7, maxLines: 4 },
  ]) {
    const lines = wrapWords(normalized, option.fontSize, measure);
    if (lines.length <= option.maxLines) {
      return {
        lines,
        fontSize: option.fontSize,
        firstBaseline: LAST_BASELINE - (lines.length - 1) * LINE_HEIGHT,
        lineHeight: LINE_HEIGHT,
        maxWidth: MAX_WIDTH,
      };
    }
  }

  // Last resort: no address is truncated. The SVG renderer proportionally
  // compresses oversize lines with textLength; keep at most four footer rows.
  const words = normalized.split(" ");
  const rows = Array.from({ length: 4 }, () => "");
  for (let index = 0; index < words.length; index += 1) {
    const row = Math.min(3, Math.floor((index * 4) / words.length));
    rows[row] = rows[row] ? `${rows[row]} ${words[index]}` : words[index];
  }
  const lines = rows.filter(Boolean);
  return {
    lines,
    fontSize: 7,
    firstBaseline: LAST_BASELINE - (lines.length - 1) * LINE_HEIGHT,
    lineHeight: LINE_HEIGHT,
    maxWidth: MAX_WIDTH,
  };
}
