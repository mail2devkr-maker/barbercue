/**
 * The HTML QR preview wraps naturally, but a plain SVG <text> never wraps.
 * Explicit SVG <tspan> lines keep downloaded 4x6-inch signs legible for
 * existing salons whose names contain multiple words.
 */
export type QueueQrTitleLayout = {
  lines: string[];
  fontSize: number;
  firstBaseline: number;
  lineHeight: number;
  maxWidth: number;
};

type MeasureText = (text: string, fontSize: number) => number;
const MAX_TEXT_WIDTH = 340;

function wrapAtMeasuredWidth(title: string, size: number, measure: MeasureText): string[] {
  const words = title.split(' ');
  const lines: string[] = [];
  let current = '';

  function flush() {
    if (current) lines.push(current);
    current = '';
  }

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (measure(next, size) <= MAX_TEXT_WIDTH) {
      current = next;
      continue;
    }
    flush();
    if (measure(word, size) <= MAX_TEXT_WIDTH) {
      current = word;
      continue;
    }
    // A single extremely long word is split by code point, not truncated.
    // This preserves meaningful shop identifiers and non-Latin names.
    let chunk = '';
    for (const char of Array.from(word)) {
      if (chunk && measure(chunk + char, size) > MAX_TEXT_WIDTH) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
  }
  flush();
  return lines;
}

export function layoutQueueQrPrintTitle(name: string, measure: MeasureText): QueueQrTitleLayout {
  const title = name.trim().replace(/\s+/gu, ' ') || 'Your Shop';
  const options = [
    { fontSize: 26, maxLines: 1 },
    { fontSize: 25, maxLines: 2 },
    { fontSize: 23, maxLines: 2 },
    { fontSize: 21, maxLines: 2 },
    { fontSize: 20, maxLines: 3 },
    { fontSize: 18, maxLines: 3 },
    { fontSize: 16, maxLines: 4 },
    { fontSize: 14, maxLines: 4 },
    { fontSize: 12, maxLines: 4 },
    { fontSize: 10, maxLines: 4 },
  ] as const;
  for (const option of options) {
    const lines = wrapAtMeasuredWidth(title, option.fontSize, measure);
    if (lines.length <= option.maxLines) {
      const count = lines.length;
      return {
        lines,
        fontSize: option.fontSize,
        maxWidth: MAX_TEXT_WIDTH,
        firstBaseline: count === 1 ? 116 : count === 2 ? 103 : 91,
        lineHeight: count <= 2 ? 25 : count === 3 ? 20 : 15,
      };
    }
  }

  // Last resort for extraordinarily long names: retain every word and fit each
  // complete line with textLength instead of clipping/truncating any shop name.
  const words = title.split(' ');
  const lines = Array.from({ length: 4 }, () => '');
  for (let i = 0; i < words.length; i += 1) {
    const lineIndex = Math.min(3, Math.floor((i * 4) / words.length));
    lines[lineIndex] = lines[lineIndex] ? `${lines[lineIndex]} ${words[i]}` : words[i];
  }
  return { lines: lines.filter(Boolean), fontSize: 10, maxWidth: MAX_TEXT_WIDTH, firstBaseline: 91, lineHeight: 15 };
}
