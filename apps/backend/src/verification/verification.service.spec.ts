import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { VerificationService } from './verification.service';
import { PrismaService } from '../prisma/prisma.service';

function makeSalon(overrides: Record<string, unknown> = {}) {
  return { id: 'salon-1', ownerUserId: 'owner-1', ...overrides };
}

function makeStaff(overrides: Record<string, unknown> = {}) {
  return { id: 'staff-1', salonId: 'salon-1', ...overrides };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vr-1',
    subjectType: 'SHOP',
    status: 'SUBMITTED',
    evidenceNotes: 'GST certificate on file at the shop.',
    evidenceUrls: ['https://example.com/shop.jpg'],
    submittedAt: new Date('2026-06-01T10:00:00.000Z'),
    reviewNotes: null,
    reviewedAt: null,
    ...overrides,
  };
}

describe('VerificationService', () => {
  let service: VerificationService;
  let tx: {
    verificationRequest: {
      findUnique: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };
  let prisma: {
    salon: { findUnique: jest.Mock };
    salonStaff: { findFirst: jest.Mock };
    userRole: { findFirst: jest.Mock };
    verificationRequest: typeof tx.verificationRequest;
    auditLog: typeof tx.auditLog;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    tx = {
      verificationRequest: {
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      salon: { findUnique: jest.fn() },
      salonStaff: { findFirst: jest.fn() },
      userRole: { findFirst: jest.fn().mockResolvedValue(null) },
      ...tx,
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(VerificationService);
  });

  describe('submitForSalon', () => {
    it('rejects a salon that does not belong to the caller as not-found', async () => {
      prisma.salon.findUnique.mockResolvedValue(
        makeSalon({ ownerUserId: 'someone-else' }),
      );
      await expect(
        service.submitForSalon('owner-1', 'salon-1', {
          evidenceNotes: 'notes',
        }),
      ).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
    });

    // Part 2 — delegated shop management is deliberately NOT extended to submission: seeking
    // verification is the owner's own business decision/attestation, never something an admin
    // submits as if they were the owner (see this class's own doc comment). A genuine global
    // PLATFORM_ADMIN on an ACTIVE salon still gets the exact same SALON_NOT_FOUND a non-owner
    // always gets — submitForSalon has no admin branch to take at all.
    it('a global PLATFORM_ADMIN can never submit verification on the owner\'s behalf', async () => {
      prisma.salon.findUnique.mockResolvedValue(
        makeSalon({ ownerUserId: 'owner-1', status: 'ACTIVE' }),
      );
      prisma.userRole.findFirst.mockResolvedValue({ role: 'PLATFORM_ADMIN' });
      await expect(
        service.submitForSalon('admin-1', 'salon-1', { evidenceNotes: 'notes' }),
      ).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
      expect(tx.verificationRequest.create).not.toHaveBeenCalled();
    });

    it('creates a new SUBMITTED request and logs an audit entry when none exists', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.verificationRequest.findUnique.mockResolvedValue(null);
      prisma.verificationRequest.create.mockResolvedValue(makeRow());
      const result = await service.submitForSalon('owner-1', 'salon-1', {
        evidenceNotes: 'GST certificate on file at the shop.',
        evidenceUrls: ['https://example.com/shop.jpg'],
      });
      expect(prisma.verificationRequest.create).toHaveBeenCalledWith({
        data: {
          subjectType: 'SHOP',
          salonId: 'salon-1',
          staffId: null,
          status: 'SUBMITTED',
          evidenceNotes: 'GST certificate on file at the shop.',
          evidenceUrls: ['https://example.com/shop.jpg'],
          submittedByUserId: 'owner-1',
        },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'VERIFICATION_SUBMITTED',
          entityId: 'vr-1',
        }),
      });
      expect(result.status).toBe('SUBMITTED');
    });

    it('does not report success when the transactional audit write fails', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.verificationRequest.findUnique.mockResolvedValue(null);
      prisma.verificationRequest.create.mockResolvedValue(makeRow());
      prisma.auditLog.create.mockRejectedValue(new Error('audit unavailable'));

      await expect(
        service.submitForSalon('owner-1', 'salon-1', {
          evidenceNotes: 'notes',
        }),
      ).rejects.toThrow('audit unavailable');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects submitting again while a request is SUBMITTED or UNDER_REVIEW', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.verificationRequest.findUnique.mockResolvedValue(
        makeRow({ status: 'UNDER_REVIEW' }),
      );
      await expect(
        service.submitForSalon('owner-1', 'salon-1', {
          evidenceNotes: 'notes',
        }),
      ).rejects.toMatchObject({ code: 'VERIFICATION_ALREADY_PENDING' });
      expect(prisma.verificationRequest.updateMany).not.toHaveBeenCalled();
    });

    it('rejects submitting again once already APPROVED', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.verificationRequest.findUnique.mockResolvedValue(
        makeRow({ status: 'APPROVED' }),
      );
      await expect(
        service.submitForSalon('owner-1', 'salon-1', {
          evidenceNotes: 'notes',
        }),
      ).rejects.toMatchObject({ code: 'VERIFICATION_ALREADY_APPROVED' });
    });

    it('allows resubmission after REJECTED, resetting status and clearing the prior review', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.verificationRequest.findUnique
        .mockResolvedValueOnce(
          makeRow({ status: 'REJECTED', reviewNotes: 'Blurry photo' }),
        )
        .mockResolvedValueOnce(makeRow({ status: 'SUBMITTED' }));
      prisma.verificationRequest.updateMany.mockResolvedValue({ count: 1 });
      await service.submitForSalon('owner-1', 'salon-1', {
        evidenceNotes: 'Clearer evidence.',
      });
      expect(prisma.verificationRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'vr-1', status: 'REJECTED' },
        data: {
          status: 'SUBMITTED',
          evidenceNotes: 'Clearer evidence.',
          evidenceUrls: [],
          submittedByUserId: 'owner-1',
          submittedAt: expect.any(Date),
          reviewedByAdminId: null,
          reviewNotes: null,
          reviewedAt: null,
        },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'VERIFICATION_RESUBMITTED' }),
      });
    });

    it('returns a conflict when a resubmission loses the state-transition race', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.verificationRequest.findUnique.mockResolvedValue(
        makeRow({ status: 'REJECTED' }),
      );
      prisma.verificationRequest.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.submitForSalon('owner-1', 'salon-1', {
          evidenceNotes: 'Clearer evidence.',
        }),
      ).rejects.toMatchObject({ code: 'VERIFICATION_ALREADY_PENDING' });
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('turns a concurrent unique-subject insert into a pending conflict', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.verificationRequest.findUnique.mockResolvedValue(null);
      prisma.verificationRequest.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.submitForSalon('owner-1', 'salon-1', {
          evidenceNotes: 'notes',
        }),
      ).rejects.toMatchObject({ code: 'VERIFICATION_ALREADY_PENDING' });
    });
  });

  describe('submitForStaff', () => {
    it('rejects a staff member that does not belong to this salon', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.salonStaff.findFirst.mockResolvedValue(null);
      await expect(
        service.submitForStaff('owner-1', 'salon-1', 'staff-1', {
          evidenceNotes: 'notes',
        }),
      ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
      expect(prisma.verificationRequest.findUnique).not.toHaveBeenCalled();
    });

    it('creates a PROFESSIONAL-type request scoped to the staff id', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.salonStaff.findFirst.mockResolvedValue(makeStaff());
      prisma.verificationRequest.findUnique.mockResolvedValue(null);
      prisma.verificationRequest.create.mockResolvedValue(
        makeRow({ subjectType: 'PROFESSIONAL' }),
      );
      await service.submitForStaff('owner-1', 'salon-1', 'staff-1', {
        evidenceNotes: 'License photo.',
      });
      expect(prisma.verificationRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subjectType: 'PROFESSIONAL',
          salonId: null,
          staffId: 'staff-1',
        }),
      });
    });

    it('returns a professional request only after proving the staff belongs to the owned salon', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.salonStaff.findFirst.mockResolvedValue(makeStaff());
      prisma.verificationRequest.findUnique.mockResolvedValue(
        makeRow({ subjectType: 'PROFESSIONAL' }),
      );

      const result = await service.getForStaff('owner-1', 'salon-1', 'staff-1');

      expect(prisma.salonStaff.findFirst).toHaveBeenCalledWith({
        where: { id: 'staff-1', salonId: 'salon-1' },
      });
      expect(prisma.verificationRequest.findUnique).toHaveBeenCalledWith({
        where: { staffId: 'staff-1' },
      });
      expect(result?.subjectType).toBe('PROFESSIONAL');
    });

    it('blocks cross-salon professional evidence reads before querying the request', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.salonStaff.findFirst.mockResolvedValue(null);

      await expect(
        service.getForStaff('owner-1', 'salon-1', 'staff-from-salon-2'),
      ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
      expect(prisma.verificationRequest.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getForSalon', () => {
    it('returns null when no request has ever been submitted', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.verificationRequest.findUnique.mockResolvedValue(null);
      expect(await service.getForSalon('owner-1', 'salon-1')).toBeNull();
    });

    it('rejects a caller who does not own this salon', async () => {
      prisma.salon.findUnique.mockResolvedValue(
        makeSalon({ ownerUserId: 'someone-else' }),
      );
      await expect(
        service.getForSalon('owner-1', 'salon-1'),
      ).rejects.toMatchObject({
        code: 'SALON_NOT_FOUND',
      });
      expect(prisma.verificationRequest.findUnique).not.toHaveBeenCalled();
    });

    // Part 2 — delegated shop management, read-only oversight only.
    it('a global PLATFORM_ADMIN on an ACTIVE salon can read verification status', async () => {
      prisma.salon.findUnique.mockResolvedValue(
        makeSalon({ ownerUserId: 'owner-1', status: 'ACTIVE' }),
      );
      prisma.userRole.findFirst.mockResolvedValue({ role: 'PLATFORM_ADMIN' });
      prisma.verificationRequest.findUnique.mockResolvedValue(makeRow());
      const result = await service.getForSalon('admin-1', 'salon-1');
      expect(result).not.toBeNull();
      expect(prisma.userRole.findFirst).toHaveBeenCalledWith({
        where: { userId: 'admin-1', role: 'PLATFORM_ADMIN', salonId: null },
      });
    });

    it('rejects a non-owner even if globally PLATFORM_ADMIN when the salon is not ACTIVE — same SALON_NOT_FOUND privacy contract as a real non-owner', async () => {
      prisma.salon.findUnique.mockResolvedValue(
        makeSalon({ ownerUserId: 'owner-1', status: 'PENDING' }),
      );
      await expect(
        service.getForSalon('admin-1', 'salon-1'),
      ).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
      expect(prisma.userRole.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a non-owner, non-admin caller on an ACTIVE salon the same as always', async () => {
      prisma.salon.findUnique.mockResolvedValue(
        makeSalon({ ownerUserId: 'owner-1', status: 'ACTIVE' }),
      );
      prisma.userRole.findFirst.mockResolvedValue(null);
      await expect(
        service.getForSalon('someone-else', 'salon-1'),
      ).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
    });
  });
});
