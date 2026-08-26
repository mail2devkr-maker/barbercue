import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import {
  BookingErrorCode,
  Role,
  SalonSetupErrorCode,
  SalonStaffRole,
  StaffMemberStatus,
  UserStatus,
  type CreateSalonStaffInput,
  type SalonStaffDto,
  type StaffInviteResultDto,
  type UpdateSalonStaffInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { EMAIL_SENDER, type EmailSender } from '../auth/services/email-sender';

// Invitations are long-lived compared with a password reset (AuthService uses 15 minutes): an
// owner may add a barber before their next shift, and the barber may not check email for days.
// Still bounded so a leaked link cannot be redeemed indefinitely.
const INVITE_TTL_DAYS = 7;

// Must match AuthService's own reset-token hashing exactly — the invitation deliberately reuses
// the existing PasswordResetToken table and the existing POST /auth/reset-password endpoint, so
// the barber's "set your password" step is code that is already built and tested. Only the raw
// token is ever emailed; only its SHA-256 hash is stored.
function hashResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Owner-side barber roster: create (invite), list, update.
 *
 * Onboarding a barber touches three tables and must be atomic — a half-created barber (User with
 * no role, or SalonStaff with no login) is worse than none:
 *   User (login identity)  +  UserRole(SALON_STAFF, salonId)  +  SalonStaff (roster entry)
 *
 * Account handling follows the same find-or-link rule AuthService.googleLogin already uses: if
 * the email already belongs to a User, that User is linked rather than duplicated, so a person
 * who is already a customer can also become a barber on one account.
 */
@Injectable()
export class SalonStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
  ) {}

  async list(userId: string, salonId: string): Promise<SalonStaffDto[]> {
    await this.salonAccess.assertAccess(userId, salonId);
    const staff = await this.prisma.salonStaff.findMany({
      where: { salonId },
      orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
      include: { user: { select: { email: true, passwordHash: true } } },
    });
    return staff.map((s) => this.toDto(s));
  }

  /**
   * Creates (or links) the barber's account and issues an invitation link. Returns the link in
   * `inviteUrl` only outside production — identical dev-convenience rule to
   * AuthService.forgotPassword's `devResetUrl`, since no email provider is wired yet
   * (ConsoleEmailSender logs the link). In production the link is delivered by email only.
   */
  async create(
    userId: string,
    salonId: string,
    input: CreateSalonStaffInput,
  ): Promise<StaffInviteResultDto> {
    await this.salonAccess.assertAccess(userId, salonId);

    const email = input.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser && existingUser.status !== UserStatus.ACTIVE) {
      throw new AppException(
        SalonSetupErrorCode.STAFF_ACCOUNT_UNAVAILABLE,
        'That email belongs to a suspended account and cannot be added as staff.',
        HttpStatus.CONFLICT,
      );
    }

    if (existingUser) {
      const alreadyOnRoster = await this.prisma.salonStaff.findFirst({
        where: { salonId, userId: existingUser.id },
      });
      if (alreadyOnRoster) {
        throw new AppException(
          SalonSetupErrorCode.STAFF_ALREADY_EXISTS,
          "That person is already on this salon's staff.",
          HttpStatus.CONFLICT,
        );
      }
    }

    const rawToken = randomBytes(32).toString('hex');
    const staffId = await this.prisma.$transaction(async (tx) => {
      // Link the existing account when there is one, otherwise create a passwordless User — the
      // barber sets their own password by redeeming the invitation, so no temporary credential
      // is ever generated, transmitted, or seen by the owner.
      const user =
        existingUser ??
        (await tx.user.create({
          data: { email, status: UserStatus.ACTIVE },
        }));

      // upsert, not create: the person may already hold this role (e.g. re-added after being
      // removed from a different salon), and the composite unique is (userId, role, salonId).
      await tx.userRole.upsert({
        where: {
          userId_role_salonId: {
            userId: user.id,
            role: Role.SALON_STAFF,
            salonId,
          },
        },
        update: {},
        create: { userId: user.id, role: Role.SALON_STAFF, salonId },
      });

      const created = await tx.salonStaff.create({
        data: {
          salonId,
          userId: user.id,
          displayName: input.displayName,
          // MVP is BARBER-only: MANAGER exists in the schema but carries no distinct permissions
          // yet, so exposing it would imply an authorization difference that does not exist.
          roleInSalon: SalonStaffRole.BARBER,
          status: StaffMemberStatus.ACTIVE,
        },
      });

      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashResetToken(rawToken),
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60_000),
        },
      });

      return created.id;
    });

    const inviteUrl = this.buildInviteUrl(rawToken);
    await this.emailSender.sendPasswordReset(email, inviteUrl);

    const staff = await this.getDtoOrThrow(salonId, staffId);
    return process.env.NODE_ENV === 'production'
      ? { staff }
      : { staff, inviteUrl };
  }

  /** Re-issues an invitation link — for a barber who never redeemed the first one, or lost it. */
  async resendInvite(
    userId: string,
    salonId: string,
    staffId: string,
  ): Promise<StaffInviteResultDto> {
    await this.salonAccess.assertAccess(userId, salonId);
    const staff = await this.prisma.salonStaff.findFirst({
      where: { id: staffId, salonId },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!staff) {
      throw new AppException(
        BookingErrorCode.STAFF_NOT_FOUND,
        'Staff member not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (!staff.user.email) {
      throw new AppException(
        SalonSetupErrorCode.STAFF_ACCOUNT_UNAVAILABLE,
        'That staff member has no email address to send an invitation to.',
        HttpStatus.CONFLICT,
      );
    }

    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: staff.user.id,
        tokenHash: hashResetToken(rawToken),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60_000),
      },
    });

    const inviteUrl = this.buildInviteUrl(rawToken);
    await this.emailSender.sendPasswordReset(staff.user.email, inviteUrl);

    const dto = await this.getDtoOrThrow(salonId, staffId);
    return process.env.NODE_ENV === 'production'
      ? { staff: dto }
      : { staff: dto, inviteUrl };
  }

  async update(
    userId: string,
    salonId: string,
    staffId: string,
    input: UpdateSalonStaffInput,
  ): Promise<SalonStaffDto> {
    await this.salonAccess.assertAccess(userId, salonId);
    const existing = await this.prisma.salonStaff.findFirst({
      where: { id: staffId, salonId },
    });
    if (!existing) {
      throw new AppException(
        BookingErrorCode.STAFF_NOT_FOUND,
        'Staff member not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.salonStaff.update({
      where: { id: staffId },
      data: {
        ...(input.displayName !== undefined && {
          displayName: input.displayName,
        }),
        ...(input.status !== undefined && { status: input.status }),
      },
    });
    return this.getDtoOrThrow(salonId, staffId);
  }

  private buildInviteUrl(rawToken: string): string {
    // Same reset-password page the forgot-password flow already uses — the barber sets their own
    // password there, then signs in at /staff/login. No new page, no new token type.
    const webBaseUrl = process.env.WEB_BASE_URL ?? 'http://localhost:3001';
    return `${webBaseUrl}/reset-password?token=${rawToken}`;
  }

  private async getDtoOrThrow(
    salonId: string,
    staffId: string,
  ): Promise<SalonStaffDto> {
    const staff = await this.prisma.salonStaff.findFirst({
      where: { id: staffId, salonId },
      include: { user: { select: { email: true, passwordHash: true } } },
    });
    if (!staff) {
      throw new AppException(
        BookingErrorCode.STAFF_NOT_FOUND,
        'Staff member not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.toDto(staff);
  }

  private toDto(staff: {
    id: string;
    displayName: string;
    roleInSalon: SalonStaffRole;
    status: StaffMemberStatus;
    user: { email: string | null; passwordHash: string | null };
  }): SalonStaffDto {
    return {
      id: staff.id,
      displayName: staff.displayName,
      email: staff.user.email,
      roleInSalon: staff.roleInSalon,
      status: staff.status,
      // Never leaks the hash itself — only whether the invitation has been redeemed, so the UI
      // can show an "invite pending" state.
      hasPassword: staff.user.passwordHash !== null,
    };
  }
}
