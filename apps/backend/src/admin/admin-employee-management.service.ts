import { HttpStatus, Injectable } from '@nestjs/common';
import {
  EMPLOYEE_RESERVED_ID_MAX,
  EMPLOYEE_RESERVED_ID_MIN,
  EMPLOYEE_STANDARD_ID_START,
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

  async create(
    adminUserId: string,
    input: CreateEmployeeInput,
  ): Promise<AdminEmployeeDto> {
    const passwordHash = await this.passwords.hash(input.password);

    const profileId = await this.prisma.$transaction(async (tx) => {
      // Serialise employee-code allocation so two admin clicks can never mint the same FQ-FE id.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fastque_employee_code'))`;

      // IDs 1-100 are a permanently reserved owner-controlled block. Ordinary provisioning
      // starts at 101 and can never consume the reserved range.
      const firstStandardCode = this.employeeCode(EMPLOYEE_STANDARD_ID_START);
      const lastStandard = await tx.employeeProfile.findFirst({
        where: { employeeCode: { gte: firstStandardCode } },
        orderBy: { employeeCode: 'desc' },
        select: { employeeCode: true },
      });
      let sequence = lastStandard
        ? Number(lastStandard.employeeCode.replace('FQ-FE-', '')) + 1
        : EMPLOYEE_STANDARD_ID_START;
      if (!Number.isSafeInteger(sequence) || sequence < EMPLOYEE_STANDARD_ID_START) {
        sequence = EMPLOYEE_STANDARD_ID_START;
      }

      let employeeCode = this.employeeCode(sequence);
      while (
        await tx.employeeProfile.findUnique({
          where: { employeeCode },
          select: { id: true },
        })
      ) {
        sequence += 1;
        employeeCode = this.employeeCode(sequence);
      }

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
          fullName: input.fullName,
          territory: input.territory?.trim() || null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'EMPLOYEE_CREATED',
          entityType: 'EmployeeProfile',
          entityId: profile.id,
          metadata: {
            employeeCode,
            fullName: input.fullName,
            territory: input.territory?.trim() || null,
            reservedId: false,
          },
        },
      });
      return profile.id;
    });

    return this.getOrThrow(profileId);
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
    const employeeCode = this.employeeCode(input.employeeNumber);

    const profileId = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fastque_employee_code'))`;

      const existing = await tx.employeeProfile.findUnique({
        where: { employeeCode },
        select: { id: true },
      });
      if (existing) {
        throw new AppException(
          'EMPLOYEE_RESERVED_ID_TAKEN',
          `${employeeCode} is already assigned.`,
          HttpStatus.CONFLICT,
        );
      }

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
          fullName: input.fullName,
          territory: input.territory?.trim() || null,
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
            fullName: input.fullName,
            territory: input.territory?.trim() || null,
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
      }

      if (input.status !== undefined && input.status !== existing!.user.status) {
        await tx.user.update({
          where: { id: existing!.userId },
          data: { status: input.status },
        });
        if (input.status === UserStatus.SUSPENDED) {
          await tx.refreshToken.updateMany({
            where: { userId: existing!.userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorUserId: adminUserId,
          action: 'EMPLOYEE_UPDATED',
          entityType: 'EmployeeProfile',
          entityId: employeeId,
          metadata: {
            before: {
              fullName: existing!.fullName,
              territory: existing!.territory,
              status: existing!.user.status,
            },
            requested: input,
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

  private employeeCode(sequence: number): string {
    return `FQ-FE-${String(sequence).padStart(5, '0')}`;
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
