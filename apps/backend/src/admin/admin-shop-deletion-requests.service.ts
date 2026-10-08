import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Prisma,
  SalonStatus,
  ShopDeletionRequestStatus,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';
import { Role } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { CryptoService } from '../auth/services/crypto.service';
import { TotpService } from '../auth/services/totp.service';
import { SalonActivationService } from '../salon-setup/salon-activation.service';
import { AdminSalonManagementService } from './admin-salon-management.service';

const PAGE_SIZE = 50;

type Transaction = Prisma.TransactionClient;
type DeletionDecision =
  | {
      kind: 'approved';
      request: unknown;
      restoreEligibleUntil: Date;
      shopName: string;
    }
  | { kind: 'denied'; code: string; message: string; details?: unknown };
type RestoreDecision =
  | { kind: 'restored'; salon: unknown }
  | { kind: 'expired'; restoreEligibleUntil: Date }
  | { kind: 'denied'; code: string; message: string };

@Injectable()
export class AdminShopDeletionRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shops: AdminSalonManagementService,
    private readonly crypto: CryptoService,
    private readonly totp: TotpService,
    private readonly activation: SalonActivationService,
  ) {}

  private async lockActorWithRole(
    tx: Transaction,
    actorUserId: string,
    role: Role,
  ) {
    // Every decision path locks actor/user-role first, then request, then salon. This stable order
    // removes the approve/reject cycle that previously deadlocked (user ↔ request row).
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT u."id"
      FROM "users" AS u
      INNER JOIN "user_roles" AS r ON r."userId" = u."id"
      WHERE u."id" = ${actorUserId}
        AND u."status" = 'ACTIVE'
        AND r."role"::text = ${role}
        AND r."salonId" IS NULL
      FOR UPDATE OF u, r
    `;
    if (!locked.length) {
      const isAdmin = role === Role.PLATFORM_ADMIN;
      throw new AppException(
        isAdmin ? 'PLATFORM_ADMIN_REQUIRED' : 'CO_FOUNDER_REQUIRED',
        isAdmin
          ? 'Super Admin access required.'
          : 'Co-Founder access required.',
        HttpStatus.FORBIDDEN,
      );
    }
    const actor = await tx.user.findUnique({
      where: { id: actorUserId },
      include: { roles: true },
    });
    if (
      !actor ||
      actor.status !== UserStatus.ACTIVE ||
      !actor.roles.some(
        (assignment) => assignment.role === role && assignment.salonId === null,
      )
    ) {
      throw new AppException(
        role === Role.PLATFORM_ADMIN
          ? 'PLATFORM_ADMIN_REQUIRED'
          : 'CO_FOUNDER_REQUIRED',
        role === Role.PLATFORM_ADMIN
          ? 'Super Admin access required.'
          : 'Co-Founder access required.',
        HttpStatus.FORBIDDEN,
      );
    }
    return actor;
  }

  private async assertFreshTotp(
    actor: { twoFactorEnabled: boolean; totpSecret: string | null },
    code: string,
  ) {
    if (!actor.twoFactorEnabled || !actor.totpSecret) {
      throw new AppException(
        'TOTP_SETUP_REQUIRED',
        'Authenticator must be configured.',
        HttpStatus.FORBIDDEN,
      );
    }
    let secret: string;
    try {
      secret = this.crypto.decrypt(actor.totpSecret);
    } catch {
      throw new AppException(
        'TOTP_SETUP_REQUIRED',
        'Authenticator must be repaired.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!(await this.totp.verifyToken(secret, code))) {
      throw new AppException(
        'TOTP_INVALID',
        'Invalid authenticator code.',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  async request(actorUserId: string, salonId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockActorWithRole(tx, actorUserId, Role.CO_FOUNDER);
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "salons" WHERE "id" = ${salonId} FOR UPDATE
      `;
      if (!locked.length) {
        throw new AppException(
          'SALON_NOT_FOUND',
          'Shop not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      const salon = await tx.salon.findUnique({
        where: { id: salonId },
        select: {
          name: true,
          publicId: true,
          softDeletedAt: true,
        },
      });
      if (!salon) {
        throw new AppException(
          'SALON_NOT_FOUND',
          'Shop not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      if (salon.softDeletedAt) {
        throw new AppException(
          'SHOP_ALREADY_QUARANTINED',
          'This shop is already in recovery trash.',
          HttpStatus.CONFLICT,
        );
      }
      const pending = await tx.shopDeletionRequest.findFirst({
        where: { salonId, status: ShopDeletionRequestStatus.PENDING },
        select: { id: true },
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
            requestId: created.id,
            shopPublicId: salon.publicId,
            shopName: salon.name,
          },
        },
      });
      return created;
    });
  }

  async list(input: { cursor?: string; status?: string } = {}) {
    const cursor = decodeCursor(input.cursor);
    if (
      input.status &&
      !['PENDING', 'APPROVED', 'REJECTED', 'RESOLVED'].includes(input.status)
    ) {
      throw new AppException(
        'INVALID_DELETION_REQUEST_STATUS',
        'The deletion request status filter is invalid.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const statusFilter:
      Prisma.ShopDeletionRequestWhereInput['status'] | undefined =
      input.status === 'RESOLVED'
        ? undefined
        : (input.status as ShopDeletionRequestStatus | undefined);
    const where: Prisma.ShopDeletionRequestWhereInput = {
      ...(input.status === 'RESOLVED'
        ? {
            status: {
              in: [
                ShopDeletionRequestStatus.APPROVED,
                ShopDeletionRequestStatus.REJECTED,
              ],
            },
          }
        : statusFilter
          ? { status: statusFilter }
          : {}),
      ...(cursor
        ? {
            OR: [
              { requestedAt: { lt: cursor.at } },
              { requestedAt: cursor.at, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.shopDeletionRequest.findMany({
      where,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      select: {
        id: true,
        salonId: true,
        shopName: true,
        shopPublicId: true,
        requestedByUserId: true,
        status: true,
        requestedAt: true,
        decidedByUserId: true,
        decidedAt: true,
      },
    });
    const hasMore = rows.length > PAGE_SIZE;
    const items = rows.slice(0, PAGE_SIZE);
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: [...new Set(items.map((r) => r.requestedByUserId))] },
      },
      select: { id: true, email: true },
    });
    const emails = new Map(users.map((user) => [user.id, user.email]));
    const last = items[items.length - 1];
    return {
      items: items.map((request) => ({
        ...request,
        requestedByEmail: emails.get(request.requestedByUserId) ?? null,
      })),
      nextCursor:
        hasMore && last ? encodeCursor(last.requestedAt, last.id) : null,
    };
  }

  async getRequestDetail(requestId: string) {
    const request = await this.prisma.shopDeletionRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        salonId: true,
        shopName: true,
        shopPublicId: true,
        requestedByUserId: true,
        reason: true,
        status: true,
        requestedAt: true,
        decidedByUserId: true,
        decidedAt: true,
        decisionNote: true,
      },
    });
    if (!request) {
      throw new AppException(
        'DELETE_REQUEST_NOT_FOUND',
        'Request not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const requester = await this.prisma.user.findUnique({
      where: { id: request.requestedByUserId },
      select: { email: true },
    });
    return { ...request, requestedByEmail: requester?.email ?? null };
  }

  async listTrash(input: { cursor?: string } = {}) {
    const cursor = decodeCursor(input.cursor);
    const where: Prisma.SalonWhereInput = {
      softDeletedAt: { not: null },
      ...(cursor
        ? {
            OR: [
              { softDeletedAt: { lt: cursor.at } },
              { softDeletedAt: cursor.at, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.salon.findMany({
      where,
      orderBy: [{ softDeletedAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      select: {
        id: true,
        name: true,
        publicId: true,
        status: true,
        softDeletedAt: true,
        restoreEligibleUntil: true,
        softDeletedByUserId: true,
        softDeletionRequestId: true,
        statusBeforeSoftDelete: true,
      },
    });
    const hasMore = rows.length > PAGE_SIZE;
    const items = rows.slice(0, PAGE_SIZE);
    const actors = await this.prisma.user.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              items
                .map((row) => row.softDeletedByUserId)
                .filter((id): id is string => !!id),
            ),
          ],
        },
      },
      select: { id: true, email: true },
    });
    const emails = new Map(actors.map((actor) => [actor.id, actor.email]));
    const now = Date.now();
    const last = items[items.length - 1];
    return {
      items: items.map((salon) => ({
        ...salon,
        deletedByEmail: salon.softDeletedByUserId
          ? (emails.get(salon.softDeletedByUserId) ?? null)
          : null,
        remainingMs: Math.max(
          0,
          (salon.restoreEligibleUntil?.getTime() ?? 0) - now,
        ),
        restoreExpired: (salon.restoreEligibleUntil?.getTime() ?? 0) <= now,
      })),
      nextCursor:
        hasMore && last?.softDeletedAt
          ? encodeCursor(last.softDeletedAt, last.id)
          : null,
    };
  }

  async approve(
    actorUserId: string,
    requestId: string,
    totpCode: string,
    note?: string,
  ) {
    const decision: DeletionDecision = await this.prisma.$transaction(
      async (tx) => {
        const actor = await this.lockActorWithRole(
          tx,
          actorUserId,
          Role.PLATFORM_ADMIN,
        );
        await this.assertFreshTotp(actor, totpCode);
        const request = await this.lockPendingRequest(tx, requestId);
        if (request.requestedByUserId === actorUserId) {
          throw new AppException(
            'SELF_APPROVAL_FORBIDDEN',
            'The requester cannot approve their own deletion request.',
            HttpStatus.FORBIDDEN,
          );
        }
        const quarantine = await this.shops.quarantineSalonInTransaction(
          tx,
          actorUserId,
          request.salonId,
          request.id,
        );
        if (!quarantine.quarantined) {
          await tx.auditLog.create({
            data: {
              actorUserId,
              action: 'SHOP_DELETE_DENIED',
              entityType: 'Salon',
              entityId: request.salonId,
              metadata: {
                requestId,
                reasonCode: quarantine.code,
                blockerTypes: quarantine.blockers.join(','),
              },
            },
          });
          return {
            kind: 'denied',
            code: quarantine.code,
            message: quarantine.message,
            details: quarantine.blockers,
          };
        }

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
              requestId,
              requestedByUserId: request.requestedByUserId,
              shopPublicId: request.shopPublicId,
            },
          },
        });
        return {
          kind: 'approved',
          request: updated,
          restoreEligibleUntil: quarantine.restoreEligibleUntil,
          shopName: quarantine.shopName,
        };
      },
    );

    if (decision.kind === 'denied') {
      throw new AppException(
        decision.code,
        decision.message,
        HttpStatus.CONFLICT,
        { blockers: decision.details },
      );
    }
    return {
      request: decision.request,
      shopName: decision.shopName,
      restoreEligibleUntil: decision.restoreEligibleUntil.toISOString(),
    };
  }

  async reject(
    actorUserId: string,
    requestId: string,
    totpCode: string,
    note: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await this.lockActorWithRole(
        tx,
        actorUserId,
        Role.PLATFORM_ADMIN,
      );
      await this.assertFreshTotp(actor, totpCode);
      const request = await this.lockPendingRequest(tx, requestId);
      const salonLock = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "salons" WHERE "id" = ${request.salonId} FOR UPDATE
      `;
      if (!salonLock.length) {
        throw new AppException(
          'SALON_NOT_FOUND',
          'Shop not found.',
          HttpStatus.NOT_FOUND,
        );
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
          },
        },
      });
      return updated;
    });
  }

  async restore(actorUserId: string, salonId: string, totpCode: string) {
    const decision: RestoreDecision = await this.prisma.$transaction(
      async (tx) => {
        const actor = await this.lockActorWithRole(
          tx,
          actorUserId,
          Role.PLATFORM_ADMIN,
        );
        await this.assertFreshTotp(actor, totpCode);

        // Discover the request ID without locking the salon, then follow the common actor → request
        // → salon order and verify the relationship again after taking the salon lock.
        const pointer = await tx.salon.findUnique({
          where: { id: salonId },
          select: { softDeletionRequestId: true },
        });
        if (!pointer?.softDeletionRequestId) {
          await tx.auditLog.create({
            data: {
              actorUserId,
              action: 'SHOP_DELETE_RESTORE_DENIED',
              entityType: 'Salon',
              entityId: salonId,
              metadata: { reasonCode: 'SHOP_NOT_IN_TRASH' },
            },
          });
          return {
            kind: 'denied',
            code: 'SHOP_NOT_IN_TRASH',
            message: 'Shop is not in recovery trash.',
          };
        }
        await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "shop_deletion_requests"
        WHERE "id" = ${pointer.softDeletionRequestId}
        FOR UPDATE
      `;
        const salonLock = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "salons" WHERE "id" = ${salonId} FOR UPDATE
      `;
        if (!salonLock.length) {
          return {
            kind: 'denied',
            code: 'SALON_NOT_FOUND',
            message: 'Shop not found.',
          };
        }
        const salon = await tx.salon.findUnique({
          where: { id: salonId },
          include: { verification: { select: { status: true } } },
        });
        if (
          !salon?.softDeletedAt ||
          !salon.restoreEligibleUntil ||
          !salon.statusBeforeSoftDelete ||
          salon.softDeletionRequestId !== pointer.softDeletionRequestId
        ) {
          await tx.auditLog.create({
            data: {
              actorUserId,
              action: 'SHOP_DELETE_RESTORE_DENIED',
              entityType: 'Salon',
              entityId: salonId,
              metadata: {
                requestId: pointer.softDeletionRequestId,
                reasonCode: 'SHOP_NOT_IN_TRASH',
              },
            },
          });
          return {
            kind: 'denied',
            code: 'SHOP_NOT_IN_TRASH',
            message: 'Shop is not in recovery trash.',
          };
        }

        const now = new Date();
        if (now.getTime() >= salon.restoreEligibleUntil.getTime()) {
          await tx.auditLog.create({
            data: {
              actorUserId,
              action: 'SHOP_DELETE_RESTORE_EXPIRED',
              entityType: 'Salon',
              entityId: salonId,
              metadata: {
                requestId: salon.softDeletionRequestId,
                restoreEligibleUntil: salon.restoreEligibleUntil.toISOString(),
                result: 'READ_ONLY_EXPIRED',
              },
            },
          });
          return {
            kind: 'expired',
            restoreEligibleUntil: salon.restoreEligibleUntil,
          };
        }

        let restoredStatus = salon.statusBeforeSoftDelete;
        if (restoredStatus === SalonStatus.ACTIVE) {
          if (salon.verification?.status !== VerificationStatus.APPROVED) {
            restoredStatus = SalonStatus.PENDING;
          } else {
            try {
              // Reuse the current authoritative service/chair/staff readiness rule.
              await this.activation.assertReadyToOpen(salonId);
            } catch {
              restoredStatus = SalonStatus.PENDING;
            }
          }
        }

        await tx.$queryRaw`SELECT set_config('app.fastque_restore_salon_id', ${salonId}, true)`;
        const restored = await tx.salon.update({
          where: { id: salonId },
          data: {
            softDeletedAt: null,
            restoreEligibleUntil: null,
            softDeletedByUserId: null,
            softDeletionRequestId: null,
            statusBeforeSoftDelete: null,
            status: restoredStatus,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'SHOP_DELETE_RESTORED',
            entityType: 'Salon',
            entityId: salonId,
            metadata: {
              requestId: pointer.softDeletionRequestId,
              previousStatus: salon.status,
              restoredStatus,
              originalStatus: salon.statusBeforeSoftDelete,
              restoreEligibleUntil: salon.restoreEligibleUntil.toISOString(),
              shopPublicId: salon.publicId,
            },
          },
        });
        return { kind: 'restored', salon: restored };
      },
    );

    if (decision.kind === 'expired') {
      throw new AppException(
        'RESTORE_WINDOW_EXPIRED',
        'The 30-day restore window has ended. This record remains in read-only Trash.',
        HttpStatus.CONFLICT,
        { restoreEligibleUntil: decision.restoreEligibleUntil.toISOString() },
      );
    }
    if (decision.kind === 'denied') {
      throw new AppException(
        decision.code,
        decision.message,
        HttpStatus.CONFLICT,
      );
    }
    return decision.salon;
  }

  private async lockPendingRequest(tx: Transaction, requestId: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "shop_deletion_requests" WHERE "id" = ${requestId} FOR UPDATE
    `;
    if (!locked.length) {
      throw new AppException(
        'DELETE_REQUEST_NOT_FOUND',
        'Request not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const request = await tx.shopDeletionRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.status !== ShopDeletionRequestStatus.PENDING) {
      throw new AppException(
        'DELETE_REQUEST_CLOSED',
        'Request already resolved.',
        HttpStatus.CONFLICT,
      );
    }
    return request;
  }
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}\n${id}`).toString('base64url');
}

function decodeCursor(value?: string): { at: Date; id: string } | undefined {
  if (!value) return undefined;
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const [timestamp, id, ...extra] = decoded.split('\n');
    const at = new Date(timestamp);
    if (
      extra.length ||
      !id ||
      Number.isNaN(at.getTime()) ||
      at.toISOString() !== timestamp
    ) {
      throw new Error('invalid cursor');
    }
    return { at, id };
  } catch {
    throw new AppException(
      'INVALID_CURSOR',
      'The page cursor is invalid. Refresh and try again.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
