import { Test } from '@nestjs/testing';
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
  let prisma: {
    salon: { findUnique: jest.Mock };
    salonStaff: { findFirst: jest.Mock };
    verificationRequest: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    auditLog: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      salon: { findUnique: jest.fn() },
      salonStaff: { findFirst: jest.fn() },
      verificationRequest: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [VerificationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(VerificationService);
  });

  describe('submitForSalon', () => {
    it('rejects a salon that does not belong to the caller as not-found', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon({ ownerUserId: 'someone-else' }));
      await expect(
        service.submitForSalon('owner-1', 'salon-1', { evidenceNotes: 'notes' }),
      ).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
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
        data: expect.objectContaining({ action: 'VERIFICATION_SUBMITTED', entityId: 'vr-1' }),
      });
      expect(result.status).toBe('SUBMITTED');
    });

    it('rejects submitting again while a request is SUBMITTED or UNDER_REVIEW', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.verificationRequest.findUnique.mockResolvedValue(makeRow({ status: 'UNDER_REVIEW' }));
      await expect(
        service.submitForSalon('owner-1', 'salon-1', { evidenceNotes: 'notes' }),
      ).rejects.toMatchObject({ code: 'VERIFICATION_ALREADY_PENDING' });
      expect(prisma.verificationRequest.update).not.toHaveBeenCalled();
    });

    it('rejects submitting again once already APPROVED', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.verificationRequest.findUnique.mockResolvedValue(makeRow({ status: 'APPROVED' }));
      await expect(
        service.submitForSalon('owner-1', 'salon-1', { evidenceNotes: 'notes' }),
      ).rejects.toMatchObject({ code: 'VERIFICATION_ALREADY_APPROVED' });
    });

    it('allows resubmission after REJECTED, resetting status and clearing the prior review', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.verificationRequest.findUnique.mockResolvedValue(
        makeRow({ status: 'REJECTED', reviewNotes: 'Blurry photo' }),
      );
      prisma.verificationRequest.update.mockResolvedValue(makeRow({ status: 'SUBMITTED' }));
      await service.submitForSalon('owner-1', 'salon-1', { evidenceNotes: 'Clearer evidence.' });
      expect(prisma.verificationRequest.update).toHaveBeenCalledWith({
        where: { id: 'vr-1' },
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
  });

  describe('submitForStaff', () => {
    it('rejects a staff member that does not belong to this salon', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.salonStaff.findFirst.mockResolvedValue(null);
      await expect(
        service.submitForStaff('owner-1', 'salon-1', 'staff-1', { evidenceNotes: 'notes' }),
      ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
    });

    it('creates a PROFESSIONAL-type request scoped to the staff id', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.salonStaff.findFirst.mockResolvedValue(makeStaff());
      prisma.verificationRequest.findUnique.mockResolvedValue(null);
      prisma.verificationRequest.create.mockResolvedValue(makeRow({ subjectType: 'PROFESSIONAL' }));
      await service.submitForStaff('owner-1', 'salon-1', 'staff-1', { evidenceNotes: 'License photo.' });
      expect(prisma.verificationRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subjectType: 'PROFESSIONAL',
          salonId: null,
          staffId: 'staff-1',
        }),
      });
    });
  });

  describe('getForSalon', () => {
    it('returns null when no request has ever been submitted', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon());
      prisma.verificationRequest.findUnique.mockResolvedValue(null);
      expect(await service.getForSalon('owner-1', 'salon-1')).toBeNull();
    });

    it('rejects a caller who does not own this salon', async () => {
      prisma.salon.findUnique.mockResolvedValue(makeSalon({ ownerUserId: 'someone-else' }));
      await expect(service.getForSalon('owner-1', 'salon-1')).rejects.toMatchObject({
        code: 'SALON_NOT_FOUND',
      });
    });
  });
});
