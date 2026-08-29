import { Test } from '@nestjs/testing';
import { AdminVerificationService } from './admin-verification.service';
import { PrismaService } from '../prisma/prisma.service';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vr-1',
    subjectType: 'SHOP',
    status: 'SUBMITTED',
    evidenceNotes: 'GST certificate on file.',
    evidenceUrls: [],
    submittedAt: new Date('2026-06-01T10:00:00.000Z'),
    reviewNotes: null,
    reviewedAt: null,
    salonId: 'salon-1',
    salon: { name: 'BarberCue Demo Salon', ownerUserId: 'owner-1' },
    staffId: null,
    staff: null,
    submittedBy: { email: 'owner@example.com', phone: null },
    ...overrides,
  };
}

describe('AdminVerificationService', () => {
  let service: AdminVerificationService;
  let prisma: {
    verificationRequest: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    auditLog: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      verificationRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [AdminVerificationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AdminVerificationService);
  });

  describe('list', () => {
    it('maps rows to AdminVerificationRequestDto, including submitter contact and salon name', async () => {
      prisma.verificationRequest.findMany.mockResolvedValueOnce([makeRow()]);
      const result = await service.list(undefined, undefined, undefined);
      expect(result.items[0]).toEqual({
        id: 'vr-1',
        subjectType: 'SHOP',
        status: 'SUBMITTED',
        evidenceNotes: 'GST certificate on file.',
        evidenceUrls: [],
        submittedAt: '2026-06-01T10:00:00.000Z',
        reviewNotes: null,
        reviewedAt: null,
        salonId: 'salon-1',
        salonName: 'BarberCue Demo Salon',
        staffId: null,
        staffDisplayName: null,
        staffSalonName: null,
        submitterEmail: 'owner@example.com',
        submitterPhone: null,
      });
    });

    it('ignores an invalid status filter rather than erroring', async () => {
      await service.list('not-a-real-status', undefined, undefined);
      expect(prisma.verificationRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });

    it('applies a valid status filter', async () => {
      await service.list('APPROVED', undefined, undefined);
      expect(prisma.verificationRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'APPROVED' } }),
      );
    });
  });

  describe('startReview', () => {
    it('moves a SUBMITTED request to UNDER_REVIEW and logs an audit entry', async () => {
      prisma.verificationRequest.findUnique.mockResolvedValue(makeRow());
      prisma.verificationRequest.update.mockResolvedValue(makeRow({ status: 'UNDER_REVIEW' }));
      await service.startReview('admin-1', 'vr-1');
      expect(prisma.verificationRequest.update).toHaveBeenCalledWith({
        where: { id: 'vr-1' },
        data: { status: 'UNDER_REVIEW' },
        include: expect.any(Object),
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'VERIFICATION_REVIEW_STARTED', actorUserId: 'admin-1' }),
      });
    });

    it('rejects starting review on a request that is not SUBMITTED', async () => {
      prisma.verificationRequest.findUnique.mockResolvedValue(makeRow({ status: 'APPROVED' }));
      await expect(service.startReview('admin-1', 'vr-1')).rejects.toMatchObject({
        code: 'INVALID_VERIFICATION_TRANSITION',
      });
    });
  });

  describe('decide', () => {
    it('approves a SUBMITTED or UNDER_REVIEW request', async () => {
      prisma.verificationRequest.findUnique.mockResolvedValue(makeRow({ status: 'UNDER_REVIEW' }));
      prisma.verificationRequest.update.mockResolvedValue(makeRow({ status: 'APPROVED' }));
      await service.decide('admin-1', 'vr-1', 'APPROVED', undefined);
      expect(prisma.verificationRequest.update).toHaveBeenCalledWith({
        where: { id: 'vr-1' },
        data: {
          status: 'APPROVED',
          reviewedByAdminId: 'admin-1',
          reviewNotes: null,
          reviewedAt: expect.any(Date),
        },
        include: expect.any(Object),
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'VERIFICATION_APPROVED' }),
      });
    });

    it('rejects deciding a request that has already been decided', async () => {
      prisma.verificationRequest.findUnique.mockResolvedValue(makeRow({ status: 'REJECTED' }));
      await expect(service.decide('admin-1', 'vr-1', 'APPROVED', undefined)).rejects.toMatchObject({
        code: 'INVALID_VERIFICATION_TRANSITION',
      });
    });
  });
});
