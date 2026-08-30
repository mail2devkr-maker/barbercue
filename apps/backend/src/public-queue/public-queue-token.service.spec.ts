import { PublicQueueTokenService } from './public-queue-token.service';

interface PrismaMock {
  salon: {
    findUnique: jest.Mock;
    updateMany: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
}

describe('PublicQueueTokenService', () => {
  let service: PublicQueueTokenService;
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = {
      salon: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };
    service = new PublicQueueTokenService(prisma as never);
  });

  describe('resolveToken', () => {
    it('returns the salon for a known token', async () => {
      const salon = { id: 's1', name: 'Fresh Cuts', publicQueueToken: 'abc123' };
      prisma.salon.findUnique.mockResolvedValue(salon);
      await expect(service.resolveToken('abc123')).resolves.toBe(salon);
      expect(prisma.salon.findUnique).toHaveBeenCalledWith({ where: { publicQueueToken: 'abc123' } });
    });

    it('returns null for an unknown token, without throwing', async () => {
      prisma.salon.findUnique.mockResolvedValue(null);
      await expect(service.resolveToken('does-not-exist')).resolves.toBeNull();
    });

    it('returns null for an empty token without querying the database', async () => {
      await expect(service.resolveToken('')).resolves.toBeNull();
      expect(prisma.salon.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getOrCreateToken', () => {
    it('throws SALON_NOT_FOUND for an unknown salon', async () => {
      prisma.salon.findUnique.mockResolvedValue(null);
      await expect(service.getOrCreateToken('missing')).rejects.toMatchObject({ code: 'SALON_NOT_FOUND' });
    });

    it('returns the existing token without generating a new one', async () => {
      prisma.salon.findUnique.mockResolvedValue({ publicQueueToken: 'existing-token' });
      await expect(service.getOrCreateToken('s1')).resolves.toBe('existing-token');
      expect(prisma.salon.updateMany).not.toHaveBeenCalled();
    });

    it('generates and persists a new cryptographically random token when none exists', async () => {
      prisma.salon.findUnique.mockResolvedValue({ publicQueueToken: null });
      prisma.salon.updateMany.mockResolvedValue({ count: 1 });

      const token = await service.getOrCreateToken('s1');

      expect(token).toMatch(/^[0-9a-f]{48}$/); // randomBytes(24).toString('hex')
      expect(prisma.salon.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', publicQueueToken: null },
        data: { publicQueueToken: token },
      });
    });

    it('generates a different token on each call (no fixed/predictable value)', async () => {
      prisma.salon.findUnique.mockResolvedValue({ publicQueueToken: null });
      prisma.salon.updateMany.mockResolvedValue({ count: 1 });

      const a = await service.getOrCreateToken('s1');
      const b = await service.getOrCreateToken('s1');

      expect(a).not.toBe(b);
    });

    it('re-reads and returns the winner\'s token when it loses the race to a concurrent generator', async () => {
      prisma.salon.findUnique.mockResolvedValue({ publicQueueToken: null });
      prisma.salon.updateMany.mockResolvedValue({ count: 0 }); // someone else already claimed it
      prisma.salon.findUniqueOrThrow.mockResolvedValue({ publicQueueToken: 'the-winners-token' });

      await expect(service.getOrCreateToken('s1')).resolves.toBe('the-winners-token');
    });
  });

  describe('buildPublicQueueUrl', () => {
    const ORIGINAL_ENV = { ...process.env };
    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    it('uses WEB_BASE_URL when set — never a hard-coded domain', () => {
      process.env.WEB_BASE_URL = 'https://barbercue.example.com';
      expect(service.buildPublicQueueUrl('tok123')).toBe('https://barbercue.example.com/q/tok123');
    });

    it('falls back to localhost only when WEB_BASE_URL is unset (dev default)', () => {
      delete process.env.WEB_BASE_URL;
      expect(service.buildPublicQueueUrl('tok123')).toBe('http://localhost:3001/q/tok123');
    });
  });

  describe('resolveQueueAvailability (Issue 9)', () => {
    const READY = {
      status: 'ACTIVE' as never,
      activeStaffCount: 1,
      activeChairCount: 1,
      activeServiceCount: 1,
    };

    it('is available for an ACTIVE salon with at least one active staff, chair, and service', () => {
      expect(service.resolveQueueAvailability(READY)).toEqual({
        queueAvailable: true,
        unavailableReason: null,
      });
    });

    it('reports NOT_YET_OPEN for a PENDING salon', () => {
      expect(
        service.resolveQueueAvailability({ ...READY, status: 'PENDING' as never }),
      ).toEqual({ queueAvailable: false, unavailableReason: 'NOT_YET_OPEN' });
    });

    it('reports PAUSED for a SUSPENDED salon', () => {
      expect(
        service.resolveQueueAvailability({ ...READY, status: 'SUSPENDED' as never }),
      ).toEqual({ queueAvailable: false, unavailableReason: 'PAUSED' });
    });

    it('reports NO_ACTIVE_STAFF for an ACTIVE salon with zero active staff', () => {
      expect(
        service.resolveQueueAvailability({ ...READY, activeStaffCount: 0 }),
      ).toEqual({ queueAvailable: false, unavailableReason: 'NO_ACTIVE_STAFF' });
    });

    it('reports NO_ACTIVE_CHAIRS for an ACTIVE salon with zero active chairs', () => {
      expect(
        service.resolveQueueAvailability({ ...READY, activeChairCount: 0 }),
      ).toEqual({ queueAvailable: false, unavailableReason: 'NO_ACTIVE_CHAIRS' });
    });

    it('reports NO_ACTIVE_SERVICES for an ACTIVE salon with zero active services', () => {
      expect(
        service.resolveQueueAvailability({ ...READY, activeServiceCount: 0 }),
      ).toEqual({ queueAvailable: false, unavailableReason: 'NO_ACTIVE_SERVICES' });
    });

    it('prioritizes status over staffing gaps, and staff over chairs over services, when several are true at once', () => {
      expect(
        service.resolveQueueAvailability({
          status: 'PENDING' as never,
          activeStaffCount: 0,
          activeChairCount: 0,
          activeServiceCount: 0,
        }).unavailableReason,
      ).toBe('NOT_YET_OPEN');
      expect(
        service.resolveQueueAvailability({
          status: 'ACTIVE' as never,
          activeStaffCount: 0,
          activeChairCount: 0,
          activeServiceCount: 0,
        }).unavailableReason,
      ).toBe('NO_ACTIVE_STAFF');
      expect(
        service.resolveQueueAvailability({
          status: 'ACTIVE' as never,
          activeStaffCount: 1,
          activeChairCount: 0,
          activeServiceCount: 0,
        }).unavailableReason,
      ).toBe('NO_ACTIVE_CHAIRS');
    });
  });
});
