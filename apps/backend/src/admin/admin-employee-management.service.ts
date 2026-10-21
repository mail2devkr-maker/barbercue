import { HttpStatus, Injectable } from '@nestjs/common';
import {
  EMPLOYEE_RESERVED_ID_MAX,
  EMPLOYEE_RESERVED_ID_MIN,
  EmployeeIdentityVerificationStatus,
  Role,
  UserStatus,
  type AdminEmployeeDto,
  type CreateEmployeeInput,
  type CreateSpecialEmployeeInput,
  type ResetEmployeePasswordInput,
  type UpdateEmployeeInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../auth/services/password.service';
import { TotpService } from '../auth/services/totp.service';
import { CryptoService } from '../auth/services/crypto.service';
import { AppException } from '../common/exceptions/app.exception';
import {
  lockEmployeeCodeNamespace,
  reservedEmployeeCode,
} from './employee-code-allocator';

@Injectable()
export class AdminEmployeeManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly crypto: CryptoService,
  ) {}

  async list(): Promise<AdminEmployeeDto[]> {
    const rows = await this.prisma.employeeProfile.findMany({
      orderBy: [{ joinedAt: 'desc' }, { employeeCode: 'asc' }],
      include: {
        user: {
          select: {
            id: true,
            status: true,
            passwordHash: true,
          },
        },
      },
    });
    return rows.map((row) => this.toDto(row));
  }

  create(
    adminUserId: string,
    input: CreateEmployeeInput,
  ): Promise<AdminEmployeeDto> {
    void adminUserId;
    void input;
    return Promise.reject(
      new AppException(
        'EMPLOYEE_HR_REGISTRY_REQUIRED',
        'Create an HR identity and offer first. Employee ID allocation occurs only when an offer is officially issued; login is enabled only by the confirmed joining action.',
        HttpStatus.CONFLICT,
      ),
    );
  }

  /**
   * Explicit owner-controlled path for IDs 1-100. The caller must already hold an ADMIN-audience
   * PLATFORM_ADMIN session (AdminController/roles guard), then prove possession of the current
   * authenticator again with a fresh TOTP code before one reserved ID can be consumed.
   */
  async createSpecial(
    adminUserId: string,
    input: CreateSpecialEmployeeInput,
  ): Promise<AdminEmployeeDto> {
    if (
      input.employeeNumber < EMPLOYEE_RESERVED_ID_MIN ||
      input.employeeNumber > EMPLOYEE_RESERVED_ID_MAX
    ) {
      throw new AppException(
        'EMPLOYEE_RESERVED_ID_INVALID',
        'Reserved employee number must be between 1 and 100.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.assertFreshAdminTotp(adminUserId, input.totpCode);
    const passwordHash = await this.passwords.hash(input.password);
    const employeeCode = reservedEmployeeCode(input.employeeNumber);

    const profileId = await this.prisma.$transaction(async (tx) => {
      await lockEmployeeCodeNamespace(tx);

      const [existingProfile, existingIdentity] = await Promise.all([
        tx.employeeProfile.findUnique({
          where: { employeeCode },
          select: { id: true },
        }),
        tx.employeeIdentity.findUnique({
          where: { employeeCode },
          select: { id: true },
        }),
      ]);
      if (existingProfile || existingIdentity) {
        throw new AppException(
          'EMPLOYEE_RESERVED_ID_TAKEN',
          `${employeeCode} is already assigned.`,
          HttpStatus.CONFLICT,
        );
      }

      const identity = await tx.employeeIdentity.create({
        data: {
          employeeCode,
          fullName: input.fullName,
          verificationStatus: EmployeeIdentityVerificationStatus.NEEDS_REVIEW,
          historyStatus: 'COMPLETE',
        },
      });
      const joinedAt = new Date();

      const user = await tx.user.create({
        data: {
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      });
      await tx.userRole.create({
        data: {
          userId: user.id,
          role: Role.FIELD_EXECUTIVE,
          salonId: null,
        },
      });
      const profile = await tx.employeeProfile.create({
        data: {
          userId: user.id,
          employeeCode,
          employeeIdentityId: identity.id,
          fullName: input.fullName,
          territory: input.territory?.trim() || null,
          joinedAt,
        },
      });
      const episode = await tx.employeeEmploymentEpisode.create({
        data: {
          identityId: identity.id,
          episodeNumber: 1,
          startedAt: joinedAt,
        },
      });
      await tx.employeeHrEvent.create({
        data: {
          identityId: identity.id,
          actorUserId: adminUserId,
          eventType: 'EMPLOYMENT_JOINED',
          entityType: 'EMPLOYMENT_EPISODE',
          entityId: episode.id,
          metadata: {
            status: 'ACTIVE',
            employeeCode,
            source: 'SPECIAL_EMPLOYEE_PROVISIONING',
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'SPECIAL_EMPLOYEE_CREATED',
          entityType: 'EmployeeProfile',
          entityId: profile.id,
          metadata: {
            employeeCode,
            reservedNumber: input.employeeNumber,
            totpReauthenticated: true,
          },
        },
      });
      return profile.id;
    });

    return this.getOrThrow(profileId);
  }

  async update(
    adminUserId: string,
    employeeId: string,
    input: UpdateEmployeeInput,
  ): Promise<AdminEmployeeDto> {
    const existing = await this.prisma.employeeProfile.findUnique({
      where: { id: employeeId },
      include: { user: true },
    });
    if (!existing) this.notFound();
    if (
      input.status === UserStatus.ACTIVE &&
      existing!.user.status !== UserStatus.ACTIVE
    ) {
      throw new AppException(
        'EMPLOYEE_REJOIN_ACTION_REQUIRED',
        'Reactivation must use the verified HR joining flow so a new employment episode is recorded.',
        HttpStatus.CONFLICT,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (input.fullName !== undefined || input.territory !== undefined) {
        await tx.employeeProfile.update({
          where: { id: employeeId },
          data: {
            ...(input.fullName !== undefined && { fullName: input.fullName }),
            ...(input.territory !== undefined && {
              territory: input.territory?.trim() || null,
            }),
          },
        });
        if (input.fullName !== undefined && existing!.employeeIdentityId) {
          await tx.employeeIdentity.update({
            where: { id: existing!.employeeIdentityId },
            data: { fullName: input.fullName },
          });
          await tx.employeeHrEvent.create({
            data: {
              identityId: existing!.employeeIdentityId,
              actorUserId: adminUserId,
              eventType: 'EMPLOYEE_IDENTITY_NAME_UPDATED',
              entityType: 'EMPLOYEE_IDENTITY',
              entityId: existing!.employeeIdentityId,
              metadata: { changed: true },
            },
          });
        }
      }

      if (
        input.status !== undefined &&
        input.status !== existing!.user.status
      ) {
        await tx.user.update({
          where: { id: existing!.userId },
          data: { status: input.status },
        });
        if (input.status === UserStatus.SUSPENDED) {
          await tx.refreshToken.updateMany({
            where: { userId: existing!.userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          if (existing!.employeeIdentityId) {
            await tx.employeeHrEvent.create({
              data: {
                identityId: existing!.employeeIdentityId,
                actorUserId: adminUserId,
                eventType: 'EMPLOYEE_ACCESS_SUSPENDED',
                entityType: 'EMPLOYEE_IDENTITY',
                entityId: existing!.employeeIdentityId,
                metadata: { sessionsRevoked: true },
              },
            });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'EMPLOYEE_UPDATED',
          entityType: 'EmployeeProfile',
          entityId: employeeId,
          metadata: {
            changedFields: Object.keys(input),
            statusChanged:
              input.status !== undefined &&
              input.status !== existing!.user.status,
          },
        },
      });
    });

    return this.getOrThrow(employeeId);
  }

  async resetPassword(
    adminUserId: string,
    employeeId: string,
    input: ResetEmployeePasswordInput,
  ): Promise<{ reset: true }> {
    const employee = await this.prisma.employeeProfile.findUnique({
      where: { id: employeeId },
      select: { id: true, userId: true, employeeCode: true },
    });
    if (!employee) this.notFound();

    const passwordHash = await this.passwords.hash(input.password);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: employee!.userId },
        data: { passwordHash },
      });
      await tx.refreshToken.updateMany({
        where: { userId: employee!.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'EMPLOYEE_PASSWORD_RESET',
          entityType: 'EmployeeProfile',
          entityId: employeeId,
          metadata: { employeeCode: employee!.employeeCode },
        },
      });
    });

    return { reset: true };
  }

  private async assertFreshAdminTotp(
    adminUserId: string,
    totpCode: string,
  ): Promise<void> {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminUserId },
      include: { roles: true },
    });
    const isGlobalAdmin =
      !!admin &&
      admin.status === UserStatus.ACTIVE &&
      admin.roles.some(
        (role) => role.role === Role.PLATFORM_ADMIN && role.salonId === null,
      );
    if (!admin || !isGlobalAdmin) {
      throw new AppException(
        'SPECIAL_EMPLOYEE_ADMIN_REQUIRED',
        'A current platform administrator session is required.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!admin.twoFactorEnabled || !admin.totpSecret) {
      throw new AppException(
        'TOTP_SETUP_REQUIRED',
        'Authenticator setup is required before using reserved employee IDs.',
        HttpStatus.FORBIDDEN,
      );
    }

    let secret: string;
    try {
      secret = this.crypto.decrypt(admin.totpSecret);
    } catch {
      throw new AppException(
        'TOTP_SETUP_REQUIRED',
        'Authenticator setup must be repaired before using reserved employee IDs.',
        HttpStatus.FORBIDDEN,
      );
    }

    const valid = await this.totp.verifyToken(secret, totpCode);
    if (!valid) {
      throw new AppException(
        'TOTP_INVALID',
        'Incorrect authenticator code.',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private async getOrThrow(employeeId: string): Promise<AdminEmployeeDto> {
    const row = await this.prisma.employeeProfile.findUnique({
      where: { id: employeeId },
      include: {
        user: {
          select: {
            id: true,
            status: true,
            passwordHash: true,
          },
        },
      },
    });
    if (!row) this.notFound();
    return this.toDto(row!);
  }

  private notFound(): never {
    throw new AppException(
      'EMPLOYEE_NOT_FOUND',
      'Employee not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private toDto(row: {
    id: string;
    userId: string;
    employeeCode: string;
    fullName: string;
    territory: string | null;
    joinedAt: Date;
    createdAt: Date;
    updatedAt: Date;
    user: {
      id: string;
      status: UserStatus;
      passwordHash: string | null;
    };
  }): AdminEmployeeDto {
    return {
      id: row.id,
      userId: row.user.id,
      employeeCode: row.employeeCode,
      fullName: row.fullName,
      territory: row.territory,
      joinedAt: row.joinedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      status: row.user.status,
      passwordConfigured: row.user.passwordHash !== null,
    };
  }
}
