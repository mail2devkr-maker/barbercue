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
  let salonAccess: { assertAccess: jest.Mock };

  beforeEach(() => {
    prisma = {
      photo: {
        findMany: jest.fn().mockResolvedValue([]),
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
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    salonAccess = { assertAccess: jest.fn().mockResolvedValue(undefined) };
    service = new SalonPhotosService(prisma as never, salonAccess as never);
  });

  const input = {
    url: 'https://cdn.test/a.jpg',
    type: 'COVER' as never,
  };

  it('checks salon access before listing', async () => {
    await service.list('owner-1', 'salon-1');
    expect(salonAccess.assertAccess).toHaveBeenCalledWith('owner-1', 'salon-1');
  });

  it('refuses to add a photo to another owner’s salon, writing nothing', async () => {
    salonAccess.assertAccess.mockRejectedValue(
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
    prisma.photo.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      service.remove('owner-1', 'salon-1', 'other-salons-photo'),
    ).rejects.toMatchObject({ code: 'PHOTO_NOT_FOUND' });
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
});
