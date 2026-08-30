import { createHash } from 'crypto';
import { SalonStaffService } from './salon-staff.service';

const STAFF_ROW = {
  id: 'staff-1',
  displayName: 'Marcus',
  roleInSalon: 'BARBER',
  status: 'ACTIVE',
  bio: null,
  photoUrl: null,
  yearsExperience: null,
  user: {
    id: 'user-1',
    phone: '+919876543210',
    email: null,
    passwordHash: null,
  },
};

describe('SalonStaffService', () => {
  let service: SalonStaffService;
  let prisma: {
    user: { findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
    userRole: { upsert: jest.Mock };
    salonStaff: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    passwordResetToken: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let salonAccess: { assertOwnerAccess: jest.Mock };
  let emailSender: {
    assertAvailable: jest.Mock;
    sendPasswordReset: jest.Mock;
    sendStaffInvitation: jest.Mock;
  };
  const originalEnv = { ...process.env };

  beforeEach(() => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'user-1', ...data }),
          ),
        update: jest.fn().mockImplementation(({ where, data }) =>
          Promise.resolve({
            id: where.id,
            phone: null,
            email: null,
            status: 'ACTIVE',
            ...data,
          }),
        ),
      },
      userRole: { upsert: jest.fn().mockResolvedValue({}) },
      salonStaff: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(where.userId ? null : STAFF_ROW),
          ),
        create: jest.fn().mockResolvedValue({ id: 'staff-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      passwordResetToken: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      ),
    };
    salonAccess = { assertOwnerAccess: jest.fn().mockResolvedValue(undefined) };
    emailSender = {
      assertAvailable: jest.fn(),
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
      sendStaffInvitation: jest.fn().mockResolvedValue(undefined),
    };
    process.env.NODE_ENV = 'test';
    process.env.WEB_BASE_URL = 'https://web.example.com';
    service = new SalonStaffService(
      prisma as never,
      salonAccess as never,
      emailSender as never,
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('checks salon access before creating anything', async () => {
    salonAccess.assertOwnerAccess.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'SALON_ACCESS_DENIED' }),
    );
    await expect(
      service.create('intruder', 'salon-1', {
        displayName: 'X',
        phone: '+919999999999',
      }),
    ).rejects.toMatchObject({ code: 'SALON_ACCESS_DENIED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates a usable barber with required phone and no email invitation', async () => {
    const result = await service.create('owner-1', 'salon-1', {
      displayName: 'Marcus',
      phone: '+919876543210',
    });

    expect(salonAccess.assertOwnerAccess).toHaveBeenCalledWith(
      'owner-1',
      'salon-1',
    );
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { phone: '+919876543210', status: 'ACTIVE' },
    });
    expect(prisma.userRole.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { userId: 'user-1', role: 'SALON_STAFF', salonId: 'salon-1' },
      }),
    );
    expect(prisma.salonStaff.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        salonId: 'salon-1',
        userId: 'user-1',
        displayName: 'Marcus',
        roleInSalon: 'BARBER',
        status: 'ACTIVE',
      }),
    });
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(emailSender.sendStaffInvitation).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      invitationSent: false,
      staff: { phone: '+919876543210' },
    });
    expect(result.inviteUrl).toBeUndefined();
  });

  it('preserves the invitation flow when an email is provided', async () => {
    const result = await service.create('owner-1', 'salon-1', {
      displayName: 'Marcus',
      phone: '+919876543210',
      email: ' Marcus@Example.COM ',
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ phone: '+919876543210' }, { email: 'marcus@example.com' }],
      },
    });
    const rawToken = new URL(result.inviteUrl!).searchParams.get('token')!;
    const stored = prisma.passwordResetToken.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toBe(
      createHash('sha256').update(rawToken).digest('hex'),
    );
    expect(emailSender.sendStaffInvitation).toHaveBeenCalledWith(
      'marcus@example.com',
      result.inviteUrl,
      7,
    );
    expect(result.invitationSent).toBe(true);
  });

  it('does not create a passwordless staff account when invitation delivery is unavailable', async () => {
    emailSender.assertAvailable.mockImplementation(() => {
      throw new Error('transport unavailable');
    });
    await expect(
      service.create('owner-1', 'salon-1', {
        displayName: 'Marcus',
        phone: '+919876543210',
        email: 'marcus@example.com',
      }),
    ).rejects.toThrow('transport unavailable');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('links an existing user by phone and fills an empty email', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'existing', phone: '+919876543210', email: null, status: 'ACTIVE' },
    ]);
    prisma.user.update.mockResolvedValue({
      id: 'existing',
      phone: '+919876543210',
      email: 'm@example.com',
      status: 'ACTIVE',
    });
    await service.create('owner-1', 'salon-1', {
      displayName: 'M',
      phone: '+919876543210',
      email: 'm@example.com',
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'existing' },
      data: { email: 'm@example.com' },
    });
  });

  it('links an existing user by email and fills an empty phone', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'existing', phone: null, email: 'm@example.com', status: 'ACTIVE' },
    ]);
    prisma.user.update.mockResolvedValue({
      id: 'existing',
      phone: '+919876543210',
      email: 'm@example.com',
      status: 'ACTIVE',
    });
    await service.create('owner-1', 'salon-1', {
      displayName: 'M',
      phone: '+919876543210',
      email: 'm@example.com',
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'existing' },
      data: { phone: '+919876543210' },
    });
  });

  it('rejects phone and email that resolve to different users without merging', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'phone-user',
        phone: '+919876543210',
        email: null,
        status: 'ACTIVE',
      },
      {
        id: 'email-user',
        phone: null,
        email: 'm@example.com',
        status: 'ACTIVE',
      },
    ]);
    await expect(
      service.create('owner-1', 'salon-1', {
        displayName: 'M',
        phone: '+919876543210',
        email: 'm@example.com',
      }),
    ).rejects.toMatchObject({ code: 'STAFF_IDENTITY_CONFLICT' });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.salonStaff.create).not.toHaveBeenCalled();
  });

  it('rejects contact details that conflict with the matched account', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'existing',
        phone: '+919876543210',
        email: 'other@example.com',
        status: 'ACTIVE',
      },
    ]);
    await expect(
      service.create('owner-1', 'salon-1', {
        displayName: 'M',
        phone: '+919876543210',
        email: 'm@example.com',
      }),
    ).rejects.toMatchObject({ code: 'STAFF_IDENTITY_CONFLICT' });
  });

  it('rejects suspended accounts and existing roster memberships', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'existing',
        phone: '+919876543210',
        email: null,
        status: 'SUSPENDED',
      },
    ]);
    await expect(
      service.create('owner-1', 'salon-1', {
        displayName: 'M',
        phone: '+919876543210',
      }),
    ).rejects.toMatchObject({ code: 'STAFF_ACCOUNT_UNAVAILABLE' });

    prisma.user.findMany.mockResolvedValue([
      { id: 'existing', phone: '+919876543210', email: null, status: 'ACTIVE' },
    ]);
    prisma.user.update.mockResolvedValue({
      id: 'existing',
      phone: '+919876543210',
      email: null,
      status: 'ACTIVE',
    });
    prisma.salonStaff.findFirst.mockResolvedValue({ id: 'already-here' });
    await expect(
      service.create('owner-1', 'salon-1', {
        displayName: 'M',
        phone: '+919876543210',
      }),
    ).rejects.toMatchObject({ code: 'STAFF_ALREADY_EXISTS' });
  });

  it('keeps legacy email-only staff visible with a null phone', async () => {
    prisma.salonStaff.findMany.mockResolvedValue([
      {
        ...STAFF_ROW,
        user: {
          phone: null,
          email: 'legacy@example.com',
          passwordHash: 'hash',
        },
      },
    ]);
    const result = await service.list('owner-1', 'salon-1');
    expect(result[0]).toMatchObject({
      phone: null,
      email: 'legacy@example.com',
      hasPassword: true,
    });
    expect(JSON.stringify(result)).not.toContain('hash');
  });

  it('refuses resend when there is no email destination', async () => {
    prisma.salonStaff.findFirst.mockResolvedValue({
      ...STAFF_ROW,
      user: { id: 'user-1', email: null },
    });
    await expect(
      service.resendInvite('owner-1', 'salon-1', 'staff-1'),
    ).rejects.toMatchObject({ code: 'STAFF_ACCOUNT_UNAVAILABLE' });
    expect(emailSender.sendStaffInvitation).not.toHaveBeenCalled();
  });

  it('resends an invitation only to a real email destination', async () => {
    prisma.salonStaff.findFirst.mockResolvedValue({
      ...STAFF_ROW,
      user: { id: 'user-1', email: 'm@example.com' },
    });
    const result = await service.resendInvite('owner-1', 'salon-1', 'staff-1');
    expect(result.invitationSent).toBe(true);
    expect(emailSender.sendStaffInvitation).toHaveBeenCalledWith(
      'm@example.com',
      result.inviteUrl,
      7,
    );
  });

  it('deactivates a barber rather than deleting them', async () => {
    await service.update('owner-1', 'salon-1', 'staff-1', {
      status: 'INACTIVE' as never,
    });
    expect(prisma.salonStaff.update).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: { status: 'INACTIVE' },
    });
    expect(
      (service as unknown as Record<string, unknown>).delete,
    ).toBeUndefined();
  });

  describe('update — professional profile (Phase 17)', () => {
    it('sets bio/photoUrl/yearsExperience', async () => {
      await service.update('owner-1', 'salon-1', 'staff-1', {
        bio: 'Fades and tapers specialist.',
        photoUrl: 'https://example.com/marcus.jpg',
        yearsExperience: 8,
      } as never);
      expect(prisma.salonStaff.update).toHaveBeenCalledWith({
        where: { id: 'staff-1' },
        data: {
          bio: 'Fades and tapers specialist.',
          photoUrl: 'https://example.com/marcus.jpg',
          yearsExperience: 8,
        },
      });
    });

    it('treats an empty string as "clear this field", not "leave unchanged"', async () => {
      await service.update('owner-1', 'salon-1', 'staff-1', {
        bio: '',
        photoUrl: '',
      } as never);
      expect(prisma.salonStaff.update).toHaveBeenCalledWith({
        where: { id: 'staff-1' },
        data: { bio: null, photoUrl: null },
      });
    });

    it('omits untouched fields from the update entirely', async () => {
      await service.update('owner-1', 'salon-1', 'staff-1', {
        yearsExperience: 3,
      } as never);
      expect(prisma.salonStaff.update).toHaveBeenCalledWith({
        where: { id: 'staff-1' },
        data: { yearsExperience: 3 },
      });
    });
  });
});
