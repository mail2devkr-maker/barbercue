import type { Dr5hnCityRow } from './dr5hn-types';

// ---- Source metadata (Phase 3 approved decision #9) ----
export const SOURCE_DATASET = 'dr5hn';
export const SOURCE_VERSION = 'v3.2-export.7';

// ---- City type classification (Phase 3 approved decision #3) ----
// Approved allowlist -- gov_seat/cities were added based on actual Phase 2 inspection evidence
// (e.g. Cotonou is Benin's real seat of government and largest city, typed 'gov_seat'; 'cities'
// is a source pluralization/typo covering otherwise-ordinary places like Castle Vale/Eloúnda).
export const CITY_TYPE_ALLOWED = new Set([
  'city',
  'capital',
  'municipality',
  'town',
  'village',
  'locality',
  'settlement',
  'township',
  'gov_seat',
  'cities',
]);

// Explicit exclusion list -- administrative-boundary types that dr5hn stores in the same table
// as real cities (confirmed via real examples: Bengaluru's own area has 'Bengaluru Urban'/
// 'Bengaluru Rural' district rows alongside the real city, all typed 'adm1'/'city') plus
// non-current/non-place entities. Anything NOT on either list falls to manual review --
// per approved decision #3, the allowlist is never silently expanded beyond what's listed here.
export const CITY_TYPE_EXCLUDED = new Set([
  'adm1',
  'adm2',
  'adm3',
  'adm4',
  'adm5',
  'district',
  'county',
  'province',
  'regency',
  'prefecture',
  'oblast',
  'banner',
  'section',
  'region',
  'administrative zone',
  'area',
  'historical',
  'destroyed',
  'abandoned',
  'religious',
  'historical_capital',
]);

// A source city name matching this pattern is held for manual review even if its `type` is on
// the allowlist -- catches district-like entities the source occasionally mistypes as 'city'
// (e.g. "Bengaluru Rural", type='city', population=null).
const DISTRICT_NAME_PATTERN =
  /\b(Urban|Rural|District|Division|County|Metropolitan|Municipality|Prefecture|Suburban)\b/i;

/**
 * A small number of dr5hn rows for genuine, well-known Indian state/UT capitals are tagged
 * type='adm1' (administrative-boundary level) rather than a CITY_TYPE_ALLOWED type -- a real
 * inconsistency in dr5hn's own upstream classification for India specifically, confirmed by a
 * full manual audit of all 41 India rows tagged 'adm1': population/type alone cannot reliably
 * separate "genuine capital city mistagged as adm1" from "genuine administrative subdivision"
 * (e.g. Delhi's own "Central Delhi"/"North Delhi" sub-districts are ALSO adm1 with real,
 * substantial populations, and "Bengaluru"/"Bengaluru Urban" both appear as adm1 rows alongside
 * BarberCue's already-legacy-protected Bengaluru city). A mechanical field-based rule was
 * therefore rejected in favor of this small, individually human-reviewed allowlist -- the same
 * "never silently merge/expand" philosophy as APPROVED_IDENTITY_OVERRIDES below.
 *
 * Each of the 17 entries here was individually verified against: (1) a real, substantial
 * population and a real Wikidata *city* entity (not an administrative-division entity), (2)
 * confirmed absent from BarberCue's City table under any name/type at the time of review, (3)
 * confirmed no (countryId, slug) collision risk against the then-current 99,797-row table. The
 * 15 other India adm1 rows reviewed alongside these (Bengaluru Urban; Central/North Delhi; and
 * 11 Mumbai neighborhoods/wards -- Andheri, Bandra, Chembur, Dharavi, Fort, Ghatkopar, Mahim,
 * Matunga, Mazagaon, Parel, Trombay, Vile Parle) were deliberately NOT added -- they are genuine
 * administrative subdivisions or city wards, not independent cities, and remain excluded by the
 * general adm1 rule below exactly as before. Two more India adm1 rows worth noting for whoever
 * revisits this list -- "Delhi" and "Bengaluru" -- were reviewed and intentionally excluded from
 * this override for a different reason: both names are *already* present in BarberCue's City
 * table via the original legacy/reconciliation path, so adding their adm1 rows here would create
 * a duplicate rather than fill a gap.
 *
 * Keyed by the row's immutable numeric sourceId (dr5hn's own `id` column), never by name --
 * names collide across unrelated places in this source (multiple "Srinagar"s exist, for
 * instance) and are not a safe identity for a hardcoded override. Adding an entry here is a
 * deliberate, individually-reviewed decision -- never expanded mechanically, and never a
 * blanket "allow all adm1 for India" rule.
 */
export const APPROVED_ADM1_CITY_OVERRIDES = new Set<string>([
  '133386', // Patna, Bihar (IN-BR) -- state capital
  '57600', // Agartala, Tripura (IN-TR) -- state capital
  '57995', // Bhopal, Madhya Pradesh (IN-MP) -- state capital
  '131649', // Daman, Dadra and Nagar Haveli and Daman and Diu (IN-DH) -- UT capital
  '131676', // Dehradun, Uttarakhand (IN-UK) -- state capital
  '131778', // Dispur, Assam (IN-AS) -- state capital
  '131900', // Gandhinagar, Gujarat (IN-GJ) -- state capital
  '131905', // Gangtok, Sikkim (IN-SK) -- state capital
  '132178', // Itanagar, Arunachal Pradesh (IN-AR) -- state capital
  '132399', // Kargil, Ladakh (IN-LA) -- major town / district HQ
  '132432', // Kavaratti, Lakshadweep (IN-LD) -- UT capital
  '132549', // Kohima, Nagaland (IN-NL) -- state capital
  '133342', // Panaji, Goa (IN-GA) -- state capital
  '133482', // Port Blair, Andaman and Nicobar Islands (IN-AN) -- UT capital
  '133490', // Puducherry, Puducherry (IN-PY) -- UT capital
  '133606', // Ranchi, Jharkhand (IN-JH) -- state capital
  '133870', // Shillong, Meghalaya (IN-ML) -- state capital
]);

export type CityClassification = 'eligible' | 'excluded' | 'review';

export function classifyCityType(
  // `id` is optional (not part of the original Pick) purely to avoid touching every existing
  // call site/test that never had a reason to pass it -- omitting it simply means "this call
  // can never match an override", which is the correct behavior for any caller that doesn't
  // have a real sourceId to check (e.g. hand-written test fixtures for the general rules).
  city: Pick<Dr5hnCityRow, 'type' | 'name'> & { id?: string | null },
): CityClassification {
  const type = city.type;
  if (type !== null && CITY_TYPE_ALLOWED.has(type)) {
    return DISTRICT_NAME_PATTERN.test(city.name ?? '') ? 'review' : 'eligible';
  }
  // Checked before the general exclusion below, and scoped to type==='adm1' specifically (the
  // only type any approved override entry actually has) -- an id that happens to coincide with
  // an override entry for a row of some other excluded type is not eligible via this path.
  if (type === 'adm1' && city.id != null && APPROVED_ADM1_CITY_OVERRIDES.has(city.id)) {
    return 'eligible';
  }
  if (type !== null && CITY_TYPE_EXCLUDED.has(type)) {
    return 'excluded';
  }
  // null type, or a type not on either approved list -- never silently expand the allowlist.
  return 'review';
}

// ---- Slug generation (Phase 3 approved decision #7) ----

/**
 * Strips combining diacritical marks after NFD (Unicode canonical) decomposition, e.g.
 * "São Paulo" -> "Sao Paulo". A pre-step in front of the existing slugify() below, not a
 * replacement for it -- existing BarberCue slugs (all ASCII) are provably unaffected since NFD
 * decomposition + diacritic stripping is a no-op on text that has no combining marks to begin
 * with.
 */
export function normalizeForSlug(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Byte-for-byte the same algorithm as SalonsService's private `slugify()`
 * (apps/backend/src/salons/salons.service.ts) -- duplicated here rather than imported because
 * that function is not exported and this importer must not modify unrelated application code
 * just to expose it. Any change to one must be mirrored in the other.
 */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'shop'
  );
}

export interface SlugCandidate {
  sourceId: string;
  cityName: string;
  regionName: string | null;
  // Region's ISO-3166-2 code (e.g. "HN-SB"), matching Region.code in schema.prisma. Used only as
  // the approved THIRD and FINAL City-slug disambiguation tier (Phase 6A.6) -- never fabricated:
  // a candidate with no region code simply cannot use this tier and stays unresolved.
  regionCode: string | null;
}

export type SlugResolution =
  | { kind: 'assigned'; slug: string }
  | {
      kind: 'unresolved-collision';
      bareSlug: string;
      regionSlug: string | null;
    };

/**
 * Deterministic, repeatable slug assignment for a group of same-country cities. Bare-slug
 * collisions are disambiguated by appending the region's slug (e.g. springfield-illinois vs
 * springfield-missouri); a residual collision after that (same name AND same region -- a real
 * source near-duplicate, e.g. "Dibba Al Fujairah" vs "Dibba Al-Fujairah") is never auto-merged
 * or given an arbitrary suffix -- it is reported as unresolved for manual review.
 *
 * Phase 6A.3 fix: stage 1 below (unchanged from the original design) only detects collisions
 * *within* one bare-name group. A real, proven case slipped through it: "Las Vegas" (Honduras)
 * collided with another same-named city, was disambiguated to "las-vegas-santa-barbara" by
 * appending its own region's name -- which happened to exactly equal the independently-computed
 * bare slug of a *different*, unrelated city literally named "Las Vegas Santa Barbara". Both were
 * marked "assigned" by stage 1 (each looked unique from inside its own bare-name group), and the
 * importer's idempotent `upsert({where: {countryId_slug}, update: {}})` silently treated whichever
 * one wrote second as a no-op update against the first -- a source city disappeared with no error
 * and no manual-review entry. Three more real cases (Santa Rita/Copán, San Andrés/Hidalgo,
 * Emiliano Zapata/Jalisco) proved this is a structural gap, not a one-off.
 *
 * Stage 2 closes it: after every candidate has a stage-1 slug, group ALL "assigned" results
 * (across every bare-name group, not per-group) by their final slug string. Any string claimed by
 * more than one candidate is downgraded to "unresolved-collision" for every candidate that
 * shares it -- never auto-merged, never given a further invented suffix (no new disambiguation
 * tier is approved beyond bare -> region-name), and never decided by iteration/write order. This
 * is intentionally the same "send it to manual review" outcome stage 1 already uses for a
 * same-group collision -- stage 2 just widens the scope of the existing rule to the whole
 * candidate set.
 *
 * Phase 6A.6 approved a third and FINAL tier for whatever stages 1-2 still leave unresolved:
 * <stage-1/2 slug> + '-' + the region's own ISO-3166-2 code (Region.code), e.g.
 * "las-vegas-santa-barbara" + "-hn-sb". This resolves the proven case above (the region's *name*
 * coincided with another city's own name; its ISO *code* does not) without touching any existing
 * city's already-assigned slug. Never fabricated: a candidate with no region code simply cannot
 * use this tier. If the resulting candidate itself collides -- checked against the complete
 * per-country slug namespace, not just the original pair -- no winner is chosen; every colliding
 * candidate remains "unresolved-collision", exactly as stage 2 already does. No fourth tier
 * exists, which is the only change needed to make the API's real invariant -- no two
 * distinct candidates may share a final (countryId, slug) -- actually hold.
 */
export function assignSlugsForCountry(
  candidates: SlugCandidate[],
): Map<string, SlugResolution> {
  const bareSlugOf = new Map<string, string>();
  const regionCodeOf = new Map<string, string | null>();
  const bareGroups = new Map<string, SlugCandidate[]>();
  for (const c of candidates) {
    const bare = slugify(normalizeForSlug(c.cityName));
    bareSlugOf.set(c.sourceId, bare);
    regionCodeOf.set(c.sourceId, c.regionCode);
    if (!bareGroups.has(bare)) bareGroups.set(bare, []);
    bareGroups.get(bare)!.push({ ...c, cityName: bare }); // stash bare slug in cityName slot for reuse below
  }

  // ---- Stage 1: resolve collisions within each bare-name group (unchanged logic) ----
  const result = new Map<string, SlugResolution>();
  for (const [bareSlug, group] of bareGroups) {
    if (group.length === 1) {
      result.set(group[0].sourceId, { kind: 'assigned', slug: bareSlug });
      continue;
    }
    const byRegionSlug = new Map<string, SlugCandidate[]>();
    for (const c of group) {
      const regionSlug = c.regionName
        ? slugify(normalizeForSlug(c.regionName))
        : null;
      const key = regionSlug ? `${bareSlug}-${regionSlug}` : bareSlug;
      if (!byRegionSlug.has(key)) byRegionSlug.set(key, []);
      byRegionSlug.get(key)!.push(c);
    }
    for (const [disambiguatedSlug, subGroup] of byRegionSlug) {
      if (subGroup.length === 1) {
        result.set(subGroup[0].sourceId, {
          kind: 'assigned',
          slug: disambiguatedSlug,
        });
      } else {
        for (const c of subGroup) {
          result.set(c.sourceId, {
            kind: 'unresolved-collision',
            bareSlug,
            regionSlug:
              disambiguatedSlug === bareSlug ? null : disambiguatedSlug,
          });
        }
      }
    }
  }

  // ---- Stage 2: GLOBAL cross-group collision pass (Phase 6A.3 fix) ----
  // Order-independent by construction: this only inspects the *set* of final slug strings
  // already assigned, never which candidate happened to be processed first, so the same input
  // (in any order) always produces the same output.
  const bySlug = new Map<string, string[]>();
  for (const [sourceId, resolution] of result) {
    if (resolution.kind !== 'assigned') continue;
    if (!bySlug.has(resolution.slug)) bySlug.set(resolution.slug, []);
    bySlug.get(resolution.slug)!.push(sourceId);
  }
  for (const [slug, sourceIds] of bySlug) {
    if (sourceIds.length <= 1) continue;
    for (const sourceId of sourceIds) {
      const ownBareSlug = bareSlugOf.get(sourceId)!;
      result.set(sourceId, {
        kind: 'unresolved-collision',
        bareSlug: ownBareSlug,
        regionSlug: slug === ownBareSlug ? null : slug,
      });
    }
  }

  // ---- Stage 3: region ISO-3166-2 code suffix -- final approved tier (Phase 6A.6) ----
  // Attempted ONLY for candidates still unresolved after stages 1-2, and ONLY when a region code
  // is actually available (Region.code, never fabricated -- see SlugCandidate.regionCode). Built
  // from each candidate's own stage-1/2 slug (its region-name-disambiguated slug if it has one,
  // otherwise its bare slug) + '-' + the region's own code, reusing the same slugify/
  // normalizeForSlug helpers already used everywhere else (no second normalization
  // implementation). This is the exact fix for the proven "Las Vegas"+"Santa Bárbara" vs
  // "Las Vegas Santa Barbara" class of collision: the region NAME coincided with another city's
  // own name, but the region's ISO CODE ("HN-SB") does not.
  const stage3Candidates = new Map<string, string>(); // sourceId -> proposed stage-3 slug
  for (const [sourceId, resolution] of result) {
    if (resolution.kind !== 'unresolved-collision') continue;
    const regionCode = regionCodeOf.get(sourceId);
    if (!regionCode) continue; // no code available -- stays unresolved, never invented
    const base = resolution.regionSlug ?? resolution.bareSlug;
    const codeSlug = slugify(normalizeForSlug(regionCode));
    stage3Candidates.set(sourceId, `${base}-${codeSlug}`);
  }

  // Checked against the COMPLETE slug namespace -- every already-"assigned" slug from stages
  // 1-2, plus every other stage-3 proposal (not just the original colliding pair) -- so a
  // stage-3 candidate can never silently collide with something elsewhere in the country.
  const takenSlugCounts = new Map<string, number>();
  for (const resolution of result.values()) {
    if (resolution.kind === 'assigned') {
      takenSlugCounts.set(
        resolution.slug,
        (takenSlugCounts.get(resolution.slug) ?? 0) + 1,
      );
    }
  }
  for (const slug of stage3Candidates.values()) {
    takenSlugCounts.set(slug, (takenSlugCounts.get(slug) ?? 0) + 1);
  }
  for (const [sourceId, candidateSlug] of stage3Candidates) {
    if (takenSlugCounts.get(candidateSlug) === 1) {
      result.set(sourceId, { kind: 'assigned', slug: candidateSlug });
    }
    // else: the ISO-code candidate itself collides (with an assigned slug or another stage-3
    // proposal) -- per the approved rule, never choose a winner; the candidate simply remains
    // 'unresolved-collision' exactly as stage 2 left it. No fourth tier is introduced.
  }

  return result;
}

// ---- Existing-city matching (Phase 3 approved decision #2 and #13) ----

export function normalizeCityName(name: string): string {
  return name.trim().toLowerCase();
}

export interface ExistingBarberCueCity {
  id: string;
  name: string;
  slug: string;
  countryCode: string;
  state: string;
}

export interface SourceCityCandidate {
  sourceId: string;
  name: string;
  countryCode: string;
  stateCode: string | null;
  wikiDataId: string | null;
}

/**
 * The exact, explicitly-approved set of BarberCue's original legacy City rows (from
 * prisma/seed.ts's Bengaluru + prisma/seed-cities.ts's 20 additional cities), identified by
 * their permanent (countryCode, slug) identity -- never by name alone, and never by any data
 * attribute the importer itself writes (see the Phase 4A finding: after a real import,
 * `sourceDataset` is 'dr5hn' on every row, legacy and imported alike, so it cannot be used to
 * tell them apart). This is the ONLY set of rows the existing-city reconciliation step may ever
 * treat as "legacy" -- reconciliation must never fall back to scanning the whole City table,
 * since that table now also contains ~99,776 rows this same importer created, and treating
 * those as "existing cities needing reconciliation" is exactly the bug this constant fixes.
 *
 * Adding a row here is a deliberate, reviewed decision, not something the importer computes.
 */
export const LEGACY_CITY_KEYS: { countryCode: string; slug: string }[] = [
  { countryCode: 'IN', slug: 'ahmedabad' },
  { countryCode: 'IN', slug: 'bengaluru' },
  { countryCode: 'IN', slug: 'bhubaneswar' },
  { countryCode: 'IN', slug: 'chandigarh' },
  { countryCode: 'IN', slug: 'chennai' },
  { countryCode: 'IN', slug: 'coimbatore' },
  { countryCode: 'IN', slug: 'delhi' },
  { countryCode: 'IN', slug: 'gurugram' },
  { countryCode: 'IN', slug: 'guwahati' },
  { countryCode: 'IN', slug: 'hyderabad' },
  { countryCode: 'IN', slug: 'indore' },
  { countryCode: 'IN', slug: 'jaipur' },
  { countryCode: 'IN', slug: 'kochi' },
  { countryCode: 'IN', slug: 'kolkata' },
  { countryCode: 'IN', slug: 'lucknow' },
  { countryCode: 'IN', slug: 'mumbai' },
  { countryCode: 'IN', slug: 'nagpur' },
  { countryCode: 'IN', slug: 'noida' },
  { countryCode: 'IN', slug: 'pune' },
  { countryCode: 'IN', slug: 'surat' },
  { countryCode: 'IN', slug: 'visakhapatnam' },
];

/**
 * The exact predicate the importer's reconciliation snapshot query is built from -- exposed as
 * a pure function so its (countryCode, slug) semantics (never name alone, never slug alone) are
 * directly unit-testable without a database.
 */
export function isLegacyCityKey(countryCode: string, slug: string): boolean {
  return LEGACY_CITY_KEYS.some(
    (k) => k.countryCode === countryCode && k.slug === slug,
  );
}

/**
 * Manually-approved identity overrides for existing BarberCue cities whose name does not match
 * the source dataset's spelling for the same real-world place. Each entry requires an explicit,
 * separately-reviewed approval before being added here -- never inferred automatically, per the
 * project's "never silently merge two cities" rule.
 *
 * Kochi -> Cochin: approved (Phase 3 authorization, decision #1). dr5hn stores Kochi, Kerala
 * under its former colonial name "Cochin" (sourceId 131617, wikiDataId Q1800). BarberCue's
 * existing "Kochi" row is never renamed -- only backfilled.
 */
export const APPROVED_IDENTITY_OVERRIDES: Record<
  string,
  { countryCode: string; sourceId: string }
> = {
  kochi: { countryCode: 'IN', sourceId: '131617' },
};

export type MatchResult =
  | {
      kind: 'matched';
      method: 'exact-name' | 'approved-override';
      source: SourceCityCandidate;
    }
  | { kind: 'unmatched' }
  | { kind: 'ambiguous'; candidates: SourceCityCandidate[] };

/**
 * Matches one existing BarberCue city against the pool of source cities for the same country.
 * Primary key is (country + normalized name); wikiDataId is never used as the sole match
 * criterion (Phase 2 found 17,494 groups of source cities sharing a single wikiDataId, so it is
 * evidence at most, never authority). An explicit override table (above) is checked first for
 * cases a human has already resolved (e.g. Kochi/Cochin).
 */
export function matchExistingCity(
  existing: ExistingBarberCueCity,
  sourceCitiesInCountry: SourceCityCandidate[],
): MatchResult {
  const override = APPROVED_IDENTITY_OVERRIDES[existing.slug];
  if (override && override.countryCode === existing.countryCode) {
    const overrideMatch = sourceCitiesInCountry.find(
      (c) => c.sourceId === override.sourceId,
    );
    if (overrideMatch) {
      return {
        kind: 'matched',
        method: 'approved-override',
        source: overrideMatch,
      };
    }
  }

  const normalizedTarget = normalizeCityName(existing.name);
  const exact = sourceCitiesInCountry.filter(
    (c) => normalizeCityName(c.name) === normalizedTarget,
  );
  if (exact.length === 1)
    return { kind: 'matched', method: 'exact-name', source: exact[0] };
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact };
  return { kind: 'unmatched' };
}
