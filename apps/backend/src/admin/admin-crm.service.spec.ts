import {
  CrmFollowUpStatus,
  CrmLeadSource,
  CrmLeadStatus,
  CrmVisitOutcome,
  UserStatus,
} from '@barbercue/shared';
import { AdminCrmService } from './admin-crm.service';

describe('AdminCrmService', () => {
  it('aggregates employee performance and platform conversion metrics', async () => {
    const employee = {
      id: 'emp-1',
      employeeCode: 'FQ-FE-00101',
      fullName: 'Field Executive',
      territory: 'Patna',
      joinedAt: new Date('2026-09-20T00:00:00.000Z'),
      user: { status: UserStatus.ACTIVE },
    };
    const lead = {
      id: 'lead-1',
      shopName: 'Test Salon',
      contactName: null,
      phone: null,
      email: null,
      city: 'Patna',
      locality: null,
      addressLine: null,
      source: CrmLeadSource.FIELD_VISIT,
      status: CrmLeadStatus.ONBOARDED,
      notes: null,
      lostReason: null,
      onboardedAt: new Date('2026-09-21T00:00:00.000Z'),
      createdAt: new Date('2026-09-20T00:00:00.000Z'),
      updatedAt: new Date('2026-09-21T00:00:00.000Z'),
      employeeProfile: employee,
      onboardedSalon: {
        id: 'salon-1',
        publicId: 'BC-SHOP-000123',
        name: 'Test Salon',
      },
    };
    const visit = {
      id: 'visit-1',
      leadId: 'lead-1',
      shopName: 'Test Salon',
      visitedAt: new Date('2026-09-21T00:00:00.000Z'),
      outcome: CrmVisitOutcome.INTERESTED,
      notes: null,
      createdAt: new Date('2026-09-21T00:00:00.000Z'),
      employeeProfile: employee,
      lead: { shopName: 'Test Salon' },
    };
    const followUp = {
      id: 'fu-1',
      leadId: 'lead-1',
      dueAt: new Date('2026-09-22T00:00:00.000Z'),
      channel: 'CALL',
      status: CrmFollowUpStatus.OPEN,
      notes: null,
      outcome: null,
      completedAt: null,
      createdAt: new Date('2026-09-21T00:00:00.000Z'),
      updatedAt: new Date('2026-09-21T00:00:00.000Z'),
      employeeProfile: employee,
      lead: { shopName: 'Test Salon' },
    };

    let leadCountCalls = 0;
    let visitCountCalls = 0;
    let followUpCountCalls = 0;
    const prisma: any = {
      employeeProfile: { findMany: jest.fn().mockResolvedValue([employee]) },
      employeeCrmLead: {
        count: jest.fn().mockImplementation(() => Promise.resolve(++leadCountCalls <= 2 ? (leadCountCalls === 1 ? 4 : 2) : (leadCountCalls === 3 ? 4 : 2))),
        findMany: jest.fn().mockResolvedValue([lead]),
      },
      employeeCrmVisit: {
        count: jest.fn().mockImplementation(() => Promise.resolve(++visitCountCalls <= 2 ? 7 : 0)),
        findMany: jest.fn().mockResolvedValue([visit]),
      },
      employeeCrmFollowUp: {
        count: jest.fn().mockImplementation(() => {
          followUpCountCalls += 1;
          return Promise.resolve(followUpCountCalls % 2 === 1 ? 3 : 1);
        }),
        findMany: jest.fn().mockResolvedValue([followUp]),
      },
    };

    const result = await new AdminCrmService(prisma).getOverview();

    expect(result.counts.employees).toBe(1);
    expect(result.counts.leads).toBe(4);
    expect(result.counts.onboarded).toBe(2);
    expect(result.conversionRatePercent).toBe(50);
    expect(result.performance).toHaveLength(1);
    expect(result.performance[0].employee.employeeCode).toBe('FQ-FE-00101');
    expect(result.recentLeads[0].onboardedSalon?.publicId).toBe('BC-SHOP-000123');
  });
});
