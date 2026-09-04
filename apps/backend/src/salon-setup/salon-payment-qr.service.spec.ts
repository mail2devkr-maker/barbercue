import { SalonPaymentQrService } from './salon-payment-qr.service';

describe('SalonPaymentQrService', () => {
  let service: SalonPaymentQrService;
  let prisma: {
    salonPaymentPolicy: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
    };
  };
  let salonAccess: { assertOwnerAccess: jest.Mock };
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
    };
    salonAccess = { assertOwnerAccess: jest.fn().mockResolvedValue(undefined) };
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
      expect(salonAccess.assertOwnerAccess).toHaveBeenCalledWith(
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
      salonAccess.assertOwnerAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.setLink('intruder', 'someone-elses-salon', {
          url: 'https://cdn.test/qr.png',
        }),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.salonPaymentPolicy.upsert).not.toHaveBeenCalled();
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
  });
});
