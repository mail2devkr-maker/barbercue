import { SalonPaymentQrService } from './salon-payment-qr.service';

describe('SalonPaymentQrService', () => {
  let service: SalonPaymentQrService;
  let prisma: {
    salonPaymentPolicy: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };
  let salonAccess: { assertOwnerOrAdminAccess: jest.Mock };
  let storage: { putPublicObject: jest.Mock; deleteObject: jest.Mock };

  beforeEach(() => {
    prisma = {
      salonPaymentPolicy: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            paymentQrImageUrl:
              args.create?.paymentQrImageUrl ?? args.update?.paymentQrImageUrl,
          }),
        ),
        update: jest.fn().mockResolvedValue({ paymentQrImageUrl: null }),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    salonAccess = { assertOwnerOrAdminAccess: jest.fn().mockResolvedValue('OWNER') };
    storage = {
      putPublicObject: jest.fn().mockResolvedValue('https://cdn.test/qr.jpg'),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    service = new SalonPaymentQrService(
      prisma as never,
      salonAccess as never,
      storage as never,
    );
  });

  const jpeg = () =>
    ({
      buffer: Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.alloc(64),
      ]),
      size: 68,
      mimetype: 'image/jpeg',
      originalname: 'qr.jpg',
    }) as never;

  describe('get', () => {
    it('checks salon access before reading', async () => {
      await service.get('owner-1', 'salon-1');
      expect(salonAccess.assertOwnerOrAdminAccess).toHaveBeenCalledWith(
        'owner-1',
        'salon-1',
      );
    });

    it('returns null when no payment policy row exists yet', async () => {
      await expect(service.get('owner-1', 'salon-1')).resolves.toEqual({
        salonId: 'salon-1',
        paymentQrImageUrl: null,
      });
    });

    it('returns the configured QR url when one exists', async () => {
      prisma.salonPaymentPolicy.findUnique.mockResolvedValue({
        paymentQrImageUrl: 'https://cdn.test/existing-qr.png',
      });
      await expect(service.get('owner-1', 'salon-1')).resolves.toEqual({
        salonId: 'salon-1',
        paymentQrImageUrl: 'https://cdn.test/existing-qr.png',
      });
    });
  });

  describe('setLink', () => {
    it('upserts a payment policy row with the linked URL', async () => {
      const result = await service.setLink('owner-1', 'salon-1', {
        url: 'https://cdn.test/qr.png',
      });
      expect(prisma.salonPaymentPolicy.upsert).toHaveBeenCalledWith({
        where: { salonId: 'salon-1' },
        create: { salonId: 'salon-1', paymentQrImageUrl: 'https://cdn.test/qr.png' },
        update: { paymentQrImageUrl: 'https://cdn.test/qr.png' },
        select: { paymentQrImageUrl: true },
      });
      expect(result.paymentQrImageUrl).toBe('https://cdn.test/qr.png');
    });

    it('refuses to set a QR for another owner’s salon', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.setLink('intruder', 'someone-elses-salon', {
          url: 'https://cdn.test/qr.png',
        }),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.salonPaymentPolicy.upsert).not.toHaveBeenCalled();
    });

    it('an owner update never writes an AuditLog row', async () => {
      await service.setLink('owner-1', 'salon-1', { url: 'https://cdn.test/qr.png' });
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    // Part 2 — PLATFORM_ADMIN delegated shop management.
    it('PLATFORM_ADMIN managing an ACTIVE salon can link a QR and it is recorded under the real admin actor', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockResolvedValue('PLATFORM_ADMIN');
      const result = await service.setLink('admin-1', 'salon-1', {
        url: 'https://cdn.test/qr.png',
      });
      expect(result.paymentQrImageUrl).toBe('https://cdn.test/qr.png');
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'ADMIN_PAYMENT_QR_UPDATED',
          entityType: 'Salon',
          entityId: 'salon-1',
          metadata: expect.objectContaining({ via: 'link', after: 'https://cdn.test/qr.png' }),
        }),
      });
    });
  });

  describe('setFromUpload', () => {
    it('stores the file and upserts the returned URL', async () => {
      await service.setFromUpload('owner-1', 'salon-1', jpeg());
      expect(storage.putPublicObject).toHaveBeenCalledTimes(1);
      const [key, , contentType] = storage.putPublicObject.mock.calls[0];
      expect(key).toMatch(/^salons\/salon-1\/payment-qr\/[0-9a-f-]{36}\.jpg$/);
      expect(contentType).toBe('image/jpeg');
      expect(prisma.salonPaymentPolicy.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { salonId: 'salon-1', paymentQrImageUrl: 'https://cdn.test/qr.jpg' },
        }),
      );
    });

    it('rejects a non-image whatever it claims to be', async () => {
      const disguised = {
        buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]),
        size: 66,
        mimetype: 'image/jpeg',
        originalname: 'innocent.jpg',
      } as never;
      await expect(
        service.setFromUpload('owner-1', 'salon-1', disguised),
      ).rejects.toMatchObject({ code: 'PAYMENT_QR_UNSUPPORTED_TYPE' });
      expect(storage.putPublicObject).not.toHaveBeenCalled();
    });

    it('requires a file', async () => {
      await expect(
        service.setFromUpload('owner-1', 'salon-1', undefined),
      ).rejects.toMatchObject({ code: 'PAYMENT_QR_FILE_REQUIRED' });
    });

    // Part 2 — PLATFORM_ADMIN delegated shop management. Confirms the upload path never leaks
    // file bytes/EXIF into the audit trail — only the resulting public URL.
    it('PLATFORM_ADMIN uploading a QR image is recorded under the real admin actor, with no file content in metadata', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockResolvedValue('PLATFORM_ADMIN');
      await service.setFromUpload('admin-1', 'salon-1', jpeg());
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'ADMIN_PAYMENT_QR_UPDATED',
          metadata: { via: 'upload', before: null, after: 'https://cdn.test/qr.jpg' },
        }),
      });
    });
  });

  describe('remove', () => {
    it('does nothing when no QR is configured', async () => {
      await service.remove('owner-1', 'salon-1');
      expect(prisma.salonPaymentPolicy.update).not.toHaveBeenCalled();
    });

    it('clears the column and best-effort deletes the stored object', async () => {
      prisma.salonPaymentPolicy.findUnique.mockResolvedValue({
        paymentQrImageUrl: 'https://cdn.test/qr.png',
      });
      await service.remove('owner-1', 'salon-1');
      expect(prisma.salonPaymentPolicy.update).toHaveBeenCalledWith({
        where: { salonId: 'salon-1' },
        data: { paymentQrImageUrl: null },
      });
      expect(storage.deleteObject).toHaveBeenCalledWith(
        'https://cdn.test/qr.png',
      );
    });

    it('still succeeds even if the best-effort storage delete throws', async () => {
      prisma.salonPaymentPolicy.findUnique.mockResolvedValue({
        paymentQrImageUrl: 'https://cdn.test/qr.png',
      });
      storage.deleteObject.mockRejectedValue(new Error('boom'));
      await expect(
        service.remove('owner-1', 'salon-1'),
      ).resolves.toBeUndefined();
    });

    it('an owner remove never writes an AuditLog row', async () => {
      prisma.salonPaymentPolicy.findUnique.mockResolvedValue({
        paymentQrImageUrl: 'https://cdn.test/qr.png',
      });
      await service.remove('owner-1', 'salon-1');
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    // Part 2 — PLATFORM_ADMIN delegated shop management.
    it('PLATFORM_ADMIN removing a QR is recorded under the real admin actor', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockResolvedValue('PLATFORM_ADMIN');
      prisma.salonPaymentPolicy.findUnique.mockResolvedValue({
        paymentQrImageUrl: 'https://cdn.test/qr.png',
      });
      await service.remove('admin-1', 'salon-1');
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'admin-1',
          action: 'ADMIN_PAYMENT_QR_UPDATED',
          metadata: { via: 'remove', before: 'https://cdn.test/qr.png', after: null },
        }),
      });
    });

    it('a normal CUSTOMER is denied and no mutation or audit write happens', async () => {
      salonAccess.assertOwnerOrAdminAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(service.remove('customer-1', 'salon-1')).rejects.toMatchObject({
        code: 'SALON_ACCESS_DENIED',
      });
      expect(prisma.salonPaymentPolicy.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });
});
