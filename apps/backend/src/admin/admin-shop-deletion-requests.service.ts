import { HttpStatus, Injectable } from '@nestjs/common';
import { ShopDeletionRequestStatus, UserStatus } from '@prisma/client';
import { Role } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { CryptoService } from '../auth/services/crypto.service';
import { TotpService } from '../auth/services/totp.service';
import { AdminSalonManagementService } from './admin-salon-management.service';

@Injectable()
export class AdminShopDeletionRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shops: AdminSalonManagementService,
    private readonly crypto: CryptoService,
    private readonly totp: TotpService,
  ) {}

  private async assertPlatformAdminWithFreshTotp(actorUserId: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      include: { roles: true },
    });
    if (
      !user || user.status !== UserStatus.ACTIVE ||
      !user.roles.some((r) => r.role === Role.PLATFORM_ADMIN && r.salonId === null)
    ) {
      throw new AppException('PLATFORM_ADMIN_REQUIRED', 'Super Admin access required.', HttpStatus.FORBIDDEN);
    }
    if (!user.twoFactorEnabled || !user.totpSecret) {
      throw new AppException('TOTP_SETUP_REQUIRED', 'Authenticator must be configured.', HttpStatus.FORBIDDEN);
    }
    let secret: string;
    try {
      secret = this.crypto.decrypt(user.totpSecret);
    } catch {
      throw new AppException('TOTP_SETUP_REQUIRED', 'Authenticator must be repaired.', HttpStatus.FORBIDDEN);
    }
    if (!(await this.totp.verifyToken(secret, code))) {
      throw new AppException('TOTP_INVALID', 'Invalid authenticator code.', HttpStatus.UNAUTHORIZED);
    }
  }

  async request(actorUserId: string, salonId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      // Stronger than the controller's ADMIN-audience role check: current DB grant.
      const actor = await tx.user.findUnique({
        where: { id: actorUserId },
        include: { roles: true },
      });
      if (
        !actor || actor.status !== UserStatus.ACTIVE ||
        !actor.roles.some((r) => r.role === Role.CO_FOUNDER && r.salonId === null)
      ) {
        throw new AppException('CO_FOUNDER_REQUIRED', 'Co-Founder access required.', HttpStatus.FORBIDDEN);
      }

      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "salons" WHERE "id" = ${salonId} FOR UPDATE
      `;
      if (!locked.length) {
        throw new AppException('SALON_NOT_FOUND', 'Shop not found.', HttpStatus.NOT_FOUND);
      }
      const salon = await tx.salon.findUnique({
        where: { id: salonId },
        select: {
          name: true, publicId: true,
          _count: {
            select: {
              staff: true, bookings: true, queueEntries: true,
              reviews: true, ledgerEntries: true,
            },
          },
        },
      });
      if (!salon) {
        throw new AppException('SALON_NOT_FOUND', 'Shop not found.', HttpStatus.NOT_FOUND);
      }
      const counts = salon._count;
      if (
        counts.staff || counts.bookings || counts.queueEntries ||
        counts.reviews || counts.ledgerEntries
      ) {
        throw new AppException(
          'SALON_HAS_ACTIVITY',
          'Active shops cannot be hard-deleted. Suspend instead.',
          HttpStatus.CONFLICT,
          { ...counts },
        );
      }
      const pending = await tx.shopDeletionRequest.findFirst({
        where: { salonId, status: ShopDeletionRequestStatus.PENDING },
      });
      if (pending) {
        throw new AppException(
          'SHOP_DELETE_ALREADY_REQUESTED',
          'A deletion request is already awaiting Super Admin approval.',
          HttpStatus.CONFLICT,
        );
      }
      const created = await tx.shopDeletionRequest.create({
        data: {
          salonId,
          shopName: salon.name,
          shopPublicId: salon.publicId,
          requestedByUserId: actorUserId,
          reason: reason.trim(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'SHOP_DELETE_REQUESTED',
          entityType: 'Salon',
          entityId: salonId,
          metadata: {
            requestId: created.id, shopPublicId: salon.publicId,
            shopName: salon.name, reason: reason.trim(),
          },
        },
      });
      return created;
    });
  }

  list() {
    return this.prisma.shopDeletionRequest.findMany({
      orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
      take: 200,
    });
  }

  async approve(actorUserId: string, requestId: string, totpCode: string, note?: string) {
    await this.assertPlatformAdminWithFreshTotp(actorUserId, totpCode);

    return this.prisma.$transaction(async (tx) => {
      // Row lock makes double-approve and approve/reject races fail closed.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "shop_deletion_requests" WHERE "id" = ${requestId} FOR UPDATE
      `;
      if (!locked.length) {
        throw new AppException('DELETE_REQUEST_NOT_FOUND', 'Request not found.', HttpStatus.NOT_FOUND);
      }
      const request = await tx.shopDeletionRequest.findUnique({ where: { id: requestId } });
      if (!request || request.status !== ShopDeletionRequestStatus.PENDING) {
        throw new AppException('DELETE_REQUEST_CLOSED', 'Request already resolved.', HttpStatus.CONFLICT);
      }
      if (request.requestedByUserId === actorUserId) {
        throw new AppException(
          'SELF_APPROVAL_FORBIDDEN',
          'The requester cannot approve their own deletion request.',
          HttpStatus.FORBIDDEN,
        );
      }

      // Always re-check activity under parent shop lock at approval time.
      // A shop that gained any bookings/staff/ledger activity cannot be deleted.
      await this.shops.deleteSalonInTransaction(tx, actorUserId, request.salonId);

      const updated = await tx.shopDeletionRequest.update({
        where: { id: requestId },
        data: {
          status: ShopDeletionRequestStatus.APPROVED,
          decidedByUserId: actorUserId,
          decidedAt: new Date(),
          decisionNote: note?.trim() || null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'SHOP_DELETE_APPROVED',
          entityType: 'Salon',
          entityId: request.salonId,
          metadata: {
            requestId, requestedByUserId: request.requestedByUserId,
            shopPublicId: request.shopPublicId, note: note?.trim() || null,
          },
        },
      });
      return updated;
    });
  }

  async reject(actorUserId: string, requestId: string, note: string) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: actorUserId },
        include: { roles: true },
      });
      if (
        !actor || actor.status !== UserStatus.ACTIVE ||
        !actor.roles.some((r) => r.role === Role.PLATFORM_ADMIN && r.salonId === null)
      ) {
        throw new AppException('PLATFORM_ADMIN_REQUIRED', 'Super Admin access required.', HttpStatus.FORBIDDEN);
      }

      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "shop_deletion_requests" WHERE "id" = ${requestId} FOR UPDATE
      `;
      if (!locked.length) {
        throw new AppException('DELETE_REQUEST_NOT_FOUND', 'Request not found.', HttpStatus.NOT_FOUND);
      }
      const request = await tx.shopDeletionRequest.findUnique({ where: { id: requestId } });
      if (!request || request.status !== ShopDeletionRequestStatus.PENDING) {
        throw new AppException('DELETE_REQUEST_CLOSED', 'Request already resolved.', HttpStatus.CONFLICT);
      }
      const updated = await tx.shopDeletionRequest.update({
        where: { id: requestId },
        data: {
          status: ShopDeletionRequestStatus.REJECTED,
          decidedByUserId: actorUserId,
          decidedAt: new Date(),
          decisionNote: note.trim(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'SHOP_DELETE_REJECTED',
          entityType: 'Salon',
          entityId: request.salonId,
          metadata: {
            requestId,
            requestedByUserId: request.requestedByUserId,
            shopPublicId: request.shopPublicId,
            reason: note.trim(),
          },
        },
      });
      return updated;
    });
  }
}
