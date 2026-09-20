import {
  CrmFollowUpChannel,
  CrmFollowUpStatus,
  CrmLeadSource,
  CrmLeadStatus,
  CrmVisitOutcome,
} from '@barbercue/shared';
import { EmployeeService } from './employee.service';

describe('EmployeeService CRM', () => {
  let prisma: any;
  let service: EmployeeService;

  const profile = {
    id: 'employee-profile-1',
    employeeCode: 'FQ-FE-00101',
    fullName: 'Field Executive',
    territory: 'Patna',
    joinedAt: new Date('2026-09-20T00:00:00.000Z'),
  };

  const leadRow = {
    id: 'lead-1',
    employeeProfileId: profile.id,
    shopName: 'Test Salon',
    contactName: 'Owner',
    phone: '+919876543210',
    email: 'owner@example.com',
    city: 'Patna',
    locality: 'Saguna More',
    addressLine: null,
    source: CrmLeadSource.FIELD_VISIT,
    status: CrmLeadStatus.NEW,
    notes: null,
    lostReason: null,
    onboardedSalonId: null,
    onboardedAt: null,
    createdAt: new Date('2026-09-21T00:00:00.000Z'),
    updatedAt: new Date('2026-09-21T00:00:00.000Z'),
    onboardedSalon: null,
  };

  beforeEach(() => {
    const tx = {
      employeeCrmLead: {
        update: jest.fn().mockResolvedValue({}),
      },
      employeeCrmFollowUp: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
      employeeCrmVisit: {
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    prisma = {
      employeeProfile: {
        findUnique: jest.fn().mockResolvedValue(profile),
      },
      employeeCrmLead: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(leadRow),
        create: jest.fn().mockResolvedValue(leadRow),
        update: jest.fn().mockResolvedValue(leadRow),
      },
      employeeCrmVisit: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      employeeCrmFollowUp: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      salon: {
        findUnique: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((callback: any) => callback(tx)),
      __tx: tx,
    };
    service = new EmployeeService(prisma);
  });

  it('creates a lead attributed to the authenticated employee profile', async () => {
    await service.createLead('user-1', {
      shopName: 'Test Salon',
      contactName: 'Owner',
      phone: '+919876543210',
      email: 'OWNER@example.com',
      city: 'Patna',
      locality: 'Saguna More',
      source: CrmLeadSource.FIELD_VISIT,
      notes: '',
    });

    expect(prisma.employeeCrmLead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeProfileId: profile.id,
        shopName: 'Test Salon',
        email: 'owner@example.com',
        source: CrmLeadSource.FIELD_VISIT,
      }),
      include: {
        onboardedSalon: { select: { id: true, publicId: true, name: true } },
      },
    });
  });

  it('scopes lead reads to the authenticated employee profile', async () => {
    await service.listLeads('user-1', CrmLeadStatus.INTERESTED);

    expect(prisma.employeeCrmLead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          employeeProfileId: profile.id,
          status: CrmLeadStatus.INTERESTED,
        },
      }),
    );
  });

  it('attributes a real FastQue shop and completes open follow-ups', async () => {
    const onboarded = {
      ...leadRow,
      status: CrmLeadStatus.ONBOARDED,
      onboardedSalonId: 'salon-1',
      onboardedAt: new Date('2026-09-21T02:00:00.000Z'),
      onboardedSalon: {
        id: 'salon-1',
        publicId: 'BC-SHOP-000123',
        name: 'Test Salon',
      },
    };
    prisma.salon.findUnique.mockResolvedValue({
      id: 'salon-1',
      publicId: 'BC-SHOP-000123',
      name: 'Test Salon',
    });
    prisma.employeeCrmLead.findFirst
      .mockResolvedValueOnce(leadRow)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(onboarded);

    const result = await service.onboardLead('user-1', 'lead-1', {
      salonPublicId: 'BC-SHOP-000123',
    });

    expect(prisma.__tx.employeeCrmLead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: expect.objectContaining({
        status: CrmLeadStatus.ONBOARDED,
        onboardedSalonId: 'salon-1',
        lostReason: null,
      }),
    });
    expect(prisma.__tx.employeeCrmFollowUp.updateMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-1', status: CrmFollowUpStatus.OPEN },
      data: expect.objectContaining({
        status: CrmFollowUpStatus.COMPLETED,
        outcome: 'Shop onboarded on FastQue',
      }),
    });
    expect(prisma.__tx.auditLog.create).toHaveBeenCalled();
    expect(result.onboardedSalon?.publicId).toBe('BC-SHOP-000123');
  });

  it('rejects re-attributing an already-onboarded lead to a different shop', async () => {
    const onboarded = {
      ...leadRow,
      status: CrmLeadStatus.ONBOARDED,
      onboardedSalonId: 'salon-1',
      onboardedAt: new Date('2026-09-21T02:00:00.000Z'),
      onboardedSalon: {
        id: 'salon-1',
        publicId: 'BC-SHOP-000123',
        name: 'Test Salon',
      },
    };
    prisma.employeeCrmLead.findFirst
      .mockResolvedValueOnce(onboarded)
      .mockResolvedValueOnce(onboarded);

    await expect(
      service.onboardLead('user-1', 'lead-1', {
        salonPublicId: 'BC-SHOP-000999',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_LEAD_TRANSITION' });

    expect(prisma.salon.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a future timestamp for a completed field visit', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await expect(
      service.createVisit('user-1', {
        leadId: leadRow.id,
        outcome: CrmVisitOutcome.CONTACTED,
        visitedAt: future,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_LEAD_TRANSITION' });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('logs a visit against an owned lead and advances a new lead to interested', async () => {
    const visit = {
      id: 'visit-1',
      leadId: leadRow.id,
      shopName: leadRow.shopName,
      visitedAt: new Date('2026-09-21T02:30:00.000Z'),
      outcome: CrmVisitOutcome.INTERESTED,
      notes: 'Demo requested',
      createdAt: new Date('2026-09-21T02:30:00.000Z'),
      lead: { shopName: leadRow.shopName },
    };
    prisma.__tx.employeeCrmVisit.create.mockResolvedValue(visit);

    const result = await service.createVisit('user-1', {
      leadId: leadRow.id,
      outcome: CrmVisitOutcome.INTERESTED,
      notes: 'Demo requested',
    });

    expect(prisma.__tx.employeeCrmLead.update).toHaveBeenCalledWith({
      where: { id: leadRow.id },
      data: { status: CrmLeadStatus.INTERESTED },
    });
    expect(result.outcome).toBe(CrmVisitOutcome.INTERESTED);
  });

  it('creates a follow-up only for a lead owned by the employee', async () => {
    const followUp = {
      id: 'followup-1',
      leadId: leadRow.id,
      dueAt: new Date('2026-09-22T10:00:00.000Z'),
      channel: CrmFollowUpChannel.CALL,
      status: CrmFollowUpStatus.OPEN,
      notes: 'Call owner',
      outcome: null,
      completedAt: null,
      createdAt: new Date('2026-09-21T02:40:00.000Z'),
      updatedAt: new Date('2026-09-21T02:40:00.000Z'),
      lead: { shopName: leadRow.shopName },
    };
    prisma.__tx.employeeCrmFollowUp.create.mockResolvedValue(followUp);

    const result = await service.createFollowUp('user-1', {
      leadId: leadRow.id,
      dueAt: '2026-09-22T10:00:00.000Z',
      channel: CrmFollowUpChannel.CALL,
      notes: 'Call owner',
    });

    expect(prisma.__tx.employeeCrmFollowUp.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeProfileId: profile.id,
        leadId: leadRow.id,
        channel: CrmFollowUpChannel.CALL,
      }),
      include: { lead: { select: { shopName: true } } },
    });
    expect(result.status).toBe(CrmFollowUpStatus.OPEN);
  });
});
