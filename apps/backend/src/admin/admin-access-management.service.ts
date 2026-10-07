import { Injectable } from '@nestjs/common';
import {
  Role,
  type AdminAccessUserDto,
  type ManagedAdminRole,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../auth/services/token.service';

const INTERNAL_ADMIN_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.CO_FOUNDER,
  Role.HR_ADMIN,
  Role.SALES_ADMIN,
  Role.PLATFORM_VIEWER,
];

@Injectable()
export class AdminAccessManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async list(): Promise<AdminAccessUserDto[]> {
    const users = await this.prisma.user.findMany({
      where: {
        roles: {
          some: {
            role: { in: INTERNAL_ADMIN_ROLES },
            salonId: null,
          },
        },
      },
      include: { roles: true },
      orderBy: [{ createdAt: 'asc' }],
    });

    return users.map((user) => ({
      id: user.id,
      email: user.email,
      status: user.status,
      roles: user.roles
        .filter(
          (item) =>
            item.salonId === null && INTERNAL_ADMIN_ROLES.includes(item.role),
        )
        .map((item) => item.role),
      createdAt: user.createdAt.toISOString(),
    }));
  }

  async grant(
    actorUserId: string,
    email: string,
    role: ManagedAdminRole,
  ): Promise<AdminAccessUserDto[]> {
    const normalizedEmail = email.trim().toLowerCase();

    const targetUserId = await this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email: normalizedEmail } });
      if (!user) {
        user = await tx.user.create({
          data: { email: normalizedEmail },
        });
      }

      const existing = await tx.userRole.findFirst({
        where: { userId: user.id, role, salonId: null },
      });
      if (!existing) {
        await tx.userRole.create({
          data: { userId: user.id, role, salonId: null },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'ADMIN_ACCESS_GRANTED',
          entityType: 'User',
          entityId: user.id,
          metadata: { email: normalizedEmail, role },
        },
      });

      return user.id;
    });

    await this.tokens.revokeAllForUser(targetUserId);
    return this.list();
  }

  async revoke(
    actorUserId: string,
    targetUserId: string,
    role: ManagedAdminRole,
  ): Promise<AdminAccessUserDto[]> {
    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: { userId: targetUserId, role, salonId: null },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'ADMIN_ACCESS_REVOKED',
          entityType: 'User',
          entityId: targetUserId,
          metadata: { role },
        },
      });
    });

    await this.tokens.revokeAllForUser(targetUserId);
    return this.list();
  }
}
