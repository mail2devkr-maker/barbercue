import {
  SERVICE_CATALOG,
  SERVICE_CATALOG_PACKS,
  type ServicePackId,
} from '../catalog/service-catalog';

describe('service catalog onboarding packs', () => {
  it('assigns every catalog service to exactly one supported pack', () => {
    const valid = new Set<ServicePackId>(['BASIC', 'STANDARD', 'ADVANCED']);
    expect(SERVICE_CATALOG.length).toBeGreaterThan(0);
    for (const service of SERVICE_CATALOG) {
      expect(valid.has(service.pack)).toBe(true);
    }
  });

  it('keeps all three onboarding packs non-empty and covers the whole catalog', () => {
    const counts = new Map(
      SERVICE_CATALOG_PACKS.map((pack) => [
        pack.id,
        SERVICE_CATALOG.filter((service) => service.pack === pack.id).length,
      ]),
    );
    expect(counts.get('BASIC')).toBeGreaterThan(0);
    expect(counts.get('STANDARD')).toBeGreaterThan(0);
    expect(counts.get('ADVANCED')).toBeGreaterThan(0);
    expect([...counts.values()].reduce((sum, count) => sum + count, 0)).toBe(
      SERVICE_CATALOG.length,
    );
  });

  it('uses the owner-requested pack labels', () => {
    expect(SERVICE_CATALOG_PACKS.map((pack) => pack.label)).toEqual([
      'Basic Salon Services',
      'Standard Salon Services',
      'Advance Salon Services',
    ]);
  });
});
