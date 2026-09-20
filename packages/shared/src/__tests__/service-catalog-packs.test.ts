import {
  SERVICE_CATALOG,
  SERVICE_CATALOG_PACKS,
  serviceAvailableInPack,
  suggestedServicePriceInr,
  type ServicePackId,
} from '../catalog/service-catalog';

describe('service catalog onboarding packs', () => {
  it('uses a supported minimum tier for every catalog service', () => {
    const valid = new Set<ServicePackId>(['BASIC', 'STANDARD', 'ADVANCED']);
    expect(SERVICE_CATALOG.length).toBeGreaterThan(0);
    for (const service of SERVICE_CATALOG) {
      expect(valid.has(service.pack)).toBe(true);
    }
  });

  it('makes packs nested: Basic is a subset of Standard, Standard is a subset of Advance', () => {
    const basic = SERVICE_CATALOG.filter((service) => serviceAvailableInPack(service, 'BASIC'));
    const standard = SERVICE_CATALOG.filter((service) => serviceAvailableInPack(service, 'STANDARD'));
    const advanced = SERVICE_CATALOG.filter((service) => serviceAvailableInPack(service, 'ADVANCED'));

    expect(basic.length).toBeGreaterThan(0);
    expect(standard.length).toBeGreaterThan(basic.length);
    expect(advanced.length).toBeGreaterThan(standard.length);
    expect(advanced.length).toBe(SERVICE_CATALOG.length);

    for (const service of basic) {
      expect(serviceAvailableInPack(service, 'STANDARD')).toBe(true);
      expect(serviceAvailableInPack(service, 'ADVANCED')).toBe(true);
    }
    for (const service of standard) {
      expect(serviceAvailableInPack(service, 'ADVANCED')).toBe(true);
    }
  });

  it('uses the pack as both service breadth and salon tier', () => {
    const basic = SERVICE_CATALOG.filter((service) =>
      serviceAvailableInPack(service, 'BASIC'),
    );
    const standard = SERVICE_CATALOG.filter((service) =>
      serviceAvailableInPack(service, 'STANDARD'),
    );
    const advanced = SERVICE_CATALOG.filter((service) =>
      serviceAvailableInPack(service, 'ADVANCED'),
    );

    // Small barber: essential men's grooming + basic colour/care only.
    expect(basic).toHaveLength(20);
    expect(basic.map((service) => service.id)).toEqual(
      expect.arrayContaining([
        'classic-haircut',
        'beard-trim',
        'clean-shave',
        'head-massage',
        'root-touch-up',
        'global-hair-colour',
      ]),
    );
    expect(basic.map((service) => service.id)).not.toEqual(
      expect.arrayContaining([
        'womens-haircut',
        'cleanup',
        'manicure',
        'party-makeup',
        'bridal-makeup',
      ]),
    );

    // Standard salon: Basic + broader unisex beauty/grooming services.
    expect(standard).toHaveLength(73);
    expect(standard.map((service) => service.id)).toEqual(
      expect.arrayContaining([
        'classic-haircut',
        'womens-haircut',
        'hair-spa',
        'cleanup',
        'eyebrows',
        'full-legs',
        'manicure',
        'party-makeup',
        'back-massage',
      ]),
    );
    expect(standard.map((service) => service.id)).not.toEqual(
      expect.arrayContaining([
        'keratin-treatment',
        'nail-extensions',
        'bridal-makeup',
        'full-body-wax',
      ]),
    );

    // Advance salon: complete catalog, including every premium/technical beauty service.
    expect(advanced).toHaveLength(SERVICE_CATALOG.length);
    expect(advanced).toHaveLength(98);
    expect(advanced.map((service) => service.id)).toEqual(
      expect.arrayContaining([
        'classic-haircut',
        'keratin-treatment',
        'nail-extensions',
        'bridal-makeup',
        'full-body-wax',
        'body-polish',
      ]),
    );
  });

  it('gives every available service a positive editable price and valid duration', () => {
    const packs: ServicePackId[] = ['BASIC', 'STANDARD', 'ADVANCED'];
    for (const service of SERVICE_CATALOG) {
      for (const pack of packs) {
        if (!serviceAvailableInPack(service, pack)) continue;
        expect(Number.isFinite(suggestedServicePriceInr(service, pack))).toBe(true);
        expect(suggestedServicePriceInr(service, pack)).toBeGreaterThan(0);
      }
      expect(Number.isInteger(service.defaultDurationMinutes)).toBe(true);
      expect(service.defaultDurationMinutes).toBeGreaterThanOrEqual(5);
      expect(service.defaultDurationMinutes).toBeLessThanOrEqual(480);
    }
  });

  it('supports lower Basic, mid Standard and higher Advance prices for shared services', () => {
    const expectations = [
      ['classic-haircut', 50, 100, 200],
      ['beard-trim', 50, 100, 200],
      ['head-massage', 100, 200, 400],
      ['global-hair-colour', 500, 1000, 2000],
    ] as const;

    for (const [id, basicPrice, standardPrice, advancedPrice] of expectations) {
      const service = SERVICE_CATALOG.find((candidate) => candidate.id === id);
      expect(service).toBeDefined();
      expect(suggestedServicePriceInr(service!, 'BASIC')).toBe(basicPrice);
      expect(suggestedServicePriceInr(service!, 'STANDARD')).toBe(standardPrice);
      expect(suggestedServicePriceInr(service!, 'ADVANCED')).toBe(advancedPrice);
    }
  });

  it('uses the owner-requested pack labels', () => {
    expect(SERVICE_CATALOG_PACKS.map((pack) => pack.label)).toEqual([
      'Basic Salon Services',
      'Standard Salon Services',
      'Advance Salon Services',
    ]);
  });
});
