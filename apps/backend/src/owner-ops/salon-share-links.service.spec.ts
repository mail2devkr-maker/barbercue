import { BookingErrorCode, SalonStatus } from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { SalonShareLinksService } from './salon-share-links.service';

describe('SalonShareLinksService', () => {
  const originalWebBaseUrl = process.env.WEB_BASE_URL;
  const assertOwnerOrAdminAccess = jest.fn();
  const findUnique = jest.fn();
  let service: SalonShareLinksService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WEB_BASE_URL = 'https://fastque.example';
    assertOwnerOrAdminAccess.mockResolvedValue('OWNER');
    findUnique.mockResolvedValue({
      id: 'salon-1',
      status: SalonStatus.ACTIVE,
      name: 'Example Salon',
      description: 'A public description',
      slug: 'example-salon',
      city: { slug: 'new-delhi', countryCode: 'IN' },
      photos: [
        { url: 'https://images.example/gallery.jpg', type: 'GALLERY' },
        { url: 'https://images.example/cover.jpg', type: 'COVER' },
      ],
    });
    service = new SalonShareLinksService(
      { salon: { findUnique } } as never,
      { assertOwnerOrAdminAccess } as never,
    );
  });

  afterAll(() => {
    if (originalWebBaseUrl === undefined) delete process.env.WEB_BASE_URL;
    else process.env.WEB_BASE_URL = originalWebBaseUrl;
  });

  it('returns the canonical public route and only share-safe profile metadata', async () => {
    const result = await service.getForSalon('owner-1', 'salon-1');
    expect(assertOwnerOrAdminAccess).toHaveBeenCalledWith('owner-1', 'salon-1');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'salon-1' } }),
    );
    expect(result).toEqual({
      salonId: 'salon-1',
      status: SalonStatus.ACTIVE,
      publicPath: '/in/new-delhi/example-salon',
      publicUrl: 'https://fastque.example/in/new-delhi/example-salon',
      readiness: { ready: true, reasons: [] },
      metadata: {
        title: 'Example Salon',
        description: 'A public description',
        imageUrl: 'https://images.example/cover.jpg',
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/phone|email|address/i);
  });

  it('does not advertise a non-active salon as publicly ready', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'salon-1',
      status: SalonStatus.SUSPENDED,
      name: 'Example Salon',
      description: 'A public description',
      slug: 'example-salon',
      city: { slug: 'new-delhi', countryCode: 'IN' },
      photos: [],
    });
    const result = await service.getForSalon('owner-1', 'salon-1');
    expect(result.publicPath).toBe('/in/new-delhi/example-salon');
    expect(result.publicUrl).toBe(
      'https://fastque.example/in/new-delhi/example-salon',
    );
    expect(result.readiness).toEqual({
      ready: false,
      reasons: ['SALON_NOT_PUBLIC'],
    });
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'not a url'],
    ['userinfo', 'https://user:secret@fastque.example'],
    ['path prefix', 'https://fastque.example/subpath'],
    ['non-loopback HTTP', 'http://fastque.example'],
  ])(
    'fails closed for invalid or missing WEB_BASE_URL (%s)',
    async (_label, webBaseUrl) => {
      if (webBaseUrl === undefined) delete process.env.WEB_BASE_URL;
      else process.env.WEB_BASE_URL = webBaseUrl;
      const result = await service.getForSalon('owner-1', 'salon-1');
      expect(result.publicUrl).toBeNull();
      expect(result.readiness).toEqual({
        ready: false,
        reasons: ['WEB_BASE_URL_NOT_CONFIGURED'],
      });
    },
  );

  it('allows an HTTP loopback origin only for local development', async () => {
    process.env.WEB_BASE_URL = 'http://127.0.0.1:3000/';
    const result = await service.getForSalon('owner-1', 'salon-1');
    expect(result.publicUrl).toBe(
      'http://127.0.0.1:3000/in/new-delhi/example-salon',
    );
  });

  it('returns not found for a missing salon after checking access', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(
      service.getForSalon('owner-1', 'missing'),
    ).rejects.toMatchObject({
      code: BookingErrorCode.SALON_NOT_FOUND,
    } satisfies Partial<AppException>);
  });

  it('propagates salon ownership denial without reading the salon', async () => {
    assertOwnerOrAdminAccess.mockRejectedValueOnce(new Error('denied'));
    await expect(service.getForSalon('outsider', 'salon-1')).rejects.toThrow(
      'denied',
    );
    expect(findUnique).not.toHaveBeenCalled();
  });
});
