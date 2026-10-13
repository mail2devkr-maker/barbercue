import { CrmErrorCode } from '@barbercue/shared';
import { Reflector } from '@nestjs/core';
import { EmployeeController } from './employee.controller';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { AppException } from '../common/exceptions/app.exception';
import { EmployeeVoiceVisitService } from './employee-voice-visit.service';

const profile = { id: 'profile-a', employeeCode: 'FQ-FE-00101' };
const lead = { id: 'lead-a', shopName: 'Ganesh Salon' };
const structuredDraft = {
  shopName: 'Ganesh Salon',
  ownerName: 'Rahul',
  mobile: null,
  address: null,
  city: null,
  locality: null,
  chairs: 4,
  staffCount: 5,
  services: [{ name: 'Haircut', priceRupees: 100 }],
  notes: null,
};
const input = {
  submissionKey: 'e7d76876-8133-4760-957d-2d7d720b99c6',
  transcript: 'Ganesh Salon. Haircut 100 rupees.',
  language: 'hi-IN' as const,
  structuredDraft,
};

function log(status = 'DRAFT') {
  return {
    id: 'log-a',
    leadId: lead.id,
    employeeProfileId: profile.id,
    submissionKey: input.submissionKey,
    transcript: input.transcript,
    language: input.language,
    structuredDraft,
    status,
    createdAt: new Date('2026-10-13T10:00:00.000Z'),
    updatedAt: new Date('2026-10-13T10:00:00.000Z'),
    confirmedAt:
      status === 'CONFIRMED' ? new Date('2026-10-13T10:00:00.000Z') : null,
    employeeProfile: {
      fullName: 'Field Executive A',
      employeeCode: profile.employeeCode,
    },
  };
}

describe('EmployeeVoiceVisitService', () => {
  let prisma: any;
  let tx: any;
  let service: EmployeeVoiceVisitService;

  beforeEach(() => {
    tx = {
      employeeVoiceVisitLog: {
        create: jest.fn().mockResolvedValue(log()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(log()),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      employeeProfile: { findUnique: jest.fn().mockResolvedValue(profile) },
      employeeCrmLead: { findFirst: jest.fn().mockResolvedValue(lead) },
      employeeVoiceVisitLog: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(log()),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(log()),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((callback: (txArg: any) => unknown) =>
        callback(tx),
      ),
    };
    service = new EmployeeVoiceVisitService(prisma);
  });

  it('keeps every employee CRM route behind FIELD_EXECUTIVE role authorization', () => {
    expect(new Reflector().get(ROLES_KEY, EmployeeController)).toEqual([
      'FIELD_EXECUTIVE',
    ]);
  });

  it('derives employee identity from the authenticated user and saves a resumable draft', async () => {
    await service.create('user-a', lead.id, input);
    expect(prisma.employeeProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-a' },
      select: { id: true, employeeCode: true },
    });
    expect(prisma.employeeCrmLead.findFirst).toHaveBeenCalledWith({
      where: { id: lead.id, employeeProfileId: profile.id },
      select: { id: true, shopName: true },
    });
    expect(tx.employeeVoiceVisitLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employeeProfileId: profile.id,
          leadId: lead.id,
          submissionKey: input.submissionKey,
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'user-a',
          action: 'EMPLOYEE_VOICE_VISIT_DRAFT_SAVED',
        }),
      }),
    );
  });

  it('does not reveal another employee’s lead logs', async () => {
    prisma.employeeCrmLead.findFirst.mockResolvedValue(null);
    await expect(
      service.list('user-b', lead.id, { limit: 20 }),
    ).rejects.toMatchObject({
      code: CrmErrorCode.LEAD_NOT_FOUND,
    });
    expect(prisma.employeeVoiceVisitLog.findMany).not.toHaveBeenCalled();
    await expect(
      service.create('user-b', lead.id, input),
    ).rejects.toMatchObject({
      code: CrmErrorCode.LEAD_NOT_FOUND,
    });
    await expect(
      service.update('user-b', lead.id, 'log-a', {
        transcript: input.transcript,
        language: input.language,
        structuredDraft,
        status: 'DRAFT',
      }),
    ).rejects.toMatchObject({ code: CrmErrorCode.LEAD_NOT_FOUND });
    expect(prisma.employeeVoiceVisitLog.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns an idempotent retry for the same submission key and payload', async () => {
    prisma.employeeVoiceVisitLog.findUnique.mockResolvedValue({
      ...log(),
      // JSONB does not promise preserving object property order across a database round trip.
      structuredDraft: Object.fromEntries(
        Object.entries(structuredDraft).reverse(),
      ),
    });
    const result = await service.create('user-a', lead.id, input);
    expect(result.id).toBe('log-a');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects reusing a submission key with a different lead or payload', async () => {
    prisma.employeeVoiceVisitLog.findUnique.mockResolvedValue({
      ...log(),
      leadId: 'lead-other',
    });
    await expect(
      service.create('user-a', lead.id, input),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('locks confirmed records and makes an identical confirm retry idempotent', async () => {
    const confirmed = log('CONFIRMED');
    prisma.employeeVoiceVisitLog.findFirst.mockResolvedValue(confirmed);
    const result = await service.update('user-a', lead.id, confirmed.id, {
      transcript: input.transcript,
      language: input.language,
      structuredDraft,
      status: 'CONFIRMED',
      reviewAcknowledged: true,
    });
    expect(result.status).toBe('CONFIRMED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await expect(
      service.update('user-a', lead.id, confirmed.id, {
        transcript: 'different',
        language: input.language,
        structuredDraft,
        status: 'CONFIRMED',
        reviewAcknowledged: true,
      }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('rejects final confirmation unless the employee explicitly acknowledges review', async () => {
    await expect(
      service.update('user-a', lead.id, 'log-a', {
        transcript: input.transcript,
        language: input.language,
        structuredDraft,
        status: 'CONFIRMED',
      }),
    ).rejects.toMatchObject({
      code: 'EMPLOYEE_VOICE_REVIEW_ACKNOWLEDGMENT_REQUIRED',
    });
    expect(prisma.employeeVoiceVisitLog.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('confirms a draft with a transactional audit entry that excludes transcript content', async () => {
    tx.employeeVoiceVisitLog.findFirst.mockResolvedValue(log('CONFIRMED'));
    const result = await service.update('user-a', lead.id, 'log-a', {
      transcript: input.transcript,
      language: input.language,
      structuredDraft,
      status: 'CONFIRMED',
      reviewAcknowledged: true,
    });

    expect(result.status).toBe('CONFIRMED');
    expect(tx.employeeVoiceVisitLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'log-a',
          employeeProfileId: profile.id,
          leadId: lead.id,
          status: 'DRAFT',
        },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'user-a',
          action: 'EMPLOYEE_VOICE_VISIT_CONFIRMED',
          metadata: expect.not.objectContaining({
            transcript: expect.anything(),
          }),
        }),
      }),
    );
  });

  it('conflicts when concurrent save finds the draft already confirmed with different data', async () => {
    tx.employeeVoiceVisitLog.updateMany.mockResolvedValue({ count: 0 });
    tx.employeeVoiceVisitLog.findFirst.mockResolvedValue(log('CONFIRMED'));
    await expect(
      service.update('user-a', lead.id, 'log-a', {
        transcript: input.transcript,
        language: input.language,
        structuredDraft,
        status: 'DRAFT',
      }),
    ).rejects.toBeInstanceOf(AppException);
  });

  it('lists logs with a stable newest-first cursor and employee identity', async () => {
    prisma.employeeVoiceVisitLog.findMany.mockResolvedValue([log()]);
    const page = await service.list('user-a', lead.id, { limit: 1 });
    expect(page.lead).toEqual(lead);
    expect(page.items[0]?.employee).toEqual({
      fullName: 'Field Executive A',
      employeeCode: profile.employeeCode,
    });
    expect(prisma.employeeVoiceVisitLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { employeeProfileId: profile.id, leadId: lead.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 2,
      }),
    );
  });
});
