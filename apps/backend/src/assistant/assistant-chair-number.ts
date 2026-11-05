import { normalizeText } from './assistant-parser';

/**
 * Which chair a sentence means by NUMBER (owner directive, 5 Nov 2026): "chair number 2", "chair no 2",
 * "chair 2", "2 number chair", "chair do" (Hindi two), "doosri chair" (second). A chair is matched by
 * that number in its own label ("Chair 2", "Kursi 2", "C2"); when no label carries numbers, by its
 * position in the shop's list. Anything unclear returns null, so the caller asks which chair instead of
 * guessing - a wrong chair must never be previewed.
 *
 * Hindi number words count only right next to the chair word ("chair do band karo"), never on their
 * own, because "do" is also the verb in "band kar do".
 */
const HINDI: Record<string, number> = {
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  chaar: 4,
  paanch: 5,
  panch: 5,
  chhe: 6,
  chhah: 6,
  che: 6,
  saat: 7,
  aath: 8,
  nau: 9,
  das: 10,
};
const ORDINAL: Record<string, number> = {
  pehli: 1,
  pahli: 1,
  pehla: 1,
  first: 1,
  doosri: 2,
  dusri: 2,
  doosra: 2,
  dusra: 2,
  second: 2,
  teesri: 3,
  tisri: 3,
  teesra: 3,
  third: 3,
  chauthi: 4,
  chautha: 4,
  fourth: 4,
  paanchvi: 5,
  panchvi: 5,
  fifth: 5,
};
const CHAIR = '(?:chair|chairs|kursi|seat|station)';

export function chairNumberIn(raw: string): number | null {
  const t = ` ${normalizeText(raw)} `;
  let m = t.match(
    new RegExp(
      `\\s${CHAIR}\\s+(?:number\\s+|no\\s+|num\\s+|#\\s*)?(\\d{1,2})\\s`,
      'u',
    ),
  );
  if (m) return +m[1];
  m = t.match(
    new RegExp(`\\s(\\d{1,2})\\s+(?:number\\s+|no\\s+)?${CHAIR}\\s`, 'u'),
  );
  if (m) return +m[1];
  m = t.match(
    new RegExp(
      `\\s${CHAIR}\\s+(?:number\\s+|no\\s+)?(${Object.keys(HINDI).join('|')})\\s`,
      'u',
    ),
  );
  if (m) return HINDI[m[1]];
  m = t.match(
    new RegExp(
      `\\s(${Object.keys(HINDI).join('|')})\\s+number\\s+${CHAIR}\\s`,
      'u',
    ),
  );
  if (m) return HINDI[m[1]];
  m = t.match(
    new RegExp(`\\s(${Object.keys(ORDINAL).join('|')})\\s+${CHAIR}\\s`, 'u'),
  );
  if (m) return ORDINAL[m[1]];
  m = t.match(
    new RegExp(`\\s${CHAIR}\\s+(${Object.keys(ORDINAL).join('|')})\\s`, 'u'),
  );
  if (m) return ORDINAL[m[1]];
  return null;
}

const numbersIn = (label: string) =>
  (normalizeText(label).match(/\d+/gu) ?? []).map(Number);

/** The one chair the sentence names by number, or null (none named, no match, or ambiguous). */
export function chairByNumber<T>(
  raw: string,
  rows: T[],
  labelOf: (r: T) => string,
): T | null {
  const n = chairNumberIn(raw);
  if (n === null) return null;
  const labelled = rows.filter((r) => numbersIn(labelOf(r)).length > 0);
  if (labelled.length) {
    const hits = labelled.filter((r) => numbersIn(labelOf(r)).includes(n));
    return hits.length === 1 ? hits[0] : null;
  }
  // No chair label carries a number: "the 2nd chair" is the 2nd in the shop's list.
  return n >= 1 && n <= rows.length ? rows[n - 1] : null;
}
