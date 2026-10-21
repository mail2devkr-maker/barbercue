import {
  createEmployeeIdentitySchema,
  createEmployeeOfferSchema,
  joinEmployeeSchema,
  matchEmployeeIdentitySchema,
  updateEmployeeOfferDocumentSchema,
  updateEmployeeOfferStatusSchema,
} from '../schemas';

describe('HR employee register contracts', () => {
  it('requires contact data for matching and rejects name-only candidates', () => {
    expect(
      createEmployeeIdentitySchema.safeParse({
        idempotencyKey: 'create-person-1',
        fullName: 'A Candidate',
      }).success,
    ).toBe(false);
    expect(
      createEmployeeIdentitySchema.safeParse({
        idempotencyKey: 'create-person-1',
        fullName: 'A Candidate',
        phone: '+919876543210',
        matchReview: {
          decision: 'NO_MATCH',
          evidenceReference: 'HR-CASE-1001',
          reason: 'Registry checked before candidate creation.',
        },
      }).success,
    ).toBe(true);
  });

  it('accepts contact matching in a POST body and rejects empty match requests', () => {
    expect(
      matchEmployeeIdentitySchema.safeParse({
        fullName: 'A Candidate',
        email: 'candidate@example.test',
      }).success,
    ).toBe(true);
    expect(matchEmployeeIdentitySchema.safeParse({}).success).toBe(false);
  });

  it('does not invent compensation values and requires an explicit base amount', () => {
    const schema = createEmployeeOfferSchema.safeParse({
      idempotencyKey: 'draft-offer-001',
      position: 'Field Executive',
      compensation: { baseAmount: 18000, frequency: 'MONTHLY' },
    });
    expect(schema.success).toBe(true);
    if (schema.success)
      expect(schema.data.compensation.incentiveAmount).toBeUndefined();
    expect(
      createEmployeeOfferSchema.safeParse({
        idempotencyKey: 'draft-offer-001',
        position: 'Field Executive',
        compensation: { frequency: 'MONTHLY' },
      }).success,
    ).toBe(false);
  });

  it('requires evidence for acceptance and recorded offer email delivery', () => {
    expect(
      updateEmployeeOfferStatusSchema.safeParse({
        idempotencyKey: 'accept-offer-001',
        status: 'ACCEPTED',
      }).success,
    ).toBe(false);
    expect(
      updateEmployeeOfferStatusSchema.safeParse({
        idempotencyKey: 'accept-offer-001',
        status: 'ACCEPTED',
        evidenceReference: 'HR-CASE-1042',
      }).success,
    ).toBe(true);
    expect(
      updateEmployeeOfferDocumentSchema.safeParse({
        idempotencyKey: 'email-offer-001',
        status: 'EMAILED',
      }).success,
    ).toBe(false);
    expect(
      updateEmployeeOfferDocumentSchema.safeParse({
        idempotencyKey: 'email-offer-001',
        status: 'EMAILED',
        evidenceReference: 'HR-CASE-1042',
      }).success,
    ).toBe(true);
  });

  it('requires paired passwords but permits rehire without resetting an existing login password', () => {
    expect(
      joinEmployeeSchema.safeParse({ idempotencyKey: 'join-rehire-001' })
        .success,
    ).toBe(true);
    expect(
      joinEmployeeSchema.safeParse({
        idempotencyKey: 'join-newhire-001',
        password: 'StrongPass123',
      }).success,
    ).toBe(false);
    expect(
      joinEmployeeSchema.safeParse({
        idempotencyKey: 'join-newhire-001',
        password: 'StrongPass123',
        confirmPassword: 'StrongPass123',
      }).success,
    ).toBe(true);
  });
});
