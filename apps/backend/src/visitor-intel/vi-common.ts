import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  resolveViRange,
  viFiltersSchema,
  type ViFilters,
  type ViRange,
  type ViScope,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';

export const viForbidden = (
  message = 'You do not have access to this part of Visitor Intelligence.',
) => new AppException('VI_FORBIDDEN', message, HttpStatus.FORBIDDEN);
export const viNotFound = (what = 'Record') =>
  new AppException('VI_NOT_FOUND', `${what} not found.`, HttpStatus.NOT_FOUND);
export const viBadRequest = (message: string) =>
  new AppException('VI_BAD_REQUEST', message, HttpStatus.BAD_REQUEST);

/** Server pepper so a leaked visitorKey cannot be reversed to the browser UUID by brute force of known ids. */
export function viVisitorKey(browserUuid: string): string {
  const pepper =
    process.env.VI_VISITOR_PEPPER ??
    process.env.JWT_ACCESS_SECRET ??
    'fastque-vi';
  return createHash('sha256')
    .update(`${pepper}:${browserUuid.toLowerCase()}`)
    .digest('hex');
}

export interface ViQuery {
  filters: ViFilters;
  range: ViRange;
}

export function parseViQuery(
  raw: Record<string, unknown>,
  now = new Date(),
): ViQuery {
  const parsed = viFiltersSchema.safeParse(raw);
  if (!parsed.success) throw viBadRequest('Invalid filters.');
  const filters = parsed.data;
  return {
    filters,
    range: resolveViRange(filters.period, now, {
      from: filters.from,
      to: filters.to,
    }),
  };
}

/**
 * WHERE fragment for vi_sessions (alias s) from filters + scope. Every value is a bound parameter.
 * A salon-scoped caller only ever sees sessions that touched one of their salons.
 */
export function sessionWhere(
  q: ViQuery,
  scope: ViScope,
  opts: { from?: Date; to?: Date; alias?: string } = {},
): Prisma.Sql {
  const a = Prisma.raw(opts.alias ?? 's');
  const from = opts.from ?? q.range.from;
  const to = opts.to ?? q.range.to;
  const parts: Prisma.Sql[] = [
    Prisma.sql`${a}."startedAt" >= ${from}`,
    Prisma.sql`${a}."startedAt" < ${to}`,
    Prisma.sql`${a}."isBot" = false`,
  ];
  const f = q.filters;
  if (f.country) parts.push(Prisma.sql`${a}.country = ${f.country}`);
  if (f.state) parts.push(Prisma.sql`${a}.state = ${f.state}`);
  if (f.city) parts.push(Prisma.sql`${a}.city = ${f.city}`);
  if (f.channel) parts.push(Prisma.sql`${a}.channel = ${f.channel}`);
  if (f.device) parts.push(Prisma.sql`${a}."deviceCategory" = ${f.device}`);
  if (f.campaignId)
    parts.push(Prisma.sql`${a}."campaignId" = ${f.campaignId}::uuid`);
  if (f.visitorType === 'new')
    parts.push(Prisma.sql`${a}."isNewVisitor" = true`);
  if (f.visitorType === 'returning')
    parts.push(Prisma.sql`${a}."isNewVisitor" = false`);
  if (f.visitorType === 'registered')
    parts.push(Prisma.sql`${a}."userId" IS NOT NULL`);
  if (f.visitorType === 'anonymous')
    parts.push(Prisma.sql`${a}."userId" IS NULL`);
  if (f.module)
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM vi_events me WHERE me."sessionId" = ${a}.id AND me.module = ${f.module})`,
    );
  if (scope.kind === 'territory') {
    parts.push(
      scope.cities.length
        ? Prisma.sql`lower(${a}.city) IN (${Prisma.join(scope.cities.map((c) => c.toLowerCase()))})`
        : Prisma.sql`false`,
    );
  }
  if (scope.kind === 'salon' || f.salonId) {
    const ids =
      scope.kind === 'salon'
        ? f.salonId
          ? scope.salonIds.filter((i) => i === f.salonId)
          : scope.salonIds
        : [f.salonId!];
    parts.push(
      ids.length
        ? Prisma.sql`EXISTS (SELECT 1 FROM vi_events se WHERE se."sessionId" = ${a}.id AND se."salonId" IN (${Prisma.join(ids)}))`
        : Prisma.sql`false`,
    );
  }
  return Prisma.join(parts, ' AND ');
}

export const num = (v: unknown): number => {
  if (v == null) return 0;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'object' && v && 'toNumber' in v)
    return (v as { toNumber(): number }).toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const pct = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

/** Masks a phone/email for roles without full PII rights. */
export function maskContact(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.includes('@')) {
    const [u, d] = v.split('@');
    return `${u.slice(0, 1)}***@${d}`;
  }
  return v.length > 4
    ? `${'*'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`
    : '****';
}

export function csvEscape(v: unknown): string {
  const s =
    v == null
      ? ''
      : typeof v === 'string'
        ? v
        : typeof v === 'number' ||
            typeof v === 'boolean' ||
            typeof v === 'bigint'
          ? String(v)
          : JSON.stringify(v);
  // Neutralise spreadsheet formula injection as well as quoting.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
