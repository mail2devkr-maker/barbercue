/**
 * Issue 3 (post-review fix) — deterministic search-suggestion ranking, independent of any
 * database engine. The backend (apps/backend/src/search/search.service.ts) still uses a
 * PostgreSQL query to pull a bounded CANDIDATE set out of a potentially large table (pg_trgm is a
 * legitimate, appropriate tool for that — an index-accelerated first pass), but which tier a
 * candidate lands in and how candidates within a tier are ordered is decided here, in pure
 * TypeScript, so the actual ranking/matching logic can be unit-tested directly without mocking a
 * database result into the shape the test wants. pg_trgm is never the sole authority: exact,
 * prefix, alias and token matches are all decided deterministically before fuzzy similarity is
 * even considered.
 *
 * Required tier order: exact > prefix > alias > token > fuzzy.
 */

export type SearchMatchTier = 'exact' | 'prefix' | 'alias' | 'token' | 'fuzzy';

export interface SearchMatchResult {
  tier: SearchMatchTier;
  score: number;
}

// Lower is better — the actual sort key.
const TIER_RANK: Record<SearchMatchTier, number> = {
  exact: 0,
  prefix: 1,
  alias: 2,
  token: 3,
  fuzzy: 4,
};

// Below this, two strings are considered unrelated for the fuzzy tier — the same conventional
// pg_trgm default value used server-side for cities/salons/services (see cities.service.ts's own
// FUZZY_SIMILARITY_THRESHOLD), kept here too so the two independent implementations (SQL and this
// pure one) agree on what counts as "plausibly the same word".
export const FUZZY_SIMILARITY_THRESHOLD = 0.3;

/**
 * Common grooming-industry typos, spacing/hyphenation variants and US/UK spelling differences,
 * grouped under one canonical term each. Purely a SEARCH-MATCHING aid — resolving "bear" to
 * "beard" only changes which existing salon-entered Service.name rows get suggested for the typo;
 * it never renames, rewrites, or normalizes what an owner actually typed when they added their
 * service. New groups can be added freely; each canonical term should be a real, findable word or
 * phrase that plausibly appears inside an owner's own service name (matched via `.includes`, not
 * exact equality) — see classifySearchMatch's alias-tier check below.
 */
export const SEARCH_ALIAS_GROUPS: Readonly<Record<string, readonly string[]>> = {
  beard: ['bear', 'beared', 'berad', 'baerd'],
  haircut: ['hair cut', 'hair-cut', 'hircut', 'hairct'],
  manicure: ['manicur', 'manicuer', 'mani', 'manic'],
  pedicure: ['pedicur', 'pedi'],
  massage: ['masage', 'massge', 'masaage'],
  facial: ['facal', 'fascial', 'faciel'],
  waxing: ['wax', 'waxin', 'waxxing'],
  threading: ['thredding', 'threding', 'thread'],
  makeup: ['make up', 'make-up', 'makup'],
  bridal: ['bridle'],
  shave: ['shaving', 'shav', 'shve'],
  fade: ['fed', 'faed', 'fadee'],
  colour: ['color', 'colr', 'colour'],
  spa: ['spaa'],
  nail: ['nails', 'nial'],
  hairdo: ['hair do', 'hair-do'],
} as const;

// Reverse lookup built once at module load: every alias variant AND every canonical term itself
// (so a correctly-spelled canonical query still resolves to its own group) maps to the canonical
// term. Built from SEARCH_ALIAS_GROUPS rather than hand-duplicated, so the two can never drift.
const ALIAS_TO_CANONICAL: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(SEARCH_ALIAS_GROUPS)) {
    map.set(canonical, canonical);
    for (const alias of aliases) map.set(alias, canonical);
  }
  return map;
})();

/** Lowercase, trim, and collapse punctuation/whitespace runs to single spaces — comparisons below
 * never care about case, extra spaces, or punctuation differences. */
export function normalizeForMatch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Resolves a (normalized) query to its known canonical alias term(s), or [] when the query isn't
 * a recognized alias/typo/canonical term at all. Only ever matches the WHOLE normalized query
 * against a whole alias entry — deliberately no partial/substring alias matching, which would
 * risk false positives ("spa" partially inside "spam" is not a real risk here, but the principle
 * holds for less contrived cases).
 */
export function resolveAliasCanonicalTerms(query: string): string[] {
  const canonical = ALIAS_TO_CANONICAL.get(normalizeForMatch(query));
  return canonical ? [canonical] : [];
}

/** Character trigrams of a string, padded with a single boundary space on each side (so short
 * strings and word edges still produce at least one gram, and a shared prefix/suffix counts). */
function trigramSet(value: string): Set<string> {
  const padded = ` ${value} `;
  const grams = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/**
 * Sørensen–Dice coefficient over character trigrams — a small, dependency-free, pure-JS
 * approximation of PostgreSQL's pg_trgm similarity(), close enough to rank plausible typos above
 * unrelated strings without requiring a live database connection to compute. Not required to be
 * bit-identical to pg_trgm's own algorithm; only required to agree on the same rough ordering.
 */
export function trigramSimilarity(a: string, b: string): number {
  const ga = trigramSet(a);
  const gb = trigramSet(b);
  if (ga.size === 0 || gb.size === 0) return a === b ? 1 : 0;
  let shared = 0;
  for (const gram of ga) if (gb.has(gram)) shared++;
  return (2 * shared) / (ga.size + gb.size);
}

/**
 * The single source of truth for "does this query match this candidate name, and how well" —
 * exact > prefix > alias > token > fuzzy, checked in that order, first match wins. Both the
 * `query` and `candidateName` are normalized internally, so callers can pass raw user input and
 * raw owner-entered text directly.
 */
export function classifySearchMatch(
  query: string,
  candidateName: string,
): SearchMatchResult | null {
  const q = normalizeForMatch(query);
  const name = normalizeForMatch(candidateName);
  if (!q || !name) return null;

  if (name === q) return { tier: 'exact', score: 1 };
  if (name.startsWith(q)) return { tier: 'prefix', score: 1 };

  for (const canonical of resolveAliasCanonicalTerms(q)) {
    if (name.includes(canonical)) return { tier: 'alias', score: 1 };
  }

  const queryTokens = q.split(' ');
  const nameTokens = new Set(name.split(' '));
  if (queryTokens.every((token) => nameTokens.has(token))) {
    return { tier: 'token', score: 1 };
  }

  const similarity = trigramSimilarity(q, name);
  if (similarity > FUZZY_SIMILARITY_THRESHOLD) {
    return { tier: 'fuzzy', score: similarity };
  }
  return null;
}

/**
 * Ranks and sorts a candidate list by classifySearchMatch's tier (ascending priority: exact
 * first), then by score descending within a tier, then alphabetically as a final, fully
 * deterministic tiebreaker. Candidates that don't match at all (`classifySearchMatch` returns
 * null) are dropped — callers that already filtered candidates via a broader database query
 * should treat a null classification here as "keep it in the lowest fuzzy tier instead of
 * dropping it" if they want to guarantee nothing already-fetched silently disappears; see
 * SearchService.suggest()'s own handling.
 */
export function rankSearchCandidates<T>(
  query: string,
  candidates: readonly T[],
  getName: (candidate: T) => string,
): { candidate: T; match: SearchMatchResult }[] {
  const matched: { candidate: T; match: SearchMatchResult }[] = [];
  for (const candidate of candidates) {
    const match = classifySearchMatch(query, getName(candidate));
    if (match) matched.push({ candidate, match });
  }
  matched.sort((a, b) => {
    const tierDiff = TIER_RANK[a.match.tier] - TIER_RANK[b.match.tier];
    if (tierDiff !== 0) return tierDiff;
    if (a.match.score !== b.match.score) return b.match.score - a.match.score;
    return getName(a.candidate).localeCompare(getName(b.candidate));
  });
  return matched;
}
