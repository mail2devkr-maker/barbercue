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
  let tx: {
    verificationRequest: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };
  let prisma: {
    verificationRequest: typeof tx.verificationRequest;
    auditLog: typeof tx.auditLog;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    tx = {
      verificationRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      ...tx,
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminVerificationService,
        { provide: PrismaService, useValue: prisma },
      ],
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
    it('atomically claims a SUBMITTED request for this admin and logs the transition', async () => {
      prisma.verificationRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.verificationRequest.findUnique.mockResolvedValue(
        makeRow({ status: 'UNDER_REVIEW' }),
      );

      await service.startReview('admin-1', 'vr-1');

      expect(prisma.verificationRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'vr-1', status: 'SUBMITTED' },
        data: {
          status: 'UNDER_REVIEW',
          reviewedByAdminId: 'admin-1',
        },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'VERIFICATION_REVIEW_STARTED',
          actorUserId: 'admin-1',
        }),
      });
    });

    it('allows only one winner when two admins concurrently start review', async () => {
      prisma.verificationRequest.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      prisma.verificationRequest.findUnique.mockResolvedValue(
        makeRow({ status: 'UNDER_REVIEW' }),
      );

      await expect(
        service.startReview('admin-1', 'vr-1'),
      ).resolves.toMatchObject({ status: 'UNDER_REVIEW' });
      await expect(
        service.startReview('admin-2', 'vr-1'),
      ).rejects.toMatchObject({ code: 'INVALID_VERIFICATION_TRANSITION' });
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('rejects starting review on a request that is no longer SUBMITTED', async () => {
      prisma.verificationRequest.updateMany.mockResolvedValue({ count: 0 });
      prisma.verificationRequest.findUnique.mockResolvedValue(
        makeRow({ status: 'APPROVED' }),
      );

      await expect(
        service.startReview('admin-1', 'vr-1'),
      ).rejects.toMatchObject({
        code: 'INVALID_VERIFICATION_TRANSITION',
      });
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('distinguishes a missing request from a stale transition', async () => {
      prisma.verificationRequest.updateMany.mockResolvedValue({ count: 0 });
      prisma.verificationRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.startReview('admin-1', 'missing'),
      ).rejects.toMatchObject({
        code: 'VERIFICATION_NOT_FOUND',
      });
    });

    it('does not report a claimed review when the transactional audit write fails', async () => {
      prisma.verificationRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.auditLog.create.mockRejectedValue(new Error('audit unavailable'));

      await expect(service.startReview('admin-1', 'vr-1')).rejects.toThrow(
        'audit unavailable',
      );
    });
  });

  describe('decide', () => {
    it('allows only the admin who claimed UNDER_REVIEW to decide it', async () => {
      prisma.verificationRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.verificationRequest.findUnique.mockResolvedValue(
        makeRow({ status: 'APPROVED' }),
      );

      await service.decide('admin-1', 'vr-1', 'APPROVED', undefined);

      expect(prisma.verificationRequest.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'vr-1',
          status: 'UNDER_REVIEW',
          reviewedByAdminId: 'admin-1',
        },
        data: {
          status: 'APPROVED',
          reviewNotes: null,
          reviewedAt: expect.any(Date),
        },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'VERIFICATION_APPROVED' }),
      });
    });

    it('rejects a decision by a different admin without leaking or overwriting it', async () => {
      prisma.verificationRequest.updateMany.mockResolvedValue({ count: 0 });
      prisma.verificationRequest.findUnique.mockResolvedValue(
        makeRow({ status: 'UNDER_REVIEW', reviewedByAdminId: 'admin-1' }),
      );

      await expect(
        service.decide('admin-2', 'vr-1', 'APPROVED', undefined),
      ).rejects.toMatchObject({ code: 'INVALID_VERIFICATION_TRANSITION' });
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('allows only one winner for concurrent review decisions', async () => {
      prisma.verificationRequest.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      prisma.verificationRequest.findUnique.mockResolvedValue(
        makeRow({ status: 'APPROVED' }),
      );

      await expect(
        service.decide('admin-1', 'vr-1', 'APPROVED', 'Looks valid.'),
      ).resolves.toMatchObject({ status: 'APPROVED' });
      await expect(
        service.decide('admin-1', 'vr-1', 'REJECTED', 'Stale action.'),
      ).rejects.toMatchObject({ code: 'INVALID_VERIFICATION_TRANSITION' });
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a stale decision after the request state changed or was resubmitted', async () => {
      prisma.verificationRequest.updateMany.mockResolvedValue({ count: 0 });
      prisma.verificationRequest.findUnique.mockResolvedValue(
        makeRow({ status: 'REJECTED' }),
      );

      await expect(
        service.decide('admin-1', 'vr-1', 'APPROVED', undefined),
      ).rejects.toMatchObject({
        code: 'INVALID_VERIFICATION_TRANSITION',
      });
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('does not report a decision when the transactional audit write fails', async () => {
      prisma.verificationRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.auditLog.create.mockRejectedValue(new Error('audit unavailable'));

      await expect(
        service.decide('admin-1', 'vr-1', 'APPROVED', undefined),
      ).rejects.toThrow('audit unavailable');
    });
  });
});
