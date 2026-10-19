import {
  CrmErrorCode,
  CrmLeadStatus,
  UserStatus,
  adminCrmAnalyticsQuerySchema,
  adminCrmLeadPageQuerySchema,
} from '@barbercue/shared';
import { AdminCrmService } from './admin-crm.service';

const ACCESS_SECRET = 'admin-crm-cursor-test-secret-32-characters-minimum';

function leadRow(id: string, updatedAt: Date) {
  const employeeProfile = {
    id: 'b2b5df36-f837-4d9e-9866-cddbf064626e',
    employeeCode: 'FQ-FE-00101',
    fullName: 'Synthetic Field Executive',
    territory: 'Patna',
    joinedAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  return {
    id,
    shopName: `Synthetic Salon ${id}`,
    contactName: null,
    phone: null,
    email: null,
    city: 'Patna',
    locality: null,
    addressLine: null,
    source: 'FIELD_VISIT',
    status: CrmLeadStatus.NEW,
    notes: null,
    lostReason: null,
    onboardedAt: null,
    createdAt: updatedAt,
    updatedAt,
    employeeProfile,
    onboardedSalon: null,
  };
}

describe('AdminCrmService analytics and cursor pages', () => {
  const previousSecret = process.env.JWT_ACCESS_SECRET;

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = previousSecret;
  });

  it('uses deterministic keyset pages and binds a cursor to filters and actor', async () => {
    const later = leadRow(
      'f916e145-8a8b-4dbf-b9d8-6c522a9c2dc7',
      new Date('2026-10-18T12:00:00.000Z'),
    );
    const earlier = leadRow(
      'ae82b998-7286-4c8d-b0f1-49df0b4c48cc',
      new Date('2026-10-18T11:00:00.000Z'),
    );
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([later, earlier])
      .mockResolvedValueOnce([earlier]);
    const service = new AdminCrmService({
      employeeCrmLead: { findMany },
    } as never);
    const query = adminCrmLeadPageQuerySchema.parse({
      limit: '1',
      q: 'Synthetic',
    });

    const first = await service.pageLeads('admin-1', query);
    expect(first.items.map((item) => item.id)).toEqual([later.id]);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(findMany.mock.calls[0][0]).toMatchObject({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 2,
    });

    const second = await service.pageLeads('admin-1', {
      ...query,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((item) => item.id)).toEqual([earlier.id]);
    expect(second.nextCursor).toBeNull();
    expect(findMany.mock.calls[1][0].where.AND[1].OR).toEqual([
      { createdAt: { lt: later.createdAt } },
      { createdAt: later.createdAt, id: { lt: later.id } },
    ]);

    await expect(
      service.pageLeads('admin-1', {
        ...query,
        q: 'Different filter',
        cursor: first.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: CrmErrorCode.ADMIN_CURSOR_INVALID });
    await expect(
      service.pageLeads('admin-2', { ...query, cursor: first.nextCursor! }),
    ).rejects.toMatchObject({ code: CrmErrorCode.ADMIN_CURSOR_INVALID });
  });

  it('rejects a tampered cursor before querying data', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        leadRow(
          'f916e145-8a8b-4dbf-b9d8-6c522a9c2dc7',
          new Date('2026-10-18T12:00:00.000Z'),
        ),
        leadRow(
          'ae82b998-7286-4c8d-b0f1-49df0b4c48cc',
          new Date('2026-10-18T11:00:00.000Z'),
        ),
      ]);
    const service = new AdminCrmService({
      employeeCrmLead: { findMany },
    } as never);
    const query = adminCrmLeadPageQuerySchema.parse({ limit: 1 });
    const first = await service.pageLeads('admin-1', query);
    const [payload, signature] = first.nextCursor!.split('.');
    const tampered = `${payload}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;

    await expect(
      service.pageLeads('admin-1', { ...query, cursor: tampered }),
    ).rejects.toMatchObject({ code: CrmErrorCode.ADMIN_CURSOR_INVALID });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('fails closed when cursor signing configuration is unavailable', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        leadRow(
          'f916e145-8a8b-4dbf-b9d8-6c522a9c2dc7',
          new Date('2026-10-18T12:00:00.000Z'),
        ),
        leadRow(
          'ae82b998-7286-4c8d-b0f1-49df0b4c48cc',
          new Date('2026-10-18T11:00:00.000Z'),
        ),
      ]);
    const service = new AdminCrmService({
      employeeCrmLead: { findMany },
    } as never);
    const query = adminCrmLeadPageQuerySchema.parse({ limit: 1 });
    const signedPage = await service.pageLeads('admin-1', query);
    const configuredSecret = process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_ACCESS_SECRET;

    try {
      await expect(
        service.pageLeads('admin-1', {
          ...query,
          cursor: signedPage.nextCursor!,
        }),
      ).rejects.toMatchObject({ code: CrmErrorCode.ADMIN_CURSOR_UNAVAILABLE });
    } finally {
      if (configuredSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
      else process.env.JWT_ACCESS_SECRET = configuredSecret;
    }
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('aggregates only bounded CRM counts and omits employee contact identity', async () => {
    const employee = {
      id: 'emp-1',
      employeeCode: 'FQ-FE-00101',
      territory: 'Patna',
      user: { status: UserStatus.ACTIVE },
    };
    const grouped = (count: number) => [
      { employeeProfileId: 'emp-1', _count: { _all: count } },
    ];
    const prisma: any = {
      employeeProfile: { findMany: jest.fn().mockResolvedValue([employee]) },
      employeeCrmLead: { groupBy: jest.fn() },
      employeeCrmVisit: { groupBy: jest.fn() },
      employeeCrmFollowUp: { groupBy: jest.fn() },
    };
    prisma.employeeCrmLead.groupBy
      .mockResolvedValueOnce(grouped(4))
      .mockResolvedValueOnce(grouped(2))
      .mockResolvedValueOnce(grouped(1));
    prisma.employeeCrmVisit.groupBy.mockResolvedValueOnce(grouped(3));
    prisma.employeeCrmFollowUp.groupBy
      .mockResolvedValueOnce(grouped(2))
      .mockResolvedValueOnce(grouped(1));
    prisma.$transaction = jest.fn((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    );
    const service = new AdminCrmService(prisma);
    const query = adminCrmAnalyticsQuerySchema.parse({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-19T00:00:00.000Z',
    });

    const result = await service.getAnalytics(query);
    expect(result.totals).toEqual({
      leadsCreated: 4,
      onboardedFromPeriodLeads: 2,
      leadsOnboardedInPeriod: 1,
      visits: 3,
      followUpsCompleted: 2,
      openFollowUpsOverdueInPeriod: 1,
    });
    expect(result.territories[0]).toMatchObject({
      territory: 'Patna',
      employees: 1,
      leadsCreated: 4,
      conversionPercent: 50,
    });
    expect(result.employees[0]).not.toHaveProperty('fullName');
    expect(result.employees[0]).not.toHaveProperty('email');
    expect(result.employees[0]).not.toHaveProperty('phone');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Array), {
      isolationLevel: expect.any(String),
    });
  });
});
