import { createHash } from 'crypto';
import { SalonStaffService } from './salon-staff.service';

const STAFF_ROW = {
  id: 'staff-1',
  displayName: 'Marcus',
  roleInSalon: 'BARBER',
  status: 'ACTIVE',
  user: { id: 'user-1', email: 'marcus@example.com', passwordHash: null },
};

describe('SalonStaffService', () => {
  let service: SalonStaffService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock };
    userRole: { upsert: jest.Mock };
    salonStaff: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    passwordResetToken: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let salonAccess: { assertAccess: jest.Mock };
  let emailSender: { sendPasswordReset: jest.Mock };
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      userRole: { upsert: jest.fn().mockResolvedValue({}) },
      salonStaff: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(STAFF_ROW),
        create: jest.fn().mockResolvedValue({ id: 'staff-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      passwordResetToken: { create: jest.fn().mockResolvedValue({}) },
      // Interactive-transaction mock: run the callback against `prisma` itself — same pattern as
      // bookings.service.spec.ts / queue.service.spec.ts.
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    salonAccess = { assertAccess: jest.fn().mockResolvedValue(undefined) };
    emailSender = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };
    process.env.NODE_ENV = 'test';
    process.env.WEB_BASE_URL = 'https://web.example.com';
    service = new SalonStaffService(prisma as never, salonAccess as never, emailSender as never);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('salon isolation / RBAC', () => {
    it('checks salon access before listing', async () => {
      await service.list('owner-1', 'salon-1');
      expect(salonAccess.assertAccess).toHaveBeenCalledWith('owner-1', 'salon-1');
    });

    it('refuses to onboard into a salon the caller does not own, creating nothing', async () => {
      salonAccess.assertAccess.mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
      );
      await expect(
        service.create('intruder', 'someone-elses-salon', { displayName: 'X', email: 'x@example.com' }),
      ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.salonStaff.create).not.toHaveBeenCalled();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('scopes update by BOTH id and salonId', async () => {
      prisma.salonStaff.findFirst.mockResolvedValue(null);
      await expect(
        service.update('owner-1', 'salon-1', 'staff-from-salon-2', { displayName: 'Hijack' }),
      ).rejects.toMatchObject({ code: 'STAFF_NOT_FOUND' });
      expect(prisma.salonStaff.update).not.toHaveBeenCalled();
    });
  });

  describe('create — new account', () => {
    it('creates User + SALON_STAFF UserRole + SalonStaff atomically in one transaction', async () => {
      await service.create('owner-1', 'salon-1', { displayName: 'Marcus', email: 'marcus@example.com' });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'marcus@example.com', status: 'ACTIVE' },
      });
      expect(prisma.userRole.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { userId: 'user-1', role: 'SALON_STAFF', salonId: 'salon-1' },
        }),
      );
      expect(prisma.salonStaff.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          salonId: 'salon-1', userId: 'user-1', displayName: 'Marcus',
          roleInSalon: 'BARBER', status: 'ACTIVE',
        }),
      });
    });

    it('never sets a password — the barber sets their own via the invitation', async () => {
      await service.create('owner-1', 'salon-1', { displayName: 'Marcus', email: 'marcus@example.com' });
      const createArg = prisma.user.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(createArg.data.passwordHash).toBeUndefined();
    });

    it('normalises the email to lowercase/trimmed', async () => {
      await service.create('owner-1', 'salon-1', { displayName: 'M', email: '  Marcus@Example.COM ' });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'marcus@example.com' } });
    });
  });

  describe('create — existing account is LINKED, never duplicated', () => {
    it('reuses an existing User and does not create a second one', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user', email: 'marcus@example.com', status: 'ACTIVE' });
      prisma.salonStaff.findFirst.mockResolvedValueOnce(null).mockResolvedValue(STAFF_ROW);

      await service.create('owner-1', 'salon-1', { displayName: 'Marcus', email: 'marcus@example.com' });

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.salonStaff.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'existing-user' }),
      });
    });

    it('rejects someone already on this salon\'s roster', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user', status: 'ACTIVE' });
      prisma.salonStaff.findFirst.mockResolvedValue({ id: 'already-here' });

      await expect(
        service.create('owner-1', 'salon-1', { displayName: 'Marcus', email: 'marcus@example.com' }),
      ).rejects.toMatchObject({ code: 'STAFF_ALREADY_EXISTS' });
      expect(prisma.salonStaff.create).not.toHaveBeenCalled();
    });

    it('rejects a suspended account rather than creating an unusable barber', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u', status: 'SUSPENDED' });
      await expect(
        service.create('owner-1', 'salon-1', { displayName: 'M', email: 'm@example.com' }),
      ).rejects.toMatchObject({ code: 'STAFF_ACCOUNT_UNAVAILABLE' });
      expect(prisma.salonStaff.create).not.toHaveBeenCalled();
    });
  });

  describe('invitation token', () => {
    it('stores only a SHA-256 hash, never the raw token', async () => {
      const result = await service.create('owner-1', 'salon-1', { displayName: 'M', email: 'm@example.com' });

      const rawToken = new URL(result.inviteUrl!).searchParams.get('token')!;
      const stored = (prisma.passwordResetToken.create.mock.calls[0][0] as { data: { tokenHash: string } }).data;
      expect(stored.tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'));
      expect(stored.tokenHash).not.toBe(rawToken);
    });

    it('issues a cryptographically random 64-hex-char token, different every time', async () => {
      const a = await service.create('owner-1', 'salon-1', { displayName: 'A', email: 'a@example.com' });
      const b = await service.create('owner-1', 'salon-1', { displayName: 'B', email: 'b@example.com' });
      const tokenA = new URL(a.inviteUrl!).searchParams.get('token')!;
      const tokenB = new URL(b.inviteUrl!).searchParams.get('token')!;
      expect(tokenA).toMatch(/^[0-9a-f]{64}$/);
      expect(tokenA).not.toBe(tokenB);
    });

    it('builds the link against WEB_BASE_URL and points at the existing reset-password page', async () => {
      const result = await service.create('owner-1', 'salon-1', { displayName: 'M', email: 'm@example.com' });
      expect(result.inviteUrl).toMatch(/^https:\/\/web\.example\.com\/reset-password\?token=[0-9a-f]{64}$/);
    });

    it('expires in the future (bounded lifetime)', async () => {
      await service.create('owner-1', 'salon-1', { displayName: 'M', email: 'm@example.com' });
      const { expiresAt } = (prisma.passwordResetToken.create.mock.calls[0][0] as { data: { expiresAt: Date } }).data;
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('sends the link through the existing EmailSender', async () => {
      const result = await service.create('owner-1', 'salon-1', { displayName: 'M', email: 'm@example.com' });
      expect(emailSender.sendPasswordReset).toHaveBeenCalledWith('m@example.com', result.inviteUrl);
    });

    it('NEVER returns inviteUrl over the API in production', async () => {
      process.env.NODE_ENV = 'production';
      const result = await service.create('owner-1', 'salon-1', { displayName: 'M', email: 'm@example.com' });
      expect(result.inviteUrl).toBeUndefined();
      // …but the email is still sent, so the barber can still be onboarded.
      expect(emailSender.sendPasswordReset).toHaveBeenCalled();
    });
  });

  describe('resendInvite', () => {
    it('issues a fresh token for an existing staff member', async () => {
      const result = await service.resendInvite('owner-1', 'salon-1', 'staff-1');
      expect(prisma.passwordResetToken.create).toHaveBeenCalled();
      expect(result.inviteUrl).toMatch(/token=[0-9a-f]{64}$/);
    });

    it('404s for a staff member outside this salon', async () => {
      prisma.salonStaff.findFirst.mockResolvedValue(null);
      await expect(service.resendInvite('owner-1', 'salon-1', 'other')).rejects.toMatchObject({
        code: 'STAFF_NOT_FOUND',
      });
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });
  });

  describe('DTO mapping', () => {
    it('exposes hasPassword (invite redeemed?) but never the hash itself', async () => {
      prisma.salonStaff.findMany.mockResolvedValue([
        { ...STAFF_ROW, user: { email: 'a@example.com', passwordHash: null } },
        { ...STAFF_ROW, id: 'staff-2', user: { email: 'b@example.com', passwordHash: 'bcrypt-hash' } },
      ]);
      const result = await service.list('owner-1', 'salon-1');
      expect(result[0].hasPassword).toBe(false);
      expect(result[1].hasPassword).toBe(true);
      expect(JSON.stringify(result)).not.toContain('bcrypt-hash');
    });
  });

  it('deactivates a barber rather than deleting them', async () => {
    await service.update('owner-1', 'salon-1', 'staff-1', { status: 'INACTIVE' as never });
    expect(prisma.salonStaff.update).toHaveBeenCalledWith({
      where: { id: 'staff-1' }, data: { status: 'INACTIVE' },
    });
    expect((service as unknown as Record<string, unknown>).delete).toBeUndefined();
  });
});
