import { MAX_SERVICES_PER_BOOKING } from '../constants';
import { availabilityQuerySchema, createBookingSchema, staffListQuerySchema } from '../schemas';

const SERVICE_A = '22222222-2222-2222-2222-222222222222';
const SERVICE_B = '44444444-4444-4444-4444-444444444444';
const SERVICE_C = '55555555-5555-5555-5555-555555555555';

describe('createBookingSchema', () => {
  const valid = {
    salonId: '11111111-1111-1111-1111-111111111111',
    serviceIds: [SERVICE_A],
    slotStart: '2026-08-05T09:00:00.000Z',
  };

  it('accepts a valid body without a staff preference (Any Staff)', () => {
    expect(createBookingSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a valid body with a preferredStaffId', () => {
    const result = createBookingSchema.safeParse({
      ...valid,
      preferredStaffId: '33333333-3333-3333-3333-333333333333',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID preferredStaffId', () => {
    expect(createBookingSchema.safeParse({ ...valid, preferredStaffId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects a missing serviceIds', () => {
    const { serviceIds: _serviceIds, ...rest } = valid;
    expect(createBookingSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a non-ISO slotStart', () => {
    expect(createBookingSchema.safeParse({ ...valid, slotStart: '05-08-2026' }).success).toBe(false);
  });

  // Multi-service booking core mission — the shape itself must support and preserve an ordered
  // multi-service selection. Salon/active/duplicate validation is real-data-dependent and lives in
  // AvailabilityService.getServicesOrThrow, never here.
  describe('multi-service selection', () => {
    it('accepts multiple ordered service ids', () => {
      const result = createBookingSchema.safeParse({ ...valid, serviceIds: [SERVICE_A, SERVICE_B, SERVICE_C] });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.serviceIds).toEqual([SERVICE_A, SERVICE_B, SERVICE_C]);
    });

    it('rejects an empty serviceIds array', () => {
      expect(createBookingSchema.safeParse({ ...valid, serviceIds: [] }).success).toBe(false);
    });

    it(`accepts exactly ${MAX_SERVICES_PER_BOOKING} services`, () => {
      const ids = Array.from({ length: MAX_SERVICES_PER_BOOKING }, (_, i) =>
        `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      );
      expect(createBookingSchema.safeParse({ ...valid, serviceIds: ids }).success).toBe(true);
    });

    it(`rejects more than ${MAX_SERVICES_PER_BOOKING} services`, () => {
      const ids = Array.from({ length: MAX_SERVICES_PER_BOOKING + 1 }, (_, i) =>
        `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      );
      expect(createBookingSchema.safeParse({ ...valid, serviceIds: ids }).success).toBe(false);
    });

    it('rejects a non-UUID entry inside serviceIds', () => {
      expect(createBookingSchema.safeParse({ ...valid, serviceIds: [SERVICE_A, 'not-a-uuid'] }).success).toBe(false);
    });
  });

  // Part 11 (FastQue Credits precision audit) — creditsToRedeem must reject anything with more
  // than 2 fractional digits. Tested against the actual schema (not zod's multipleOf in the
  // abstract), since that's what a real request body goes through.
  describe('creditsToRedeem precision', () => {
    it.each([0, 10, 10.1, 10.10, 10.01, 0.01, 999.99])('accepts %s (at most 2 decimal places)', (amount) => {
      expect(createBookingSchema.safeParse({ ...valid, creditsToRedeem: amount }).success).toBe(true);
    });

    it.each([10.001, 10.999, 0.001, 10.005])('rejects %s (more than 2 decimal places)', (amount) => {
      expect(createBookingSchema.safeParse({ ...valid, creditsToRedeem: amount }).success).toBe(false);
    });

    it('rejects a negative amount', () => {
      expect(createBookingSchema.safeParse({ ...valid, creditsToRedeem: -10 }).success).toBe(false);
    });
  });
});

describe('availabilityQuerySchema', () => {
  it('accepts a single serviceIds + date', () => {
    const result = availabilityQuerySchema.safeParse({ serviceIds: SERVICE_A, date: '2026-08-05' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.serviceIds).toEqual([SERVICE_A]);
  });

  it('parses a comma-separated serviceIds param into an ordered array', () => {
    const result = availabilityQuerySchema.safeParse({
      serviceIds: `${SERVICE_A},${SERVICE_B},${SERVICE_C}`,
      date: '2026-08-05',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.serviceIds).toEqual([SERVICE_A, SERVICE_B, SERVICE_C]);
  });

  it('trims whitespace around comma-separated ids', () => {
    const result = availabilityQuerySchema.safeParse({
      serviceIds: `${SERVICE_A}, ${SERVICE_B} , ${SERVICE_C}`,
      date: '2026-08-05',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.serviceIds).toEqual([SERVICE_A, SERVICE_B, SERVICE_C]);
  });

  it('accepts an optional staffId', () => {
    expect(
      availabilityQuerySchema.safeParse({
        serviceIds: SERVICE_A,
        date: '2026-08-05',
        staffId: '33333333-3333-3333-3333-333333333333',
      }).success,
    ).toBe(true);
  });

  it('rejects a malformed date', () => {
    expect(
      availabilityQuerySchema.safeParse({ serviceIds: SERVICE_A, date: '2026/08/05' }).success,
    ).toBe(false);
  });

  it('rejects a missing serviceIds', () => {
    expect(availabilityQuerySchema.safeParse({ date: '2026-08-05' }).success).toBe(false);
  });

  it('rejects an empty serviceIds string', () => {
    expect(availabilityQuerySchema.safeParse({ serviceIds: '', date: '2026-08-05' }).success).toBe(false);
  });

  it('rejects a non-UUID entry inside a comma-separated serviceIds param', () => {
    expect(
      availabilityQuerySchema.safeParse({ serviceIds: `${SERVICE_A},not-a-uuid`, date: '2026-08-05' }).success,
    ).toBe(false);
  });

  it(`rejects more than ${MAX_SERVICES_PER_BOOKING} comma-separated ids`, () => {
    const ids = Array.from({ length: MAX_SERVICES_PER_BOOKING + 1 }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    ).join(',');
    expect(availabilityQuerySchema.safeParse({ serviceIds: ids, date: '2026-08-05' }).success).toBe(false);
  });
});

describe('staffListQuerySchema', () => {
  it('accepts a single valid serviceIds', () => {
    expect(staffListQuerySchema.safeParse({ serviceIds: SERVICE_A }).success).toBe(true);
  });

  it('accepts a comma-separated serviceIds', () => {
    const result = staffListQuerySchema.safeParse({ serviceIds: `${SERVICE_A},${SERVICE_B}` });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.serviceIds).toEqual([SERVICE_A, SERVICE_B]);
  });

  it('rejects a non-UUID serviceIds', () => {
    expect(staffListQuerySchema.safeParse({ serviceIds: 'nope' }).success).toBe(false);
  });
});
