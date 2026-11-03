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

  // Last resort for unusually long addresses: auto-wrap into no more than
  // four lines without clipping or reordering any of the owner's address.
  // A continuous non-spaced string is divided by code point; a longer set of
  // words is split at word boundaries, with textLength reserved for cases
  // that physically cannot fit at our minimum readable footer font.
  const words = normalized.split(" ");
  let lines: string[];
  if (words.length === 1) {
    const chars = Array.from(normalized);
    lines = Array.from({ length: 4 }, (_, index) =>
      chars.slice(Math.floor(index * chars.length / 4), Math.floor((index + 1) * chars.length / 4)).join("")
    ).filter(Boolean);
  } else {
    const targetWidth = Math.max(MAX_WIDTH, measure(normalized, 7) / 4);
    const rows = [""];
    for (const word of words) {
      const last = rows.length - 1;
      const next = rows[last] ? `${rows[last]} ${word}` : word;
      if (rows[last] && rows.length < 4 && measure(next, 7) > targetWidth) {
        rows.push(word);
      } else {
        rows[last] = next;
      }
    }
    lines = rows.filter(Boolean);
  }
  return {
    lines,
    fontSize: 7,
    firstBaseline: LAST_BASELINE - (lines.length - 1) * LINE_HEIGHT,
    lineHeight: LINE_HEIGHT,
    maxWidth: MAX_WIDTH,
  };
}
