import {
  SERVICE_NAME_GROUPS,
  expandServiceNameSearch,
  expandServiceSearchForResults,
  mergeServiceSuggestions,
  normalizeServiceText,
  resolveServiceNameGroup,
  serviceNameMatches,
  suggestServiceGroups,
} from '../catalog/service-name-matching';

const matches = (query: string, serviceName: string) =>
  serviceNameMatches(expandServiceNameSearch(query), serviceName);

describe('service name search', () => {
  it('normalises case, punctuation and spacing', () => {
    expect(normalizeServiceText('  Hair-Cut / Beard ')).toBe('hair cut beard');
  });

  // The owner's examples table: each search finds every equivalent name salons actually use.
  it.each([
    ['Haircut', ['Hair Cut', 'Hair Cutting', 'Gents Haircut', 'Hair Trim', 'Kids Haircut']],
    ['Shave', ['Shaving', 'Clean Shave', 'Beard Shave', 'Premium/Luxury Shave']],
    ['Head Massage', ['Head Massaz', 'Champi', 'Scalp Massage', 'Head Oil Massage']],
    ['Beard Trim', ['Beard Trimming', 'Beard Shape', 'Beard Shape/Line-up']],
    ['Facial', ['Face Facial', 'Glow Facial', 'Facial Treatment']],
    ['Hair Color', ['Hair Colour', 'Hair Coloring', 'Hair Dye', 'Global Colour']],
    ['Hair Spa', ['Hair Spa Treatment', 'Hair Nourishment Spa']],
  ])('"%s" matches its equivalent service names', (query, names) => {
    for (const name of names) expect([name, matches(query, name)]).toEqual([name, true]);
  });

  it.each([
    ['hair cut', 'haircut'],
    ['HAIRCUTS', 'haircut'],
    ['hair-cut', 'haircut'],
    ['gents haircut', 'haircut'],
    ['cutting', 'haircut'],
    ['baal katna', 'haircut'],
    ['shaving', 'shave'],
    ['dadhi banana', 'shave'],
    ['beard shave', 'shave'],
    ['champi', 'head-massage'],
    ['sir ki malish', 'head-massage'],
    ['facials', 'facial'],
    ['facail', 'facial'],
    ['fesial', 'facial'],
    ['hair colur', 'hair-color'],
    ['hair dye', 'hair-color'],
    ['hiar spa', 'hair-spa'],
    ['haed masage', 'head-massage'],
    ['beard triming', 'beard-trim'],
    ['फेशियल', 'facial'],
  ])('recognises "%s" as %s (synonyms, plurals, typos, Hinglish, Hindi)', (query, groupId) => {
    expect(resolveServiceNameGroup(query)?.id).toBe(groupId);
  });

  // Related but different treatments stay apart.
  it.each([
    ['Facial', 'Face Massage'],
    ['Facial', 'Face Bleach'],
    ['Facial', 'Fruit Cleanup'],
    ['Face Massage', 'Gold Facial'],
    ['Head Massage', 'Face Massage'],
    ['Head Massage', 'Full Body Massage'],
    ['Beard Trim', 'Clean Shave'],
    ['Shave', 'Beard Trim'],
    ['Shave', 'Head Shave'],
    ['Haircut', 'Hair Spa'],
    ['Haircut', 'Moustache Trim'],
    ['Hair Color', 'Beard Colour'],
    ['Hair Spa', 'Hair Wash'],
  ])('"%s" does not match "%s"', (query, name) => {
    expect(matches(query, name)).toBe(false);
  });

  it('does not let a broad alias capture another service ("nail cutting" is not a haircut)', () => {
    expect(resolveServiceNameGroup('nail cutting')).toBeUndefined();
    expect(matches('nail cutting', 'Gents Haircut')).toBe(false);
  });

  it('a search for an excluded variant is still found by its own name', () => {
    expect(resolveServiceNameGroup('head shave')).toBeUndefined();
    expect(matches('head shave', 'Head Shave')).toBe(true);
  });

  it('never guesses between two services in one query', () => {
    expect(resolveServiceNameGroup('facial cleanup')).toBeUndefined();
  });

  it('gives short words no typo allowance', () => {
    expect(resolveServiceNameGroup('max')).toBeUndefined();
    expect(matches('wax', 'Full Arms Waxing')).toBe(true);
  });

  it('falls back to the typed text for a service it does not know', () => {
    expect(resolveServiceNameGroup('Saree Draping')).toBeUndefined();
    expect(expandServiceNameSearch('Saree Draping').match).toContain('Saree Draping');
    expect(matches('Saree Draping', 'Saree Draping')).toBe(true);
    expect(matches('Saree Draping', 'Bridal Makeup')).toBe(false);
  });

  it('merges equivalent suggestion names into one label, keeping other names as they are', () => {
    expect(
      mergeServiceSuggestions([
        'Gents Haircut', 'Hair Colour', 'Hair Cutting', 'Hair Nourishment Spa', 'Hair Spa', 'Haircut',
        'Head Shave', 'Saree Draping', 'saree draping',
      ]),
    ).toEqual(['Haircut', 'Hair Colour', 'Hair Spa', 'Head Shave', 'Saree Draping']);
  });

  it('every group label resolves back to its own group, so picking it searches the same salons', () => {
    for (const group of SERVICE_NAME_GROUPS) {
      expect([group.label, resolveServiceNameGroup(group.label)?.id]).toEqual([group.label, group.id]);
    }
  });
});

describe('typeahead service groups (owner report 18 Nov: smart search must work while typing)', () => {
  const ids = (q: string) => suggestServiceGroups(q).map((g) => g.id);

  it('suggests every hair service for a partial "hai" / "hair", in English or Hindi', () => {
    for (const q of ['hai', 'hair', 'Hair', 'हेयर']) {
      expect(ids(q)).toEqual(expect.arrayContaining(['haircut', 'hair-color', 'hair-spa']));
    }
  });

  it('forgives one slip while typing ("hiar") and run-together/typo full names', () => {
    expect(ids('hiar')).toEqual(expect.arrayContaining(['haircut', 'hair-color', 'hair-spa']));
    expect(ids('haircutt')[0]).toBe('haircut');
    expect(ids('facail')[0]).toBe('facial');
  });

  it('understands Hinglish starts: baal, dadhi, champi, malish', () => {
    expect(ids('baal')).toEqual(expect.arrayContaining(['haircut', 'hair-color', 'hair-wash']));
    expect(ids('dadhi')).toEqual(expect.arrayContaining(['shave', 'beard-trim']));
    expect(ids('champi')[0]).toBe('head-massage');
    expect(ids('malish')).toEqual(expect.arrayContaining(['head-massage', 'face-massage']));
  });

  it('lists services whose own name starts like the text before looser matches', () => {
    const hair = ids('hair');
    expect(hair.slice(0, 3)).toEqual(['haircut', 'hair-color', 'hair-spa']);
    expect(hair.indexOf('head-massage')).toBeGreaterThan(hair.indexOf('hair-spa'));
  });

  it('puts the group the whole text already means first', () => {
    expect(ids('bal katna')[0]).toBe('haircut');
    expect(ids('shaving')[0]).toBe('shave');
  });

  it('never suggests from too little text, and never a group the text excludes', () => {
    expect(ids('h')).toEqual([]);
    expect(ids('ha')).toEqual([]);
    expect(ids('head shave')).not.toContain('shave');
  });

  it('does not invent a group for unrelated text', () => {
    expect(ids('saree draping')).toEqual([]);
    expect(ids('xyzzy')).toEqual([]);
  });
});

describe('search results for typed text without a picked suggestion', () => {
  const finds = (query: string, serviceName: string) =>
    serviceNameMatches(expandServiceSearchForResults(query), serviceName);

  it('a recognised service searches exactly like the expanded service', () => {
    expect(expandServiceSearchForResults('shaving')).toEqual(expandServiceNameSearch('shaving'));
    expect(finds('shaving', 'Clean Shave')).toBe(true);
    expect(finds('shaving', 'Head Shave')).toBe(false);
  });

  it('partial Hinglish finds the services it may mean', () => {
    expect(finds('baal', 'Gents Haircut')).toBe(true);
    expect(finds('baal', 'Global Hair Colour')).toBe(true);
    expect(finds('dadhi', 'Beard Styling / Trim')).toBe(true);
    expect(finds('dadhi', 'Clean Shave')).toBe(true);
    expect(finds('hiar', 'Hair Spa')).toBe(true);
  });

  it('is never narrower than the plain contains-search it replaces', () => {
    for (const [q, name] of [
      ['massage', 'Full Body Massage'],
      ['hair', 'Advance Hair Style'],
      ['saree', 'Saree Draping'],
    ]) {
      expect(finds(q, name)).toBe(true);
    }
    expect(finds('baal', 'Pedicure')).toBe(false);
  });
});
