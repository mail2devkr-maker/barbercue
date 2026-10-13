import { createEmployeeVoiceLogSchema } from '@barbercue/shared';
import { EmployeeVoiceLogsService } from './employee-voice-logs.service';

describe('Employee voice onboarding logs: privacy and ownership', () => {
  const userId = 'employee-user-1';
  const employeeProfileId = 'profile-1';
  const leadId = '9ae00ed1-17a7-4a92-a70d-eae2c049fc9e';
  const clientRequestId = 'be2b610d-b69a-44eb-a273-07b4d8758e81';
  const input = {
    clientRequestId,
    leadId,
    shopName: 'Not trusted if lead selected',
    transcript: 'haircut 150 rupees, beard 80 rupees',
    consentConfirmed: true as const,
    language: 'hi-IN' as const,
    contactName: 'Shop owner',
    services: [{ name: 'Haircut', priceInr: 150 }, { name: 'Beard trim', priceInr: 80 }],
  };
  const row = {
    id: 'saved-log-1',
    employeeProfileId,
    leadId,
    clientRequestId,
    shopName: 'Canonical Shop',
    transcript: input.transcript,
    language: 'hi-IN',
    consentConfirmed: true,
    contactName: 'Shop owner',
    phone: null,
    city: null,
    locality: null,
    addressLine: null,
    latitude: null,
    longitude: null,
    chairCount: null,
    staffCount: null,
    services: input.services,
    notes: null,
    createdAt: new Date('2026-10-13T00:00:00Z'),
  };
  let prisma: any;
  let service: EmployeeVoiceLogsService;
  beforeEach(() => {
    const tx = {
      employeeOnboardingVoiceLog: { create: jest.fn().mockResolvedValue(row) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      employeeProfile: { findUnique: jest.fn().mockResolvedValue({ id: employeeProfileId }) },
      employeeCrmLead: {
        findFirst: jest.fn().mockResolvedValue({ id: leadId, shopName: row.shopName }),
      },
      employeeOnboardingVoiceLog: {
        findMany: jest.fn().mockResolvedValue([row]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      tx,
    };
    service = new EmployeeVoiceLogsService(prisma);
  });

  it('requires affirmative consent, rejects fabricated prices and excessive transcripts', () => {
    expect(createEmployeeVoiceLogSchema.safeParse({ ...input, consentConfirmed: false }).success).toBe(false);
    expect(createEmployeeVoiceLogSchema.safeParse({ ...input, transcript: 'x'.repeat(12001) }).success).toBe(false);
    expect(createEmployeeVoiceLogSchema.safeParse({ ...input, services: [{ name: 'Haircut', priceInr: -50 }] }).success).toBe(false);
    expect(createEmployeeVoiceLogSchema.safeParse({ ...input, latitude: 20 }).success).toBe(false);
    expect(createEmployeeVoiceLogSchema.safeParse({ ...input, unknown: 'secret' }).success).toBe(false);
    expect(createEmployeeVoiceLogSchema.safeParse(input).success).toBe(true);
  });

  it('lists only the caller profile records, not any other field executive', async () => {
    const result = await service.list(userId);
    expect(prisma.employeeOnboardingVoiceLog.findMany).toHaveBeenCalledWith({
      where: { employeeProfileId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    expect(result[0].shopName).toBe('Canonical Shop');
    expect(result[0].services).toEqual(input.services);
  });

  it('binds linked log to an employee-owned canonical lead and audits without contact/transcript', async () => {
    const result = await service.create(userId, input);
    expect(result.shopName).toBe('Canonical Shop');
    expect(prisma.employeeCrmLead.findFirst).toHaveBeenCalledWith({
      where: { id: leadId, employeeProfileId },
      select: { id: true, shopName: true },
    });
    expect(prisma.tx.employeeOnboardingVoiceLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ employeeProfileId, leadId, shopName: 'Canonical Shop', consentConfirmed: true }),
    });
    const audit = prisma.tx.auditLog.create.mock.calls[0][0].data;
    expect(JSON.stringify(audit.metadata)).not.toContain('150');
    expect(JSON.stringify(audit.metadata)).not.toContain('Shop owner');
    expect(JSON.stringify(audit.metadata)).not.toContain('haircut');
  });

  it('rejects a lead owned by another executive before writing', async () => {
    prisma.employeeCrmLead.findFirst.mockResolvedValue(null);
    await expect(service.create(userId, input)).rejects.toMatchObject({ code: 'LEAD_NOT_FOUND' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('retries the same saved request idempotently, without creating a second record', async () => {
    prisma.employeeOnboardingVoiceLog.findUnique.mockResolvedValue(row);
    const result = await service.create(userId, input);
    expect(result.id).toBe(row.id);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects employee accounts missing an employee profile', async () => {
    prisma.employeeProfile.findUnique.mockResolvedValue(null);
    await expect(service.list(userId)).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });
});
