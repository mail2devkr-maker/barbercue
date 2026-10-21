import { EMPLOYEE_CODE_PATTERN } from '@barbercue/shared';

/** Reserved block 1-100 is owner-controlled (TOTP); standard IDs start at 101 and only ever grow. */
export const HR_RESERVED_MAX = 100;
export const HR_STANDARD_START = 101;
export const HR_CODE_NUMBER_MAX = 99_999;

export function codeFromNumber(value: number): string {
  return `FQ-FE-${String(value).padStart(5, '0')}`;
}

export function numberFromCode(code: string): number {
  if (!EMPLOYEE_CODE_PATTERN.test(code))
    throw new Error('Not an employee code');
  return Number(code.slice(6));
}

/** Same rule as the SQL used by the migration backfill: lower-case, collapsed whitespace, no diacritic stripping. */
export function nameKey(fullName: string): string {
  return fullName.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function nameFirstKey(fullName: string): string {
  return nameKey(fullName).split(' ')[0] ?? '';
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Indian numbers are compared on their last ten digits so +91 / 0 prefixes do not hide a match. */
export function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '•••';
  return `${local[0]}${'•'.repeat(Math.max(2, local.length - 1))}@${domain}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `${'•'.repeat(Math.max(0, digits.length - 3))}${digits.slice(-3)}`;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, (_, i) => [
    i,
    ...Array<number>(cols - 1).fill(0),
  ]);
  for (let j = 0; j < cols; j += 1) table[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      table[i][j] = Math.min(
        table[i - 1][j] + 1,
        table[i][j - 1] + 1,
        table[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return table[rows - 1][cols - 1];
}

/** Similar, not identical: same first name plus the same surname or surname initial, or a one/two letter slip. */
export function similarNames(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y || x === y) return false;
  const xt = x.split(' ');
  const yt = y.split(' ');
  if (xt[0] === yt[0]) {
    const xl = xt[xt.length - 1];
    const yl = yt[yt.length - 1];
    if (xl === yl || xl[0] === yl[0]) return true;
  }
  return Math.min(x.length, y.length) >= 6 && levenshtein(x, y) <= 2;
}

/** Calendar day in India for a `YYYY-MM-DD` boundary check ("not in the future" matches HR's clock). */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function fromDateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}
