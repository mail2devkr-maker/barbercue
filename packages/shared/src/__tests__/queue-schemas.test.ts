import { assignQueueEntrySchema, joinQueueSchema, reassignQueueEntrySchema, staffStatusSchema } from '../schemas';

describe('joinQueueSchema', () => {
  it('accepts no serviceId (walk-in without a chosen service)', () => {
    expect(joinQueueSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a valid serviceId', () => {
    expect(joinQueueSchema.safeParse({ serviceId: '22222222-2222-2222-2222-222222222222' }).success).toBe(true);
  });

  it('rejects a non-UUID serviceId', () => {
    expect(joinQueueSchema.safeParse({ serviceId: 'nope' }).success).toBe(false);
  });
});

describe('assignQueueEntrySchema', () => {
  const valid = {
    staffId: '11111111-1111-1111-1111-111111111111',
    chairId: '33333333-3333-3333-3333-333333333333',
  };

  it('accepts staffId + chairId without serviceId', () => {
    expect(assignQueueEntrySchema.safeParse(valid).success).toBe(true);
  });

  it('accepts an optional serviceId', () => {
    expect(
      assignQueueEntrySchema.safeParse({ ...valid, serviceId: '22222222-2222-2222-2222-222222222222' }).success,
    ).toBe(true);
  });

  it('rejects a missing chairId', () => {
    const { chairId: _chairId, ...rest } = valid;
    expect(assignQueueEntrySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a non-UUID staffId', () => {
    expect(assignQueueEntrySchema.safeParse({ ...valid, staffId: 'nope' }).success).toBe(false);
  });
});

describe('staffStatusSchema', () => {
  it('accepts ACTIVE', () => {
    expect(staffStatusSchema.safeParse({ status: 'ACTIVE' }).success).toBe(true);
  });

  it('accepts INACTIVE', () => {
    expect(staffStatusSchema.safeParse({ status: 'INACTIVE' }).success).toBe(true);
  });

  it('rejects an unknown status value', () => {
    expect(staffStatusSchema.safeParse({ status: 'ON_BREAK' }).success).toBe(false);
  });
});

describe('reassignQueueEntrySchema', () => {
  const staffId = '11111111-1111-1111-1111-111111111111';
  const chairId = '33333333-3333-3333-3333-333333333333';

  it('accepts barber-only, chair-only, or both', () => {
    expect(reassignQueueEntrySchema.safeParse({ staffId }).success).toBe(true);
    expect(reassignQueueEntrySchema.safeParse({ chairId }).success).toBe(true);
    expect(reassignQueueEntrySchema.safeParse({ staffId, chairId }).success).toBe(true);
  });

  it('rejects an empty or malformed reassignment', () => {
    expect(reassignQueueEntrySchema.safeParse({}).success).toBe(false);
    expect(reassignQueueEntrySchema.safeParse({ staffId: 'nope' }).success).toBe(false);
  });
});
