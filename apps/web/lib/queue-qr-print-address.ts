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

  // Last resort for unusually long addresses: still auto-wrap instead of
  // assuming fixed breaks or silently dropping the last part of the address.
  // Distribute actual words across four rows by measured width. For a single
  // unbroken token, split into four code-point chunks; the SVG export uses
  // textLength only if even these rows are wider than the footer.
  const words = normalized.split(" ");
  const rows = Array.from({ length: 4 }, () => "");
  for (const word of words) {
    const target = rows
      .map((row, index) => ({ index, width: measure(row, 7) }))
      .sort((left, right) => left.width - right.width || left.index - right.index)[0].index;
    rows[target] = rows[target] ? `${rows[target]} ${word}` : word;
  }
  // Preserve natural word order (rather than the greedy width distribution
  // above, which can scramble address components) while balancing lengths.
  // A long continuous address can be split safely by code point.
  const chars = Array.from(normalized);
  const wordRows = words.length > 1 ? Array.from({ length: 4 }, () => "") : null;
  if (wordRows) {
    let row = 0;
    for (const word of words) {
      const next = wordRows[row] ? `${wordRows[row]} ${word}` : word;
      if (row < 3 && wordRows[row] && measure(next, 7) > Math.max(MAX_WIDTH, measure(normalized, 7) / 4)) row += 1;
      wordRows[row] = wordRows[row] ? `${wordRows[row]} ${word}` : word;
    }
  }
  const lines = (wordRows ? wordRows.filter(Boolean) : Array.from({ length: 4 }, (_, index) =>
    chars.slice(Math.floor(index * chars.length / 4), Math.floor((index + 1) * chars.length / 4)).join("")
  )).filter(Boolean);
  return {
    lines,
    fontSize: 7,
    firstBaseline: LAST_BASELINE - (lines.length - 1) * LINE_HEIGHT,
    lineHeight: LINE_HEIGHT,
    maxWidth: MAX_WIDTH,
  };
}
