import {
  classifyCityType,
  slugify,
  normalizeForSlug,
  assignSlugsForCountry,
  matchExistingCity,
  APPROVED_IDENTITY_OVERRIDES,
  APPROVED_ADM1_CITY_OVERRIDES,
  LEGACY_CITY_KEYS,
  isLegacyCityKey,
  type ExistingBarberCueCity,
  type SourceCityCandidate,
} from './global-locations.util';

describe('classifyCityType', () => {
  it('marks approved types as eligible', () => {
    expect(classifyCityType({ type: 'city', name: 'Mumbai' })).toBe('eligible');
    expect(classifyCityType({ type: 'capital', name: 'New Delhi' })).toBe('eligible');
    expect(classifyCityType({ type: 'gov_seat', name: 'Cotonou' })).toBe('eligible');
    expect(classifyCityType({ type: 'cities', name: 'Castle Vale' })).toBe('eligible');
  });

  it('excludes administrative-boundary and historical types without review', () => {
    expect(classifyCityType({ type: 'adm1', name: 'Bengaluru Urban' })).toBe('excluded');
    expect(classifyCityType({ type: 'district', name: 'Lucknow District' })).toBe('excluded');
    expect(classifyCityType({ type: 'historical', name: 'Rehab' })).toBe('excluded');
  });

  it('flags a district-pattern name for review even when the type is allowed', () => {
    // Real dataset example: "Bengaluru Rural" is typed 'city' despite being a district.
    expect(classifyCityType({ type: 'city', name: 'Bengaluru Rural' })).toBe('review');
    expect(classifyCityType({ type: 'city', name: 'Bengaluru Urban' })).toBe('review');
  });

  it('never silently expands the allowlist -- unknown types go to review', () => {
    expect(classifyCityType({ type: 'some-new-type-not-yet-approved', name: 'Anywhere' })).toBe(
      'review',
    );
    expect(classifyCityType({ type: null, name: 'Anywhere' })).toBe('review');
  });
});

describe('classifyCityType -- approved adm1 city overrides (India)', () => {
  it('has exactly the 17 human-reviewed source IDs approved for this override', () => {
    // Locks the exact set so a future edit here is a deliberate, reviewed diff, not an accident.
    expect([...APPROVED_ADM1_CITY_OVERRIDES].sort()).toEqual(
      [
        '133386', // Patna
        '57600', // Agartala
        '57995', // Bhopal
        '131649', // Daman
        '131676', // Dehradun
        '131778', // Dispur
        '131900', // Gandhinagar
        '131905', // Gangtok
        '132178', // Itanagar
        '132399', // Kargil
        '132432', // Kavaratti
        '132549', // Kohima
        '133342', // Panaji
        '133482', // Port Blair
        '133490', // Puducherry
        '133606', // Ranchi
        '133870', // Shillong
      ].sort(),
    );
  });

  it('Patna (sourceId 133386, type adm1) is eligible via the override', () => {
    expect(classifyCityType({ type: 'adm1', name: 'Patna', id: '133386' })).toBe('eligible');
  });

  it('every one of the 17 approved sourceIds is eligible when typed adm1', () => {
    for (const sourceId of APPROVED_ADM1_CITY_OVERRIDES) {
      expect(classifyCityType({ type: 'adm1', name: 'irrelevant-for-this-check', id: sourceId })).toBe(
        'eligible',
      );
    }
  });

  it('an approved sourceId only bypasses exclusion when the row is actually typed adm1', () => {
    // A coincidental id match on a row of some other excluded type must not be eligible via
    // this path -- the override is scoped to the adm1 misclassification it exists to fix, not a
    // general "these ids are always eligible" backdoor.
    expect(classifyCityType({ type: 'district', name: 'Patna', id: '133386' })).toBe('excluded');
    expect(classifyCityType({ type: 'historical', name: 'Patna', id: '133386' })).toBe('excluded');
  });

  it('representative genuine India adm1 districts/wards remain excluded, unaffected by the override', () => {
    // Real dr5hn rows verified during the classification audit: districts and Mumbai wards that
    // happen to also be tagged adm1, deliberately NOT added to the override.
    expect(classifyCityType({ type: 'adm1', name: 'Bengaluru Urban', id: '57848' })).toBe(
      'excluded',
    );
    expect(classifyCityType({ type: 'adm1', name: 'Central Delhi', id: '58171' })).toBe(
      'excluded',
    );
    expect(classifyCityType({ type: 'adm1', name: 'North Delhi', id: '133234' })).toBe(
      'excluded',
    );
    expect(classifyCityType({ type: 'adm1', name: 'Andheri', id: '147680' })).toBe('excluded');
    expect(classifyCityType({ type: 'adm1', name: 'Dharavi', id: '147737' })).toBe('excluded');
  });

  it('adm1 rows for India that are NOT in the override still exclude, even for a plausible city name', () => {
    // Guards against the override accidentally widening to "any adm1 row for a well-known name" --
    // an unlisted sourceId must never slip through even if its name looks like a real city.
    expect(classifyCityType({ type: 'adm1', name: 'Patna', id: '999999999' })).toBe('excluded');
  });

  it('the general adm1 exclusion rule itself is unchanged for non-India / non-approved rows', () => {
    expect(classifyCityType({ type: 'adm1', name: 'Some Other Country Region' })).toBe(
      'excluded',
    );
    expect(
      classifyCityType({ type: 'adm1', name: 'Some Other Country Region', id: '1' }),
    ).toBe('excluded');
  });
});

describe('slugify / normalizeForSlug', () => {
  it('matches SalonsService.slugify exactly for plain ASCII input', () => {
    expect(slugify('Mumbai')).toBe('mumbai');
    expect(slugify('New Delhi')).toBe('new-delhi');
    expect(slugify('  Chandigarh  ')).toBe('chandigarh');
  });

  it('strips diacritics via NFD normalization before slugifying, leaving ASCII names unaffected', () => {
    expect(normalizeForSlug('Bengaluru')).toBe('Bengaluru');
    expect(slugify(normalizeForSlug('São Paulo'))).toBe('sao-paulo');
  });
});

describe('assignSlugsForCountry', () => {
  it('assigns the bare slug when there is no collision', () => {
    const result = assignSlugsForCountry([{ sourceId: '1', cityName: 'Mumbai', regionName: 'Maharashtra', regionCode: 'IN-MH' }]);
    expect(result.get('1')).toEqual({ kind: 'assigned', slug: 'mumbai' });
  });

  it('disambiguates a bare-slug collision using the region name, deterministically', () => {
    const candidates = [
      { sourceId: 'a', cityName: 'Springfield', regionName: 'Illinois', regionCode: null },
      { sourceId: 'b', cityName: 'Springfield', regionName: 'Missouri', regionCode: null },
    ];
    const first = assignSlugsForCountry(candidates);
    const second = assignSlugsForCountry(candidates);
    expect(first.get('a')).toEqual({ kind: 'assigned', slug: 'springfield-illinois' });
    expect(first.get('b')).toEqual({ kind: 'assigned', slug: 'springfield-missouri' });
    // Deterministic / repeatable: re-running produces identical output.
    expect(second).toEqual(first);
  });

  it('reports an unresolved collision -- never auto-merges or invents an arbitrary suffix (same-name collision, Test I)', () => {
    const candidates = [
      { sourceId: 'x', cityName: 'Dibba Al Fujairah', regionName: 'Fujairah', regionCode: null },
      { sourceId: 'y', cityName: 'Dibba Al-Fujairah', regionName: 'Fujairah', regionCode: null },
    ];
    const result = assignSlugsForCountry(candidates);
    expect(result.get('x')).toMatchObject({ kind: 'unresolved-collision' });
    expect(result.get('y')).toMatchObject({ kind: 'unresolved-collision' });
  });

  // Phase 6A.3 regression suite: the proven cross-bare-name-group slug collision defect.
  // A city's own bare name can coincide with a *different* city's region-disambiguated slug.
  // regionCode is deliberately null throughout this describe block -- these prove that WITHOUT a
  // region code available, stage 3 (added later, Phase 6A.6) cannot rescue the collision and the
  // pre-6A.6 "stays unresolved" behavior is preserved exactly.
  describe('cross-group slug collisions (Phase 6A.3 fix, no region code available)', () => {
    it('Test A -- "Las Vegas"+"Santa Bárbara" never collides silently with "Las Vegas Santa Barbara"', () => {
      const candidates = [
        { sourceId: '54096', cityName: 'Las Vegas', regionName: 'Santa Bárbara', regionCode: null },
        { sourceId: 'other-las-vegas', cityName: 'Las Vegas', regionName: 'Francisco Morazán', regionCode: null },
        { sourceId: '54097', cityName: 'Las Vegas Santa Barbara', regionName: 'Santa Bárbara', regionCode: null },
      ];
      const result = assignSlugsForCountry(candidates);
      const slugs = [...result.values()].filter((r) => r.kind === 'assigned').map((r) => (r as { slug: string }).slug);
      expect(new Set(slugs).size).toBe(slugs.length); // no two assigned slugs are identical
      expect(result.get('54096')).toMatchObject({ kind: 'unresolved-collision' });
      expect(result.get('54097')).toMatchObject({ kind: 'unresolved-collision' });
      expect(result.get('other-las-vegas')).toEqual({ kind: 'assigned', slug: 'las-vegas-francisco-morazan' });
    });

    it('Test E -- generic synthetic cross-group collision is caught the same way (no region code)', () => {
      const candidates = [
        { sourceId: 'p1', cityName: 'Fictionville', regionName: 'Testonia', regionCode: null },
        { sourceId: 'p2', cityName: 'Fictionville', regionName: 'Otherland', regionCode: null },
        { sourceId: 'p3', cityName: 'Fictionville Testonia', regionName: 'Testonia', regionCode: null },
      ];
      const result = assignSlugsForCountry(candidates);
      expect(result.get('p1')).toMatchObject({ kind: 'unresolved-collision' });
      expect(result.get('p3')).toMatchObject({ kind: 'unresolved-collision' });
      expect(result.get('p2')).toEqual({ kind: 'assigned', slug: 'fictionville-otherland' });
    });
  });

  // Phase 6A.6 regression suite: the approved THIRD and FINAL disambiguation tier (region
  // ISO-3166-2 code suffix), exercised with real regionCode values so the four previously-missing
  // production cities become recoverable. Each test reproduces one real, confirmed case exactly
  // (real sourceIds, real region names, real ISO-3166-2 codes) -- not an approximation.
  describe('Stage 3: region ISO-3166-2 code disambiguation (Phase 6A.6)', () => {
    // Test A -- CORRECTED (Phase 6A.6 blocker finding): real data shows 54096 "Las Vegas" and
    // 54097 "Las Vegas Santa Barbara" are BOTH in the identical region (Santa Bárbara, HN-SB).
    // The ISO-code tier suffixes both with the SAME code, so their Stage-3 candidates are
    // IDENTICAL and collide with each other -- neither is rescued. This disproves the assumption
    // that region-code disambiguation can recover this specific real case.
    it('Test A -- Las Vegas / Las Vegas Santa Barbara: SAME region means the ISO-code tier cannot distinguish them either', () => {
      const candidates = [
        { sourceId: '54096', cityName: 'Las Vegas', regionName: 'Santa Bárbara', regionCode: 'HN-SB' },
        { sourceId: 'other-las-vegas', cityName: 'Las Vegas', regionName: 'Francisco Morazán', regionCode: 'HN-FM' },
        { sourceId: '54097', cityName: 'Las Vegas Santa Barbara', regionName: 'Santa Bárbara', regionCode: 'HN-SB' },
      ];
      const result = assignSlugsForCountry(candidates);
      expect(result.get('54096')).toMatchObject({ kind: 'unresolved-collision' });
      expect(result.get('54097')).toMatchObject({ kind: 'unresolved-collision' });
    });

    // Test B -- CORRECTED: real data shows 54310 "Santa Rita" and 54311 "Santa Rita Copan" are
    // BOTH in the identical region (Copán, HN-CP) -- same structural blocker as Test A.
    it('Test B -- Santa Rita / Santa Rita Copan: SAME region means the ISO-code tier cannot distinguish them either', () => {
      const candidates = [
        { sourceId: '54310', cityName: 'Santa Rita', regionName: 'Copán', regionCode: 'HN-CP' },
        { sourceId: 'other-santa-rita', cityName: 'Santa Rita', regionName: 'Yoro', regionCode: 'HN-YO' },
        { sourceId: '54311', cityName: 'Santa Rita Copan', regionName: 'Copán', regionCode: 'HN-CP' },
      ];
      const result = assignSlugsForCountry(candidates);
      expect(result.get('54310')).toMatchObject({ kind: 'unresolved-collision' });
      expect(result.get('54311')).toMatchObject({ kind: 'unresolved-collision' });
    });

    // Test C -- CORRECTED: 73265 "San Andrés" (region Hidalgo) and 73280 "San Andrés Hidalgo"
    // (region Oaxaca) are in DIFFERENT regions, so the ISO-code tier CAN distinguish them -- but
    // it distinguishes them by suffixing BOTH (each with its own distinct code), not by leaving
    // 73265 on its original plain slug. Since 73265 already exists in the live database with the
    // PLAIN slug "san-andres-hidalgo" (Phase 6A.5 finding), a real re-run would change its slug --
    // violating rule #1 ("DO NOT modify any existing city slug"). This is the general blocker:
    // the algorithm has no notion of "already live in the database" to protect one side of a pair.
    it('Test C -- San Andrés / San Andrés Hidalgo: DIFFERENT regions allow distinct Stage-3 slugs, but BOTH get suffixed (not just the missing one)', () => {
      const candidates = [
        { sourceId: '73265', cityName: 'San Andrés', regionName: 'Hidalgo', regionCode: 'MX-HID' },
        { sourceId: 'other-san-andres', cityName: 'San Andrés', regionName: 'Puebla', regionCode: 'MX-PUE' },
        { sourceId: '73280', cityName: 'San Andrés Hidalgo', regionName: 'Oaxaca', regionCode: 'MX-OAX' },
      ];
      const result = assignSlugsForCountry(candidates);
      // Both are rescued with distinct slugs -- proving the mechanism works when regions differ --
      // but note 73265 does NOT keep its current live-database slug "san-andres-hidalgo".
      expect(result.get('73265')).toEqual({ kind: 'assigned', slug: 'san-andres-hidalgo-mx-hid' });
      expect(result.get('73280')).toEqual({ kind: 'assigned', slug: 'san-andres-hidalgo-mx-oax' });
    });

    // Test D -- CORRECTED: real data shows 142522 "Emiliano Zapata" and 142523 "Emiliano Zapata
    // Jalisco" are BOTH in the identical region (Jalisco, MX-JAL) -- same blocker as Tests A/B.
    it('Test D -- Emiliano Zapata / Emiliano Zapata Jalisco: SAME region means the ISO-code tier cannot distinguish them either', () => {
      const candidates = [
        { sourceId: '142522', cityName: 'Emiliano Zapata', regionName: 'Jalisco', regionCode: 'MX-JAL' },
        { sourceId: 'other-emiliano-zapata', cityName: 'Emiliano Zapata', regionName: 'Tabasco', regionCode: 'MX-TAB' },
        { sourceId: '142523', cityName: 'Emiliano Zapata Jalisco', regionName: 'Jalisco', regionCode: 'MX-JAL' },
      ];
      const result = assignSlugsForCountry(candidates);
      expect(result.get('142522')).toMatchObject({ kind: 'unresolved-collision' });
      expect(result.get('142523')).toMatchObject({ kind: 'unresolved-collision' });
    });

    // Test E: even the ISO-code candidate can collide -- with an entirely unrelated, already-
    // assigned slug from a different bare-name group -- and no winner is ever chosen for the one
    // that loses that collision; no fourth tier is invented.
    it('Test E -- a Stage-3 candidate colliding with an unrelated already-assigned slug stays unresolved (no winner chosen)', () => {
      const candidates = [
        // r1 collides with r3 on the bare name "Springfield" -> disambiguated to
        // "springfield-alpha" at stage 1/2.
        { sourceId: 'r1', cityName: 'Springfield', regionName: 'Alpha', regionCode: 'AL-01' },
        { sourceId: 'r2', cityName: 'Springfield', regionName: 'Beta', regionCode: 'AL-02' },
        // r3's own bare name is exactly "Springfield Alpha" -- coincides with r1's disambiguated
        // slug, exactly the Phase 6A.3 cross-group pattern. r3 is in a DIFFERENT region than r1,
        // so r3's own Stage-3 candidate ("springfield-alpha-al-03") is unique and gets rescued.
        { sourceId: 'r3', cityName: 'Springfield Alpha', regionName: 'Gamma', regionCode: 'AL-03' },
        // r4 is entirely unrelated (a different bare-name group) but its OWN bare name happens to
        // equal exactly what r1's Stage-3 candidate would compute to -- claiming that slug first.
        { sourceId: 'r4', cityName: 'Springfield Alpha Al 01', regionName: 'Delta', regionCode: 'AL-04' },
      ];
      const result = assignSlugsForCountry(candidates);
      expect(result.get('r4')).toEqual({ kind: 'assigned', slug: 'springfield-alpha-al-01' });
      // r1's Stage-3 candidate ("springfield-alpha-al-01") collides with r4's already-assigned
      // slug -- r1 does NOT silently win it away from r4, and r1 itself stays unresolved.
      expect(result.get('r1')).toMatchObject({ kind: 'unresolved-collision' });
      // r3, in a different region, has a genuinely unique Stage-3 candidate and IS rescued.
      expect(result.get('r3')).toEqual({ kind: 'assigned', slug: 'springfield-alpha-al-03' });
      // r2 was never part of any collision at all.
      expect(result.get('r2')).toEqual({ kind: 'assigned', slug: 'springfield-beta' });
    });

    // Test F: order independence holds with Stage 3 active too.
    it('Test F -- output is identical regardless of candidate array order (Stage 3 active)', () => {
      const candidates = [
        { sourceId: '54096', cityName: 'Las Vegas', regionName: 'Santa Bárbara', regionCode: 'HN-SB' },
        { sourceId: 'other-las-vegas', cityName: 'Las Vegas', regionName: 'Francisco Morazán', regionCode: 'HN-FM' },
        { sourceId: '54097', cityName: 'Las Vegas Santa Barbara', regionName: 'Santa Bárbara', regionCode: 'HN-SB' },
      ];
      const forward = assignSlugsForCountry(candidates);
      const reversed = assignSlugsForCountry([...candidates].reverse());
      const shuffled = assignSlugsForCountry([candidates[2], candidates[0], candidates[1]]);
      expect(reversed).toEqual(forward);
      expect(shuffled).toEqual(forward);
    });

    // Test G: no candidate is ever silently dropped -- every sourceId appears in the result Map,
    // whether recovered, still unresolved, or never in collision at all.
    it('Test G -- no candidate loss: result.size always equals candidates.length', () => {
      const candidates = [
        { sourceId: '54096', cityName: 'Las Vegas', regionName: 'Santa Bárbara', regionCode: 'HN-SB' },
        { sourceId: 'other-las-vegas', cityName: 'Las Vegas', regionName: 'Francisco Morazán', regionCode: 'HN-FM' },
        { sourceId: '54097', cityName: 'Las Vegas Santa Barbara', regionName: 'Santa Bárbara', regionCode: 'HN-SB' },
        { sourceId: 'mumbai', cityName: 'Mumbai', regionName: 'Maharashtra', regionCode: 'IN-MH' },
      ];
      const result = assignSlugsForCountry(candidates);
      expect(result.size).toBe(candidates.length);
    });

    // Test H: ordinary non-colliding cities and ordinary two-tier region-name disambiguation are
    // completely unaffected by Stage 3 existing.
    it('Test H -- ordinary non-colliding and region-name-disambiguated cities are unchanged', () => {
      const candidates = [
        { sourceId: 'mumbai', cityName: 'Mumbai', regionName: 'Maharashtra', regionCode: 'IN-MH' },
        { sourceId: 'delhi', cityName: 'Delhi', regionName: 'Delhi', regionCode: 'IN-DL' },
        { sourceId: 'a', cityName: 'Springfield', regionName: 'Illinois', regionCode: 'US-IL' },
        { sourceId: 'b', cityName: 'Springfield', regionName: 'Missouri', regionCode: 'US-MO' },
      ];
      const result = assignSlugsForCountry(candidates);
      expect(result.get('mumbai')).toEqual({ kind: 'assigned', slug: 'mumbai' });
      expect(result.get('delhi')).toEqual({ kind: 'assigned', slug: 'delhi' });
      expect(result.get('a')).toEqual({ kind: 'assigned', slug: 'springfield-illinois' });
      expect(result.get('b')).toEqual({ kind: 'assigned', slug: 'springfield-missouri' });
    });

    // Test J: global final-slug uniqueness holds across a large mixed set combining Stage-3
    // recoveries, ordinary assignments, and a Stage-3 collision together.
    it('Test J -- guarantees global final-slug uniqueness across a mixed candidate set including Stage-3 recoveries', () => {
      const candidates = [
        { sourceId: '54096', cityName: 'Las Vegas', regionName: 'Santa Bárbara', regionCode: 'HN-SB' },
        { sourceId: 'other-las-vegas', cityName: 'Las Vegas', regionName: 'Francisco Morazán', regionCode: 'HN-FM' },
        { sourceId: '54097', cityName: 'Las Vegas Santa Barbara', regionName: 'Santa Bárbara', regionCode: 'HN-SB' },
        { sourceId: '73265', cityName: 'San Andrés', regionName: 'Hidalgo', regionCode: 'MX-HID' },
        { sourceId: 'other-san-andres', cityName: 'San Andrés', regionName: 'Puebla', regionCode: 'MX-PUE' },
        { sourceId: '73280', cityName: 'San Andrés Hidalgo', regionName: 'Oaxaca', regionCode: 'MX-OAX' },
        { sourceId: 'a', cityName: 'Springfield', regionName: 'Illinois', regionCode: 'US-IL' },
        { sourceId: 'b', cityName: 'Springfield', regionName: 'Missouri', regionCode: 'US-MO' },
        { sourceId: 'mumbai', cityName: 'Mumbai', regionName: 'Maharashtra', regionCode: 'IN-MH' },
      ];
      const result = assignSlugsForCountry(candidates);
      // Every distinct assigned slug is unique, regardless of how many candidates remain
      // unresolved (the invariant this fix guarantees is uniqueness among ASSIGNED slugs, not
      // that every candidate necessarily gets assigned).
      const assignedSlugs = [...result.values()]
        .filter((r) => r.kind === 'assigned')
        .map((r) => (r as { slug: string }).slug);
      expect(new Set(assignedSlugs).size).toBe(assignedSlugs.length);
      // 54096/54097 (same region -- Test A/blocker) remain unresolved; the other 7 (San Andrés
      // pair in different regions, Springfield pair, Mumbai) are all assigned.
      expect(result.get('54096')).toMatchObject({ kind: 'unresolved-collision' });
      expect(result.get('54097')).toMatchObject({ kind: 'unresolved-collision' });
      expect(assignedSlugs.length).toBe(candidates.length - 2);
    });
  });
});

describe('matchExistingCity', () => {
  const bengaluru: ExistingBarberCueCity = {
    id: '028c26d5-05c5-4f9c-bb95-bd72ed947b1f',
    name: 'Bengaluru',
    slug: 'bengaluru',
    countryCode: 'IN',
    state: 'Karnataka',
  };

  it('matches on exact normalized name within the same country', () => {
    const pool: SourceCityCandidate[] = [
      { sourceId: '57933', name: 'Bengaluru', countryCode: 'IN', stateCode: 'KA', wikiDataId: 'Q1355' },
      { sourceId: '57847', name: 'Bengaluru Rural', countryCode: 'IN', stateCode: 'KA', wikiDataId: 'Q806464' },
    ];
    const result = matchExistingCity(bengaluru, pool);
    expect(result).toEqual({
      kind: 'matched',
      method: 'exact-name',
      source: pool[0],
    });
  });

  it('never relies on wikiDataId alone -- a shared wikiDataId across unrelated rows does not cause a false match', () => {
    // Real dataset finding: wikiDataId Q16350064 is shared by 34 unrelated Albanian rows.
    const pool: SourceCityCandidate[] = [
      { sourceId: '1', name: 'Totally Unrelated City', countryCode: 'IN', stateCode: 'KA', wikiDataId: 'Q16350064' },
      { sourceId: '2', name: 'Bengaluru', countryCode: 'IN', stateCode: 'KA', wikiDataId: 'Q1355' },
    ];
    const result = matchExistingCity(bengaluru, pool);
    expect(result.kind).toBe('matched');
    expect((result as { source: SourceCityCandidate }).source.sourceId).toBe('2');
  });

  it('reports ambiguous when more than one source row has the same normalized name', () => {
    const pool: SourceCityCandidate[] = [
      { sourceId: '1', name: 'Bengaluru', countryCode: 'IN', stateCode: 'KA', wikiDataId: null },
      { sourceId: '2', name: 'bengaluru', countryCode: 'IN', stateCode: 'KA', wikiDataId: null },
    ];
    const result = matchExistingCity(bengaluru, pool);
    expect(result.kind).toBe('ambiguous');
  });

  it('reports unmatched when no source row has the same name', () => {
    const result = matchExistingCity(bengaluru, []);
    expect(result).toEqual({ kind: 'unmatched' });
  });

  it('resolves Kochi via the approved manual override to dr5hn "Cochin", never by name', () => {
    const kochi: ExistingBarberCueCity = {
      id: '5bb96869-c525-45db-b935-b1a92008b81f',
      name: 'Kochi',
      slug: 'kochi',
      countryCode: 'IN',
      state: 'Kerala',
    };
    expect(APPROVED_IDENTITY_OVERRIDES['kochi']).toEqual({ countryCode: 'IN', sourceId: '131617' });

    const pool: SourceCityCandidate[] = [
      { sourceId: '131617', name: 'Cochin', countryCode: 'IN', stateCode: 'KL', wikiDataId: 'Q1800' },
    ];
    const result = matchExistingCity(kochi, pool);
    expect(result).toEqual({ kind: 'matched', method: 'approved-override', source: pool[0] });
  });

  it('does not apply the Kochi override to a same-slug city in a different country', () => {
    const notIndia: ExistingBarberCueCity = {
      id: 'other',
      name: 'Kochi',
      slug: 'kochi',
      countryCode: 'JP', // hypothetical -- override is scoped to IN
      state: 'Somewhere',
    };
    const pool: SourceCityCandidate[] = [
      { sourceId: '131617', name: 'Cochin', countryCode: 'IN', stateCode: 'KL', wikiDataId: 'Q1800' },
    ];
    const result = matchExistingCity(notIndia, pool);
    expect(result.kind).toBe('unmatched');
  });

  it('never mutates the existing-city input it is given (preservation guarantee)', () => {
    const snapshot = { ...bengaluru };
    matchExistingCity(bengaluru, [
      { sourceId: '57933', name: 'Bengaluru', countryCode: 'IN', stateCode: 'KA', wikiDataId: 'Q1355' },
    ]);
    expect(bengaluru).toEqual(snapshot);
  });
});

// Phase 4A regression: the importer's second run (dry-run or real) found that all 99,797 rows in
// the database -- including the original 21 -- carry `sourceDataset = 'dr5hn'` after the first
// real import backfilled that field onto the legacy rows too. sourceDataset can therefore never
// be used to distinguish "legacy" from "imported" -- only the explicit, hardcoded
// LEGACY_CITY_KEYS allowlist can.
describe('LEGACY_CITY_KEYS / isLegacyCityKey (Phase 4A reconciliation-scope fix)', () => {
  it('contains exactly the 21 approved legacy cities, all in India', () => {
    expect(LEGACY_CITY_KEYS).toHaveLength(21);
    expect(LEGACY_CITY_KEYS.every((k) => k.countryCode === 'IN')).toBe(true);
    expect(LEGACY_CITY_KEYS.map((k) => k.slug).sort()).toEqual(
      [
        'ahmedabad', 'bengaluru', 'bhubaneswar', 'chandigarh', 'chennai', 'coimbatore', 'delhi',
        'gurugram', 'guwahati', 'hyderabad', 'indore', 'jaipur', 'kochi', 'kolkata', 'lucknow',
        'mumbai', 'nagpur', 'noida', 'pune', 'surat', 'visakhapatnam',
      ].sort(),
    );
  });

  it('accepts exactly the 21 approved legacy (countryCode, slug) pairs', () => {
    for (const { countryCode, slug } of LEGACY_CITY_KEYS) {
      expect(isLegacyCityKey(countryCode, slug)).toBe(true);
    }
  });

  it('excludes newly-imported cities that are not in the allowlist, even if they share a country', () => {
    // A source city like Armenia's "Abovyan" is never in this list -- but neither is an
    // unrelated Indian city the importer creates from the source dataset (e.g. a district-level
    // town dr5hn calls "Nagercoil", never hand-approved as a BarberCue legacy row).
    expect(isLegacyCityKey('AM', 'abovyan')).toBe(false);
    expect(isLegacyCityKey('IN', 'nagercoil')).toBe(false);
  });

  it('requires BOTH countryCode and slug to match -- a same-slug city in a different country is never accidentally included', () => {
    // Guards against exactly the mistake the fix must avoid: matching on slug alone would wrongly
    // treat a hypothetical non-Indian "bengaluru"-slugged city as legacy too.
    expect(isLegacyCityKey('XX', 'bengaluru')).toBe(false);
    expect(isLegacyCityKey('IN', 'bengaluru')).toBe(true);
  });

  it('simulates the importer reconciliation snapshot: only the 21 legacy rows are selected out of a mixed pool, and Armenia\'s two legitimate "Abovyan" rows never enter legacy reconciliation', () => {
    // Mimics the shape of `existingCitiesSnapshot` after filtering a full mixed-content table
    // (21 legacy rows + imported rows including the two real, distinct Armenian "Abovyan"
    // entries from the Phase 3 review) down to only rows matching LEGACY_CITY_KEYS.
    const mixedTablePool = [
      ...LEGACY_CITY_KEYS.map((k, i) => ({ id: `legacy-${i}`, countryCode: k.countryCode, slug: k.slug })),
      { id: 'imported-abovyan-1', countryCode: 'AM', slug: 'abovyan-kotayk' },
      { id: 'imported-abovyan-2', countryCode: 'AM', slug: 'abovyan-yerevan' },
      { id: 'imported-mysuru', countryCode: 'IN', slug: 'mysuru' },
    ];
    const legacySnapshot = mixedTablePool.filter((row) => isLegacyCityKey(row.countryCode, row.slug));
    expect(legacySnapshot).toHaveLength(21);
    expect(legacySnapshot.some((r) => r.slug.startsWith('abovyan'))).toBe(false);
    expect(legacySnapshot.some((r) => r.slug === 'mysuru')).toBe(false);
  });

  it('still resolves Kochi via the approved override once scoped to only the legacy allowlist', () => {
    expect(isLegacyCityKey('IN', 'kochi')).toBe(true);
    const kochi: ExistingBarberCueCity = {
      id: '5bb96869-c525-45db-b935-b1a92008b81f',
      name: 'Kochi',
      slug: 'kochi',
      countryCode: 'IN',
      state: 'Kerala',
    };
    const pool: SourceCityCandidate[] = [
      { sourceId: '131617', name: 'Cochin', countryCode: 'IN', stateCode: 'KL', wikiDataId: 'Q1800' },
    ];
    expect(matchExistingCity(kochi, pool)).toEqual({
      kind: 'matched',
      method: 'approved-override',
      source: pool[0],
    });
  });

  it('a genuine legacy city still throws-worthy "ambiguous" when it matches more than one source row', () => {
    // Confirms the fix did not weaken the existing safety behavior for a true legacy city.
    const bengaluru: ExistingBarberCueCity = {
      id: '028c26d5-05c5-4f9c-bb95-bd72ed947b1f',
      name: 'Bengaluru',
      slug: 'bengaluru',
      countryCode: 'IN',
      state: 'Karnataka',
    };
    const pool: SourceCityCandidate[] = [
      { sourceId: '1', name: 'Bengaluru', countryCode: 'IN', stateCode: 'KA', wikiDataId: null },
      { sourceId: '2', name: 'bengaluru', countryCode: 'IN', stateCode: 'KA', wikiDataId: null },
    ];
    expect(matchExistingCity(bengaluru, pool).kind).toBe('ambiguous');
  });
});
