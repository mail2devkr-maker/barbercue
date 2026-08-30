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
import {
  buildPasswordLink,
  passwordWebBaseUrl,
} from '../auth/services/password-link';

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
 * Account handling resolves phone and optional email together. A single matching User is linked;
 * identifiers that resolve to different Users are rejected and never silently merged.
 */
@Injectable()
export class SalonStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
  ) {}

  async list(userId: string, salonId: string): Promise<SalonStaffDto[]> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    const staff = await this.prisma.salonStaff.findMany({
      where: { salonId },
      orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
      include: {
        user: { select: { phone: true, email: true, passwordHash: true } },
      },
    });
    return staff.map((s) => this.toDto(s));
  }

  /**
   * Creates (or links) the barber's account. When email was supplied it issues an invitation and
   * returns the link in `inviteUrl` only outside production — identical dev-convenience rule to
   * AuthService.forgotPassword's `devResetUrl`, since no email provider is wired yet
   * (ConsoleEmailSender logs the link). In production the link is delivered by email only.
   */
  async create(
    userId: string,
    salonId: string,
    input: CreateSalonStaffInput,
  ): Promise<StaffInviteResultDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);

    const phone = input.phone.trim();
    const email = input.email?.trim().toLowerCase() || null;
    // Do not create a passwordless staff account and only then discover that its invitation
    // cannot be delivered. Email-less roster members remain intentionally supported.
    if (email) this.emailSender.assertAvailable();
    const rawToken = email ? randomBytes(32).toString('hex') : null;
    const inviteUrl = rawToken
      ? buildPasswordLink(passwordWebBaseUrl(), rawToken, 'staff', 'invite')
      : null;
    const staffId = await this.prisma.$transaction(async (tx) => {
      const users = await tx.user.findMany({
        where: { OR: [{ phone }, ...(email ? [{ email }] : [])] },
      });
      const byPhone =
        users.find((candidate) => candidate.phone === phone) ?? null;
      const byEmail = email
        ? (users.find(
            (candidate) => candidate.email?.toLowerCase() === email,
          ) ?? null)
        : null;

      if (byPhone && byEmail && byPhone.id !== byEmail.id) {
        throw new AppException(
          SalonSetupErrorCode.STAFF_IDENTITY_CONFLICT,
          'That mobile number and email belong to different accounts. Check the details and try again.',
          HttpStatus.CONFLICT,
        );
      }

      const existingUser = byPhone ?? byEmail;
      if (existingUser && existingUser.status !== UserStatus.ACTIVE) {
        throw new AppException(
          SalonSetupErrorCode.STAFF_ACCOUNT_UNAVAILABLE,
          'That mobile number or email belongs to a suspended account and cannot be added as staff.',
          HttpStatus.CONFLICT,
        );
      }

      if (
        existingUser &&
        ((existingUser.phone && existingUser.phone !== phone) ||
          (email &&
            existingUser.email &&
            existingUser.email.toLowerCase() !== email))
      ) {
        throw new AppException(
          SalonSetupErrorCode.STAFF_IDENTITY_CONFLICT,
          'Those contact details do not match the same existing account.',
          HttpStatus.CONFLICT,
        );
      }

      // Link when either identifier finds an account. A missing phone/email may be filled, but a
      // different existing identity is never overwritten or silently merged.
      const identityPatch = existingUser
        ? {
            ...(!existingUser.phone && { phone }),
            ...(email && !existingUser.email && { email }),
          }
        : null;
      const user = existingUser
        ? Object.keys(identityPatch ?? {}).length > 0
          ? await tx.user.update({
              where: { id: existingUser.id },
              data: identityPatch!,
            })
          : existingUser
        : await tx.user.create({
            data: { phone, ...(email && { email }), status: UserStatus.ACTIVE },
          });

      const alreadyOnRoster = await tx.salonStaff.findFirst({
        where: { salonId, userId: user.id },
      });
      if (alreadyOnRoster) {
        throw new AppException(
          SalonSetupErrorCode.STAFF_ALREADY_EXISTS,
          "That person is already on this salon's staff.",
          HttpStatus.CONFLICT,
        );
      }

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

      if (email && rawToken) {
        await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashResetToken(rawToken),
            expiresAt: new Date(
              Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60_000,
            ),
          },
        });
      }

      return created.id;
    });

    if (email && inviteUrl)
      await this.emailSender.sendStaffInvitation(
        email,
        inviteUrl,
        INVITE_TTL_DAYS,
      );

    const staff = await this.getDtoOrThrow(salonId, staffId);
    if (!email || !inviteUrl) return { staff, invitationSent: false };
    return process.env.NODE_ENV === 'production'
      ? { staff, invitationSent: true }
      : { staff, invitationSent: true, inviteUrl };
  }

  /** Re-issues an invitation link — for a barber who never redeemed the first one, or lost it. */
  async resendInvite(
    userId: string,
    salonId: string,
    staffId: string,
  ): Promise<StaffInviteResultDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
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

    this.emailSender.assertAvailable();

    const rawToken = randomBytes(32).toString('hex');
    const inviteUrl = buildPasswordLink(
      passwordWebBaseUrl(),
      rawToken,
      'staff',
      'invite',
    );
    await this.prisma.passwordResetToken.create({
      data: {
        userId: staff.user.id,
        tokenHash: hashResetToken(rawToken),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60_000),
      },
    });

    await this.emailSender.sendStaffInvitation(
      staff.user.email,
      inviteUrl,
      INVITE_TTL_DAYS,
    );

    const dto = await this.getDtoOrThrow(salonId, staffId);
    return process.env.NODE_ENV === 'production'
      ? { staff: dto, invitationSent: true }
      : { staff: dto, invitationSent: true, inviteUrl };
  }

  async update(
    userId: string,
    salonId: string,
    staffId: string,
    input: UpdateSalonStaffInput,
  ): Promise<SalonStaffDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
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
        // '' clears the field (see updateSalonStaffSchema's own doc comment) — every other value,
        // including undefined (omitted), leaves the column untouched.
        ...(input.bio !== undefined && { bio: input.bio || null }),
        ...(input.photoUrl !== undefined && {
          photoUrl: input.photoUrl || null,
        }),
        ...(input.yearsExperience !== undefined && {
          yearsExperience: input.yearsExperience,
        }),
      },
    });
    return this.getDtoOrThrow(salonId, staffId);
  }

  private async getDtoOrThrow(
    salonId: string,
    staffId: string,
  ): Promise<SalonStaffDto> {
    const staff = await this.prisma.salonStaff.findFirst({
      where: { id: staffId, salonId },
      include: {
        user: { select: { phone: true, email: true, passwordHash: true } },
      },
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
    bio: string | null;
    photoUrl: string | null;
    yearsExperience: number | null;
    user: {
      phone: string | null;
      email: string | null;
      passwordHash: string | null;
    };
  }): SalonStaffDto {
    return {
      id: staff.id,
      displayName: staff.displayName,
      phone: staff.user.phone,
      email: staff.user.email,
      roleInSalon: staff.roleInSalon,
      status: staff.status,
      // Never leaks the hash itself — only whether the invitation has been redeemed, so the UI
      // can show an "invite pending" state.
      hasPassword: staff.user.passwordHash !== null,
      bio: staff.bio,
      photoUrl: staff.photoUrl,
      yearsExperience: staff.yearsExperience,
    };
  }
}
