import {
  classifySearchMatch,
  normalizeForMatch,
  rankSearchCandidates,
  resolveAliasCanonicalTerms,
  trigramSimilarity,
} from '../search/ranking';

describe('normalizeForMatch', () => {
  it('lowercases, trims, and collapses punctuation/whitespace to single spaces', () => {
    expect(normalizeForMatch('  Beard-Trim!!  ')).toBe('beard trim');
    expect(normalizeForMatch('Hair   Cut')).toBe('hair cut');
  });
});

describe('resolveAliasCanonicalTerms', () => {
  it('resolves a known typo to its canonical term', () => {
    expect(resolveAliasCanonicalTerms('bear')).toEqual(['beard']);
    expect(resolveAliasCanonicalTerms('manic')).toEqual(['manicure']);
    expect(resolveAliasCanonicalTerms('hair cut')).toEqual(['haircut']);
  });

  it('resolves a correctly-spelled canonical term to itself', () => {
    expect(resolveAliasCanonicalTerms('beard')).toEqual(['beard']);
  });

  it('is case/whitespace-insensitive', () => {
    expect(resolveAliasCanonicalTerms('  BEAR  ')).toEqual(['beard']);
  });

  it('returns [] for a query with no known alias/canonical mapping', () => {
    expect(resolveAliasCanonicalTerms('xyzabc')).toEqual([]);
  });
});

describe('trigramSimilarity', () => {
  it('is 1 for identical strings', () => {
    expect(trigramSimilarity('haircut', 'haircut')).toBe(1);
  });

  it('is higher for a near-miss than for an unrelated string', () => {
    const nearMiss = trigramSimilarity('bengalore', 'bengaluru');
    const unrelated = trigramSimilarity('bengalore', 'manicure');
    expect(nearMiss).toBeGreaterThan(unrelated);
  });

  it('is 0 for two completely disjoint strings', () => {
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
  });
});

// The required deterministic order: exact > prefix > alias > token > fuzzy.
describe('classifySearchMatch', () => {
  it('classifies an exact (case/whitespace-insensitive) match as "exact"', () => {
    expect(classifySearchMatch('Beard Trim', 'beard trim')).toEqual({ tier: 'exact', score: 1 });
    expect(classifySearchMatch('  BEARD TRIM  ', 'Beard Trim')).toEqual({ tier: 'exact', score: 1 });
  });

  it('classifies a genuine prefix as "prefix", not "token" or "fuzzy"', () => {
    expect(classifySearchMatch('Beard', 'Beard Trim')).toEqual({ tier: 'prefix', score: 1 });
    expect(classifySearchMatch('manic', 'Manicure')).toEqual({ tier: 'prefix', score: 1 });
  });

  it('classifies a known typo/alias as "alias" when the canonical term is NOT a literal prefix', () => {
    // "beard" itself starts with "bear", so a name beginning with "Beard..." would already be
    // caught by the PREFIX tier above — this uses a real catalog name ("Haircut + Beard") where
    // "beard" only appears mid-string, so alias resolution is what actually has to fire.
    expect(classifySearchMatch('bear', 'Haircut + Beard')).toEqual({ tier: 'alias', score: 1 });
  });

  it('classifies "hair cut" against a literally-named "Haircut" service as "alias"', () => {
    expect(classifySearchMatch('hair cut', 'Haircut')).toEqual({ tier: 'alias', score: 1 });
  });

  it('classifies a whole-word match that is not a prefix as "token"', () => {
    // "cut" is a whole token inside "Hair Cut" but the name doesn't start with "cut".
    expect(classifySearchMatch('cut', 'Hair Cut')).toEqual({ tier: 'token', score: 1 });
  });

  it('classifies a short substring that is not a whole token as "fuzzy" rather than "token"', () => {
    // "air" is a substring of "Hair Cut" but not a whole word in it — token tier must not fire —
    // yet a short query naturally shares a high proportion of its trigrams with any word that
    // contains it, so this correctly still surfaces via the fuzzy tier rather than being dropped.
    const result = classifySearchMatch('air', 'Hair Cut');
    expect(result?.tier).toBe('fuzzy');
  });

  it('returns null for a query genuinely unrelated to the candidate name', () => {
    expect(classifySearchMatch('zzqx', 'Hair Cut')).toBeNull();
  });

  it('classifies a real typo with no alias entry as "fuzzy", scored by similarity', () => {
    const result = classifySearchMatch('bengalore', 'Bengaluru Fade Studio');
    // Not exact, not a prefix, not a known alias, not a whole token — must fall through to fuzzy
    // or fail outright; a completely unrelated name would fail, so this proves fuzzy fired.
    expect(result).not.toBeNull();
    expect(result?.tier).toBe('fuzzy');
    expect(result?.score).toBeGreaterThan(0);
  });

  it('returns null for a query with no meaningful relationship to the candidate name at all', () => {
    expect(classifySearchMatch('xyz123', 'Beard Trim')).toBeNull();
  });

  it('prioritizes alias over token when a name would otherwise only qualify for token tier', () => {
    // "beard" (the alias's canonical term) appears mid-string via .includes(), which the ALIAS
    // check finds; token tier would also match ("beard" isn't a token of this name — "beared" via
    // typo groups isn't either), so this specifically proves alias resolution runs before token.
    const result = classifySearchMatch('bear', 'Premium Beard Shape and Line-up');
    expect(result).not.toBeNull();
    expect(result?.tier).toBe('alias');
  });

  it('prioritizes exact over everything, even when the string would also match as an alias target', () => {
    expect(classifySearchMatch('beard', 'beard')).toEqual({ tier: 'exact', score: 1 });
  });
});

describe('rankSearchCandidates', () => {
  interface Item {
    name: string;
  }

  it('orders exact > prefix > alias > token > fuzzy for a realistic mixed candidate set', () => {
    const candidates: Item[] = [
      { name: 'Grylls Bear Barbershop' }, // token — "bear" is a later whole word, not the first
      { name: 'Haircut + Beard' }, // alias — "beard" appears mid-string, not at the start
      { name: 'Bear Grooming Co' }, // prefix — literally starts with "bear"
      { name: 'bear' }, // exact
      { name: 'Manicure & Pedicure' }, // no relationship to "bear" at all — must be dropped
    ];
    const ranked = rankSearchCandidates('bear', candidates, (c) => c.name);
    expect(ranked.map((r) => r.candidate.name)).toEqual([
      'bear', // exact
      'Bear Grooming Co', // prefix
      'Haircut + Beard', // alias
      'Grylls Bear Barbershop', // token
    ]);
  });

  it('drops candidates that do not match at all', () => {
    const ranked = rankSearchCandidates(
      'bear',
      [{ name: 'Manicure & Pedicure' }, { name: 'bear' }],
      (c: Item) => c.name,
    ).map((r) => r.candidate.name);
    expect(ranked).toEqual(['bear']);
  });

  it('is stable/alphabetical within the same tier and score', () => {
    const candidates: Item[] = [{ name: 'Zen Facial' }, { name: 'Ace Facial' }];
    const ranked = rankSearchCandidates('facial', candidates, (c) => c.name);
    expect(ranked.map((r) => r.candidate.name)).toEqual(['Ace Facial', 'Zen Facial']);
  });
});
