import { salonSearchQuerySchema } from '../schemas';

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
});
