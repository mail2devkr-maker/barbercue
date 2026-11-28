import {
  adminCrmAnalyticsQuerySchema,
  adminCrmFollowUpPageQuerySchema,
  adminCrmLeadPageQuerySchema,
  adminCrmVisitPageQuerySchema,
} from '../schemas';
import {
  CrmFollowUpChannel,
  CrmFollowUpStatus,
  CrmLeadSource,
  CrmLeadStatus,
  CrmVisitOutcome,
} from '../enums';

describe('admin CRM analytics queries', () => {
  it('normalizes bounded lead page filters and query-string limits', () => {
    expect(
      adminCrmLeadPageQuerySchema.parse({
        employeeId: 'b2b5df36-f837-4d9e-9866-cddbf064626e',
        status: CrmLeadStatus.CONTACTED,
        source: CrmLeadSource.FIELD_VISIT,
        q: '  Salon Patna  ',
        limit: '25',
      }),
    ).toMatchObject({
      status: CrmLeadStatus.CONTACTED,
      source: CrmLeadSource.FIELD_VISIT,
      q: 'Salon Patna',
      limit: 25,
    });
  });

  it('accepts the supported visit and follow-up filters and defaults pages to 50', () => {
    expect(
      adminCrmVisitPageQuerySchema.parse({
        outcome: CrmVisitOutcome.INTERESTED,
      }),
    ).toMatchObject({ outcome: CrmVisitOutcome.INTERESTED, limit: 50 });
    expect(
      adminCrmFollowUpPageQuerySchema.parse({
        status: CrmFollowUpStatus.OPEN,
        channel: CrmFollowUpChannel.CALL,
      }),
    ).toMatchObject({
      status: CrmFollowUpStatus.OPEN,
      channel: CrmFollowUpChannel.CALL,
      limit: 50,
    });
  });

  it('rejects invalid ranges, oversized ranges, invalid enums and unbounded page sizes', () => {
    expect(
      adminCrmLeadPageQuerySchema.safeParse({
        from: '2026-01-02T00:00:00.000Z',
        to: '2026-01-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      adminCrmVisitPageQuerySchema.safeParse({
        from: '2024-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      adminCrmFollowUpPageQuerySchema.safeParse({ status: 'NOT_A_STATUS' })
        .success,
    ).toBe(false);
    expect(
      adminCrmLeadPageQuerySchema.safeParse({ limit: '101' }).success,
    ).toBe(false);
  });

  it('requires explicit ISO-8601 analytics bounds', () => {
    const valid = adminCrmAnalyticsQuerySchema.safeParse({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-19T00:00:00.000Z',
    });
    expect(valid.success).toBe(true);
    expect(
      adminCrmAnalyticsQuerySchema.safeParse({ from: '2026-10-01' }).success,
    ).toBe(false);
  });
});
