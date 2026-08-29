import { createSalonPhotoSchema } from '@barbercue/shared';
import { SalonPhotosService } from './salon-photos.service';

describe('SalonPhotosService', () => {
  let service: SalonPhotosService;
  let prisma: {
    photo: {
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let salonAccess: { assertOwnerAccess: jest.Mock };
  let storage: {
    isConfigured: boolean;
    putPublicObject: jest.Mock;
    deleteObject: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      photo: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ url: 'https://cdn.test/existing.jpg' }]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({
          id: 'p1',
          url: 'https://cdn.test/a.jpg',
          altText: null,
          type: 'COVER',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      ),
    };
    salonAccess = { assertOwnerAccess: jest.fn().mockResolvedValue(undefined) };
    storage = {
      isConfigured: true,
      putPublicObject: jest
        .fn()
        .mockResolvedValue('https://cdn.test/uploaded.jpg'),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    service = new SalonPhotosService(
      prisma as never,
      salonAccess as never,
      storage as never,
    );
  });

  const input = {
    url: 'https://cdn.test/a.jpg',
    type: 'COVER' as never,
  };

  it('checks salon access before listing', async () => {
    await service.list('owner-1', 'salon-1');
    expect(salonAccess.assertOwnerAccess).toHaveBeenCalledWith(
      'owner-1',
      'salon-1',
    );
  });

  it('refuses to add a photo to another owner’s salon, writing nothing', async () => {
    salonAccess.assertOwnerAccess.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
    );
    await expect(
      service.create('intruder', 'someone-elses-salon', input),
    ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
    expect(prisma.photo.create).not.toHaveBeenCalled();
  });

  // Discovery cards and the profile hero both read "the" cover, so two would be ambiguous.
  it('demotes an existing cover to gallery when a new cover is added', async () => {
    await service.create('owner-1', 'salon-1', input);
    expect(prisma.photo.updateMany).toHaveBeenCalledWith({
      where: { salonId: 'salon-1', type: 'COVER' },
      data: { type: 'GALLERY' },
    });
  });

  it('does not touch existing photos when adding a gallery image', async () => {
    await service.create('owner-1', 'salon-1', {
      ...input,
      type: 'GALLERY' as never,
    });
    expect(prisma.photo.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a photo beyond the per-salon cap', async () => {
    prisma.photo.count.mockResolvedValue(12);
    await expect(
      service.create('owner-1', 'salon-1', input),
    ).rejects.toMatchObject({ code: 'PHOTO_LIMIT_REACHED' });
    expect(prisma.photo.create).not.toHaveBeenCalled();
  });

  // An id alone must never be enough — that would be a cross-tenant delete.
  it('scopes deletion by salonId as well as photo id', async () => {
    await service.remove('owner-1', 'salon-1', 'p1');
    expect(prisma.photo.deleteMany).toHaveBeenCalledWith({
      where: { id: 'p1', salonId: 'salon-1' },
    });
  });

  it('404s when the photo does not belong to this salon', async () => {
    // remove() looks the photo up (scoped by salonId) before deleting it — a photo belonging to
    // another salon simply isn't found, same as one that never existed.
    prisma.photo.findMany.mockResolvedValue([]);
    await expect(
      service.remove('owner-1', 'salon-1', 'other-salons-photo'),
    ).rejects.toMatchObject({ code: 'PHOTO_NOT_FOUND' });
    expect(prisma.photo.deleteMany).not.toHaveBeenCalled();
  });

  it('best-effort deletes the underlying storage object after removing the row', async () => {
    await service.remove('owner-1', 'salon-1', 'p1');
    expect(storage.deleteObject).toHaveBeenCalledWith(
      'https://cdn.test/existing.jpg',
    );
  });

  it('removal succeeds even when storage cleanup unexpectedly throws', async () => {
    storage.deleteObject.mockRejectedValue(new Error('disk unavailable'));
    await expect(
      service.remove('owner-1', 'salon-1', 'p1'),
    ).resolves.toBeUndefined();
    expect(prisma.photo.deleteMany).toHaveBeenCalled();
  });

  // The URL is stored and later rendered into an <img src>, so what we accept matters.
  describe('createSalonPhotoSchema', () => {
    const parse = (url: string) =>
      createSalonPhotoSchema.safeParse({ url, type: 'COVER' });

    it('accepts an https image URL', () => {
      expect(parse('https://cdn.test/shop.jpg').success).toBe(true);
    });

    it.each([
      ['http://cdn.test/a.jpg', 'plain http (mixed content on an https page)'],
      ['javascript:alert(1)', 'javascript scheme'],
      ['data:image/png;base64,AAAA', 'data scheme'],
      ['https://user:pass@cdn.test/a.jpg', 'embedded credentials'],
      ['not a url', 'not a URL at all'],
      ['', 'empty'],
    ])('rejects %p (%s)', (url) => {
      expect(parse(url).success).toBe(false);
    });

    it('rejects a URL beyond the length cap', () => {
      expect(parse(`https://cdn.test/${'a'.repeat(2100)}.jpg`).success).toBe(
        false,
      );
    });
  });

  // ---------- Device upload (multipart) ----------

  describe('createFromUpload', () => {
    // Real magic bytes, not a declared MIME type — the whole point of the check under test.
    const jpeg = () =>
      ({
        buffer: Buffer.concat([
          Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
          Buffer.alloc(64),
        ]),
        size: 68,
        mimetype: 'image/jpeg',
        originalname: 'shop.jpg',
      }) as never;

    const meta = { type: 'COVER' as never };

    it('stores the file and saves the returned URL as a normal photo row', async () => {
      await service.createFromUpload('owner-1', 'salon-1', jpeg(), meta);
      expect(storage.putPublicObject).toHaveBeenCalledTimes(1);
      const [key, , contentType] = storage.putPublicObject.mock.calls[0];
      // Keyed by salon, never by the client-supplied filename.
      expect(key).toMatch(/^salons\/salon-1\/photos\/[0-9a-f-]{36}\.jpg$/);
      expect(key).not.toContain('shop.jpg');
      // Content-Type is the sniffed value.
      expect(contentType).toBe('image/jpeg');
      expect(prisma.photo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            url: 'https://cdn.test/uploaded.jpg',
          }),
        }),
      );
    });

    it('rejects a non-image whatever its declared type and filename claim', async () => {
      const disguised = {
        // "MZ" — a Windows executable, uploaded as image/jpeg named .jpg.
        buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]),
        size: 66,
        mimetype: 'image/jpeg',
        originalname: 'innocent.jpg',
      } as never;
      await expect(
        service.createFromUpload('owner-1', 'salon-1', disguised, meta),
      ).rejects.toMatchObject({ code: 'PHOTO_UNSUPPORTED_TYPE' });
      expect(storage.putPublicObject).not.toHaveBeenCalled();
      expect(prisma.photo.create).not.toHaveBeenCalled();
    });

    it('requires a file', async () => {
      await expect(
        service.createFromUpload('owner-1', 'salon-1', undefined, meta),
      ).rejects.toMatchObject({ code: 'PHOTO_FILE_REQUIRED' });
      expect(storage.putPublicObject).not.toHaveBeenCalled();
    });

    it('rejects an oversized file before uploading it', async () => {
      const huge = {
        buffer: Buffer.concat([
          Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
          Buffer.alloc(64),
        ]),
        size: 50 * 1024 * 1024,
        mimetype: 'image/jpeg',
        originalname: 'huge.jpg',
      } as never;
      await expect(
        service.createFromUpload('owner-1', 'salon-1', huge, meta),
      ).rejects.toMatchObject({ code: 'PHOTO_TOO_LARGE' });
      expect(storage.putPublicObject).not.toHaveBeenCalled();
    });

    it('checks salon access before touching storage', async () => {
      salonAccess.assertOwnerAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.createFromUpload(
          'intruder',
          'someone-elses-salon',
          jpeg(),
          meta,
        ),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(storage.putPublicObject).not.toHaveBeenCalled();
    });

    // An upload that cannot be recorded must not leave a file nothing points at.
    it('never uploads when the salon is already at the photo limit', async () => {
      prisma.photo.count.mockResolvedValue(12);
      await expect(
        service.createFromUpload('owner-1', 'salon-1', jpeg(), meta),
      ).rejects.toMatchObject({ code: 'PHOTO_LIMIT_REACHED' });
      expect(storage.putPublicObject).not.toHaveBeenCalled();
    });

    it('demotes an existing cover when an uploaded photo becomes the cover', async () => {
      await service.createFromUpload('owner-1', 'salon-1', jpeg(), meta);
      expect(prisma.photo.updateMany).toHaveBeenCalledWith({
        where: { salonId: 'salon-1', type: 'COVER' },
        data: { type: 'GALLERY' },
      });
    });
  });
});
