import { Test } from '@nestjs/testing';
import { CancellationPolicyService } from './cancellation-policy.service';
import { PrismaService } from '../prisma/prisma.service';

function decimal(value: string) {
  return { toString: () => value } as unknown as number;
}

interface PrismaMock {
  cancellationPolicy: {
    findUnique: jest.Mock<Promise<unknown>, [unknown]>;
    findFirst: jest.Mock<Promise<unknown>, [unknown]>;
  };
}

describe('CancellationPolicyService', () => {
  let service: CancellationPolicyService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      cancellationPolicy: {
        findUnique: jest.fn<Promise<unknown>, [unknown]>(),
        findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CancellationPolicyService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(CancellationPolicyService);
  });

  it('returns the salon-specific policy when one is configured', async () => {
    prisma.cancellationPolicy.findUnique.mockResolvedValue({
      freeCancellationWindowMinutes: 120,
      lateCancellationChargeType: 'FLAT',
      lateCancellationChargeValue: decimal('50'),
      noShowChargeType: 'FLAT',
      noShowChargeValue: decimal('100'),
      appointmentArrivalGraceMinutes: 15,
      queueCallResponseGraceMinutes: 5,
    });
    const policy = await service.getEffectivePolicy('s1');
    expect(policy.freeCancellationWindowMinutes).toBe(120);
    expect(policy.effectiveFreeCancellationWindowMinutes).toBe(120);
    expect(prisma.cancellationPolicy.findFirst).not.toHaveBeenCalled();
  });

  it('floors effectiveFreeCancellationWindowMinutes at the 60-minute platform minimum when the salon configured less', async () => {
    prisma.cancellationPolicy.findUnique.mockResolvedValue({
      freeCancellationWindowMinutes: 30,
      lateCancellationChargeType: 'FLAT',
      lateCancellationChargeValue: decimal('50'),
      noShowChargeType: 'FLAT',
      noShowChargeValue: decimal('100'),
      appointmentArrivalGraceMinutes: 15,
      queueCallResponseGraceMinutes: 5,
    });
    const policy = await service.getEffectivePolicy('s1');
    expect(policy.freeCancellationWindowMinutes).toBe(30);
    expect(policy.effectiveFreeCancellationWindowMinutes).toBe(60);
  });

  it('falls back to the platform-default row (salonId: null) when the salon has none', async () => {
    prisma.cancellationPolicy.findUnique.mockResolvedValue(null);
    prisma.cancellationPolicy.findFirst.mockResolvedValue({
      freeCancellationWindowMinutes: 60,
      lateCancellationChargeType: 'PERCENTAGE',
      lateCancellationChargeValue: decimal('50'),
      noShowChargeType: 'PERCENTAGE',
      noShowChargeValue: decimal('100'),
      appointmentArrivalGraceMinutes: 10,
      queueCallResponseGraceMinutes: 3,
    });
    const policy = await service.getEffectivePolicy('s1');
    expect(policy.freeCancellationWindowMinutes).toBe(60);
    expect(prisma.cancellationPolicy.findFirst).toHaveBeenCalledWith({
      where: { salonId: null },
    });
  });

  it('throws CANCELLATION_POLICY_MISSING when neither a salon-specific nor a platform default row exists', async () => {
    prisma.cancellationPolicy.findUnique.mockResolvedValue(null);
    prisma.cancellationPolicy.findFirst.mockResolvedValue(null);
    await expect(service.getEffectivePolicy('s1')).rejects.toMatchObject({
      code: 'CANCELLATION_POLICY_MISSING',
    });
  });

  it('maps Decimal charge values to plain numbers', async () => {
    prisma.cancellationPolicy.findUnique.mockResolvedValue({
      freeCancellationWindowMinutes: 60,
      lateCancellationChargeType: 'PERCENTAGE',
      lateCancellationChargeValue: decimal('50'),
      noShowChargeType: 'PERCENTAGE',
      noShowChargeValue: decimal('100'),
      appointmentArrivalGraceMinutes: 10,
      queueCallResponseGraceMinutes: 3,
    });
    const policy = await service.getEffectivePolicy('s1');
    expect(policy.lateCancellationChargeValue).toBe(50);
    expect(policy.noShowChargeValue).toBe(100);
  });
});
