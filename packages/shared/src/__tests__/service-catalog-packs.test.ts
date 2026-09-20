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

  it('supports different prices for the same service by pack', () => {
    const haircut = SERVICE_CATALOG.find((service) => service.id === 'classic-haircut');
    expect(haircut).toBeDefined();
    expect(suggestedServicePriceInr(haircut!, 'BASIC')).toBe(50);
    expect(suggestedServicePriceInr(haircut!, 'STANDARD')).toBe(100);
    expect(suggestedServicePriceInr(haircut!, 'ADVANCED')).toBe(200);
  });

  it('uses the owner-requested pack labels', () => {
    expect(SERVICE_CATALOG_PACKS.map((pack) => pack.label)).toEqual([
      'Basic Salon Services',
      'Standard Salon Services',
      'Advance Salon Services',
    ]);
  });
});
