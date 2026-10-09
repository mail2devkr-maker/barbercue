import { citySearchQuerySchema, salonSearchQuerySchema } from '../schemas';

describe('salonSearchQuerySchema', () => {
  it('accepts an empty query (browse-all)', () => {
    expect(salonSearchQuerySchema.safeParse({}).success).toBe(true);
  });

  it('accepts all filters together', () => {
    const result = salonSearchQuerySchema.safeParse({
      city: 'bengaluru',
      locality: 'indiranagar',
      service: 'haircut',
      q: 'fade',
      limit: '20',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(20); // coerced from string (real query params are always strings)
  });

  it('rejects a limit above 50', () => {
    expect(salonSearchQuerySchema.safeParse({ limit: '999' }).success).toBe(false);
  });

  it('rejects a non-UUID cursor', () => {
    expect(salonSearchQuerySchema.safeParse({ cursor: 'not-a-uuid' }).success).toBe(false);
  });

  // Part 8/9 — distance + price filters.
  describe('radiusKm / priceMin / priceMax', () => {
    it('accepts and coerces radiusKm, priceMin and priceMax from string query params', () => {
      const result = salonSearchQuerySchema.safeParse({
        lat: '12.9716',
        lng: '77.6412',
        radiusKm: '5',
        priceMin: '200',
        priceMax: '800',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.radiusKm).toBe(5);
        expect(result.data.priceMin).toBe(200);
        expect(result.data.priceMax).toBe(800);
      }
    });

    it('accepts priceMin or priceMax alone', () => {
      expect(salonSearchQuerySchema.safeParse({ priceMin: '100' }).success).toBe(true);
      expect(salonSearchQuerySchema.safeParse({ priceMax: '900' }).success).toBe(true);
    });

    it('rejects priceMin greater than priceMax', () => {
      expect(salonSearchQuerySchema.safeParse({ priceMin: '900', priceMax: '100' }).success).toBe(false);
    });

    it('accepts priceMin equal to priceMax', () => {
      expect(salonSearchQuerySchema.safeParse({ priceMin: '500', priceMax: '500' }).success).toBe(true);
    });

    it('rejects a negative price', () => {
      expect(salonSearchQuerySchema.safeParse({ priceMin: '-1' }).success).toBe(false);
    });

    it('rejects a non-positive radiusKm', () => {
      expect(salonSearchQuerySchema.safeParse({ radiusKm: '0' }).success).toBe(false);
      expect(salonSearchQuerySchema.safeParse({ radiusKm: '-5' }).success).toBe(false);
    });

    it('rejects a radiusKm above the 500km cap', () => {
      expect(salonSearchQuerySchema.safeParse({ radiusKm: '501' }).success).toBe(false);
    });

    it('accepts radiusKm without lat/lng at the schema level (SalonsService ignores it without a query point)', () => {
      expect(salonSearchQuerySchema.safeParse({ radiusKm: '5' }).success).toBe(true);
    });
  });
});

describe('salonSearchQuerySchema — reference origin', () => {
  it('accepts originLat/originLng/sort from a query string (coerced from strings)', () => {
    const parsed = salonSearchQuerySchema.parse({ originLat: '25.6863', originLng: '85.2095', sort: 'nearest' });
    expect(parsed).toMatchObject({ originLat: 25.6863, originLng: 85.2095, sort: 'nearest' });
  });

  it('is entirely optional, so every existing client request still validates unchanged', () => {
    expect(salonSearchQuerySchema.parse({ city: 'hajipur', countryCode: 'IN', limit: '20' })).toEqual({
      city: 'hajipur',
      countryCode: 'IN',
      limit: 20,
    });
  });

  it('rejects out-of-range coordinates and unknown sort modes (only implemented orderings are accepted)', () => {
    expect(salonSearchQuerySchema.safeParse({ originLat: '91', originLng: '0' }).success).toBe(false);
    expect(salonSearchQuerySchema.safeParse({ originLat: '0', originLng: '181' }).success).toBe(false);
    expect(salonSearchQuerySchema.safeParse({ sort: 'rating' }).success).toBe(false);
  });

  it('keeps lat/lng (legacy Near Me) and originLat/originLng independent', () => {
    const parsed = salonSearchQuerySchema.parse({ lat: '12.9', lng: '77.6' });
    expect(parsed.originLat).toBeUndefined();
    expect(parsed.lat).toBe(12.9);
  });
});

describe('citySearchQuerySchema', () => {
  const COUNTRY = '6f1c3a52-8d3e-4b7a-9d2a-1f2e3c4b5a69';

  it('still accepts the registration flow shape: countryId (+ regionId, q, limit)', () => {
    const parsed = citySearchQuerySchema.parse({ countryId: COUNTRY, q: 'ben', limit: '10' });
    expect(parsed).toMatchObject({ countryId: COUNTRY, q: 'ben', limit: 10 });
    expect(parsed.hasShops).toBeUndefined();
  });

  it('accepts a shop-bearing search with no countryId (customer location selector)', () => {
    const parsed = citySearchQuerySchema.parse({ q: 'haj', hasShops: 'true' });
    expect(parsed.hasShops).toBe(true);
    expect(parsed.countryId).toBeUndefined();
  });

  it('parses hasShops=false as false', () => {
    expect(citySearchQuerySchema.parse({ countryId: COUNTRY, hasShops: 'false' }).hasShops).toBe(false);
  });

  it('refuses an unscoped search: no countryId and no hasShops', () => {
    const result = citySearchQuerySchema.safeParse({ q: 'haj' });
    expect(result.success).toBe(false);
  });

  it('refuses hasShops=false without a countryId', () => {
    expect(citySearchQuerySchema.safeParse({ q: 'haj', hasShops: 'false' }).success).toBe(false);
  });

  it('rejects anything but the literal strings true/false for hasShops', () => {
    expect(citySearchQuerySchema.safeParse({ q: 'haj', hasShops: '1' }).success).toBe(false);
  });
});
