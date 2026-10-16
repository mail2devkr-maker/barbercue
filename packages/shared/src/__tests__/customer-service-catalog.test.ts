import {
  CUSTOMER_CATEGORY_PHOTOS,
  CUSTOMER_SERVICE_CATEGORIES,
  PHOTOGRAPHED_SERVICES,
  SALON_DISCOVERY_CATEGORIES,
  SERVICE_CATALOG,
  customerServiceName,
  filterCustomerServices,
} from '../index';

const allServices = CUSTOMER_SERVICE_CATEGORIES.flatMap((category) => category.services);

describe('customer All Services catalogue', () => {
  it('covers every customer discovery category, in the discovery order', () => {
    expect(CUSTOMER_SERVICE_CATEGORIES.map((c) => c.id)).toEqual(SALON_DISCOVERY_CATEGORIES.map((c) => c.id));
  });

  it('gives every category a photograph and at least one service', () => {
    for (const category of CUSTOMER_SERVICE_CATEGORIES) {
      expect(category.photoPath).toBe(CUSTOMER_CATEGORY_PHOTOS[category.id]);
      expect(category.photoPath).toMatch(/^services\/.+\.webp$/);
      expect(category.services.length).toBeGreaterThan(0);
    }
  });

  it('shows each service exactly once across the whole catalogue (no duplicate cards)', () => {
    const names = allServices.map((s) => s.name.toLowerCase().replace(/[^a-z0-9]+/g, ''));
    expect(new Set(names).size).toBe(names.length);
  });

  it('has unique ids and no duplicate service cards inside a category', () => {
    const ids = allServices.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of CUSTOMER_SERVICE_CATEGORIES) {
      const names = category.services.map((s) => s.name.toLowerCase().replace(/[^a-z0-9]+/g, ''));
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('collapses Gents/Ladies variants into ONE customer-facing service', () => {
    for (const service of allServices) {
      expect(service.name).not.toMatch(/^(gents|ladies)\s/i);
    }
    const facial = CUSTOMER_SERVICE_CATEGORIES.find((c) => c.id === 'facial')!;
    expect(facial.services.filter((s) => s.name === 'Fruit Facial')).toHaveLength(1);
    expect(customerServiceName('Gents Fruit Facial')).toBe('Fruit Facial');
    expect(customerServiceName('Ladies Fruit Facial')).toBe('Fruit Facial');
    expect(customerServiceName('Classic Haircut')).toBe('Classic Haircut');
  });

  it('loses no service from the owner onboarding catalogue (every preset is browsable)', () => {
    const browsable = new Set(allServices.map((s) => s.name.toLowerCase().replace(/[^a-z0-9]+/g, '')));
    for (const item of SERVICE_CATALOG) {
      expect(browsable.has(customerServiceName(item.name).toLowerCase().replace(/[^a-z0-9]+/g, ''))).toBe(true);
    }
  });

  it('keeps bridal/occasion services apart from everyday makeup', () => {
    const names = (id: string) => CUSTOMER_SERVICE_CATEGORIES.find((c) => c.id === id)!.services.map((s) => s.name);
    expect(names('bridal-event')).toEqual(expect.arrayContaining(['Bridal Makeup', 'Engagement Makeup', 'Bridal Hairdo']));
    expect(names('makeup')).toEqual(expect.arrayContaining(['Party Makeup', 'HD Makeup']));
    expect(names('makeup')).not.toContain('Bridal Makeup');
  });

  it('uses a dedicated photo only for the photographed services; everything else uses its honest category photo', () => {
    const dedicated = allServices.filter((s) => s.dedicatedPhoto);
    expect(dedicated.map((s) => s.id).sort()).toEqual(PHOTOGRAPHED_SERVICES.map((s) => s.id).sort());
    for (const service of allServices.filter((s) => !s.dedicatedPhoto)) {
      expect(service.photoPath).toBe(CUSTOMER_CATEGORY_PHOTOS[service.categoryId]);
    }
  });

  it('gives every service a non-empty search keyword and never carries a price', () => {
    for (const service of allServices) {
      expect(service.query.trim().length).toBeGreaterThan(1);
      expect(Object.keys(service)).not.toEqual(expect.arrayContaining(['price']));
      expect(JSON.stringify(service)).not.toMatch(/₹|inr|price/i);
    }
  });

  it('only ever points photographs at paths inside the editorial library', () => {
    for (const path of [...allServices.map((s) => s.photoPath), ...Object.values(CUSTOMER_CATEGORY_PHOTOS)]) {
      expect(path).toMatch(/^services\/[a-z-]+\/[a-z-]+\.webp$/);
    }
  });
});

describe('filterCustomerServices', () => {
  it('is case-insensitive, keeps category grouping and drops empty categories', () => {
    const result = filterCustomerServices(CUSTOMER_SERVICE_CATEGORIES, 'FACIAL');
    expect(result.length).toBeGreaterThan(0);
    for (const category of result) {
      expect(category.services.length).toBeGreaterThan(0);
      for (const service of category.services) expect(service.name.toLowerCase()).toContain('facial');
    }
  });

  it('returns everything for an empty term and nothing for a nonsense term', () => {
    expect(filterCustomerServices(CUSTOMER_SERVICE_CATEGORIES, '  ')).toHaveLength(CUSTOMER_SERVICE_CATEGORIES.length);
    expect(filterCustomerServices(CUSTOMER_SERVICE_CATEGORIES, 'zzzzqq')).toEqual([]);
  });
});
