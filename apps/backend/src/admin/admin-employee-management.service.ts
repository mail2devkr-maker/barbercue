import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Role,
  UserStatus,
  type AdminEmployeeDto,
  type CreateEmployeeInput,
  type ResetEmployeePasswordInput,
  type UpdateEmployeeInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../auth/services/password.service';
import { AppException } from '../common/exceptions/app.exception';

@Injectable()
export class AdminEmployeeManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
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

      let sequence = (await tx.employeeProfile.count()) + 1;
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
        // Deactivation takes effect immediately, not after the current refresh token expires.
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
      // Every existing employee session is invalid after an admin password reset.
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
