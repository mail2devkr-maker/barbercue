import { availabilityQuerySchema, createBookingSchema, staffListQuerySchema } from '../schemas';

describe('createBookingSchema', () => {
  const valid = {
    salonId: '11111111-1111-1111-1111-111111111111',
    serviceId: '22222222-2222-2222-2222-222222222222',
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

  it('rejects a missing serviceId', () => {
    const { serviceId: _serviceId, ...rest } = valid;
    expect(createBookingSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a non-ISO slotStart', () => {
    expect(createBookingSchema.safeParse({ ...valid, slotStart: '05-08-2026' }).success).toBe(false);
  });
});

describe('availabilityQuerySchema', () => {
  it('accepts serviceId + date only', () => {
    expect(
      availabilityQuerySchema.safeParse({ serviceId: '22222222-2222-2222-2222-222222222222', date: '2026-08-05' })
        .success,
    ).toBe(true);
  });

  it('accepts an optional staffId', () => {
    expect(
      availabilityQuerySchema.safeParse({
        serviceId: '22222222-2222-2222-2222-222222222222',
        date: '2026-08-05',
        staffId: '33333333-3333-3333-3333-333333333333',
      }).success,
    ).toBe(true);
  });

  it('rejects a malformed date', () => {
    expect(
      availabilityQuerySchema.safeParse({ serviceId: '22222222-2222-2222-2222-222222222222', date: '2026/08/05' })
        .success,
    ).toBe(false);
  });

  it('rejects a missing serviceId', () => {
    expect(availabilityQuerySchema.safeParse({ date: '2026-08-05' }).success).toBe(false);
  });
});

describe('staffListQuerySchema', () => {
  it('accepts a valid serviceId', () => {
    expect(staffListQuerySchema.safeParse({ serviceId: '22222222-2222-2222-2222-222222222222' }).success).toBe(true);
  });

  it('rejects a non-UUID serviceId', () => {
    expect(staffListQuerySchema.safeParse({ serviceId: 'nope' }).success).toBe(false);
  });
});
