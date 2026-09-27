import {
  CrmFollowUpStatus,
  CrmLeadSource,
  CrmLeadStatus,
  CrmTaskPriority,
  CrmTaskStatus,
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

    const task = {
      id: 'task-1',
      employeeProfileId: employee.id,
      createdByUserId: 'admin-1',
      title: 'Visit 10 salons',
      description: 'Cover assigned territory',
      dueAt: new Date('2026-09-29T10:00:00.000Z'),
      priority: CrmTaskPriority.HIGH,
      status: CrmTaskStatus.TODO,
      completedAt: null,
      completionNotes: null,
      createdAt: new Date('2026-09-21T00:00:00.000Z'),
      updatedAt: new Date('2026-09-21T00:00:00.000Z'),
      employeeProfile: employee,
    };


    let leadCountCalls = 0;
    let visitCountCalls = 0;
    let followUpCountCalls = 0;
    let taskCountCalls = 0;
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
      employeeCrmTask: {
        count: jest.fn().mockImplementation(() => {
          taskCountCalls += 1;
          return Promise.resolve(taskCountCalls % 3 === 1 ? 4 : taskCountCalls % 3 === 2 ? 1 : 2);
        }),
        findMany: jest.fn().mockResolvedValue([task]),
      },
    };

    const result = await new AdminCrmService(prisma).getOverview();

    expect(result.counts.employees).toBe(1);
    expect(result.counts.leads).toBe(4);
    expect(result.counts.onboarded).toBe(2);
    expect(result.counts.openTasks).toBe(4);
    expect(result.counts.overdueTasks).toBe(1);
    expect(result.conversionRatePercent).toBe(50);
    expect(result.performance).toHaveLength(1);
    expect(result.performance[0].employee.employeeCode).toBe('FQ-FE-00101');
    expect(result.performance[0].openTasks).toBe(2);
    expect(result.dueTasks[0].title).toBe('Visit 10 salons');
    expect(result.recentLeads[0].onboardedSalon?.publicId).toBe('BC-SHOP-000123');
  });

  it('assigns tasks only to active employees and audits the assignment', async () => {
    const employee = {
      id: 'emp-active',
      employeeCode: 'FQ-FE-00102',
      fullName: 'Active Executive',
      territory: 'Ghaziabad',
      joinedAt: new Date('2026-09-25T00:00:00.000Z'),
    };
    const created = {
      id: 'task-new',
      employeeProfileId: employee.id,
      createdByUserId: 'admin-1',
      title: 'Visit 10 salons',
      description: 'Cover Vaishali',
      dueAt: new Date('2026-09-30T10:00:00.000Z'),
      priority: CrmTaskPriority.HIGH,
      status: CrmTaskStatus.TODO,
      completedAt: null,
      completionNotes: null,
      createdAt: new Date('2026-09-28T00:00:00.000Z'),
      updatedAt: new Date('2026-09-28T00:00:00.000Z'),
      employeeProfile: employee,
    };
    const tx = {
      employeeCrmTask: { create: jest.fn().mockResolvedValue(created) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      employeeProfile: { findFirst: jest.fn().mockResolvedValue(employee) },
      $transaction: jest.fn((callback: any) => callback(tx)),
    };

    const result = await new AdminCrmService(prisma).createTask('admin-1', {
      employeeProfileId: employee.id,
      title: 'Visit 10 salons',
      description: 'Cover Vaishali',
      dueAt: '2026-09-30T10:00:00.000Z',
      priority: CrmTaskPriority.HIGH,
    });

    expect(prisma.employeeProfile.findFirst).toHaveBeenCalledWith({
      where: {
        id: employee.id,
        user: { status: UserStatus.ACTIVE },
      },
    });
    expect(result.title).toBe('Visit 10 salons');
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'admin-1',
        action: 'CRM_TASK_ASSIGNED',
        entityId: 'task-new',
      }),
    });
  });

});
