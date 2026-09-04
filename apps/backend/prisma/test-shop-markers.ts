/**
 * The single source of truth for every deterministic marker that identifies a row as belonging to
 * the prisma/seed-test-shops.ts / prisma/delete-test-shops.ts test-data batch. Pure constants and
 * pure functions only — no PrismaClient, no side effects, safe for both scripts to import without
 * either accidentally triggering the other's main().
 */

export const SALON_SLUG_PREFIX = 'test-shop-';
export const SALON_SLUG_EXACT_PATTERN = /^test-shop-([1-9][0-9]*)$/;
export const EMAIL_DOMAIN = 'fastque-test.internal';
// Ties an email to exactly one candidate salon's numeric index — capture group 2 is that index.
export const EMAIL_EXACT_PATTERN = /^(owner|barber(?:10|[1-9]))\+test-shop-([1-9][0-9]*)@fastque-test\.internal$/;
export const CITY_SLUG = 'hajipur-bihar';

// Versioned so a future, deliberately-different seed batch can never be confused with this one —
// delete-test-shops.ts requires an EXACT match on this string, not just a prefix.
export const TEST_DATA_MARKER = '[TEST DATA v1 seed:fastque-test-shops]';

/** The exact synthetic phone pattern the seed generates (+9180000 + 5-digit zero-padded index).
 * Deletion re-derives and cross-checks this as an independent marker tied to the slug's own
 * numeric index — a coincidental slug match alone can't also produce a matching phone. */
export function testShopPhone(n: number): string {
  return `+9180000${String(n).padStart(5, '0')}`;
}
