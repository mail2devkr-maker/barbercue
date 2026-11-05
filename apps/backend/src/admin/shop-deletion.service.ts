import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingStatus,
  LedgerStatus,
  PaymentStatus,
  Prisma,
  QueueEntryStatus,
  RefundStatus,
  SalonStatus,
  ServiceSessionStatus,
  ShopDeletionRequestStatus,
  SubsidyLedgerStatus,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';
import { Role } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { CryptoService } from '../auth/services/crypto.service';
import { TotpService } from '../auth/services/totp.service';
import { SalonActivationService } from '../salon-setup/salon-activation.service';

/**
 * Issue #381 — recoverable shop deletion (forward-port of PR #168's reviewed design).
 *
 *   Co-Founder: preview → reasoned request with the shop name typed back   (nothing changes)
 *   DIFFERENT Super Admin + fresh authenticator code: approve → quarantine (SUSPENDED, read-only)
 *   Super Admin + fresh authenticator code: restore while restoreEligibleUntil is in the future
 *
 * There is NO purge: rows and every child record stay in place. Database triggers (migration
 * 20261105100000) make a quarantined shop read-only, refuse quarantine while operational or money
 * obligations are open, and refuse every hard delete of a shop.
 *
 * Every decision locks in the same order — actor user + role → request → salon — so concurrent
 * approve / reject / restore calls serialise instead of deadlocking, and duplicate approvals of the
 * same request resolve to exactly one winner (the loser sees DELETE_REQUEST_CLOSED).
 */
export const RECOVERY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 50;
/** An authenticator code is accepted ONCE per user within this window (it covers otplib's ±30 s). */
const TOTP_REPLAY_WINDOW_SECONDS = 120;

type Tx = Prisma.TransactionClient;

export type ObligationBlocker =
  | 'PENDING_OR_CONFIRMED_BOOKING'
  | 'ACTIVE_QUEUE_ENTRY'
  | 'ACTIVE_SERVICE_SESSION'
  | 'ACTIVE_MANUAL_CHAIR_OCCUPANCY'
  | 'PENDING_PAYMENT'
  | 'PENDING_REFUND'
  | 'OUTSTANDING_CUSTOMER_LEDGER'
  | 'OUTSTANDING_PLATFORM_SUBSIDY';

type Denied = {
  kind: 'denied';
  code: string;
  message: string;
  details?: unknown;
};

@Injectable()
export class ShopDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly totp: TotpService,
    private readonly activation: SalonActivationService,
  ) {}

  // ------------------------------------------------------------------ Co-Founder

  /** What a deletion would mean for this shop. Read-only; Co-Founder and Super Admin. */
  async preview(salonId: string) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        id: true,
        name: true,
        publicId: true,
        status: true,
        softDeletedAt: true,
        restoreEligibleUntil: true,
        _count: {
          select: { chairs: true, services: true, staff: true, bookings: true },
        },
      },
    });
    if (!salon) throw notFound();
    const [blockers, pending] = await Promise.all([
      this.findOpenObligations(this.prisma, salonId),
      this.prisma.shopDeletionRequest.findFirst({
        where: { salonId, status: ShopDeletionRequestStatus.PENDING },
        select: { id: true, requestedAt: true },
      }),
    ]);
    return {
      shop: {
        id: salon.id,
        name: salon.name,
        publicId: salon.publicId,
        status: salon.status,
        inTrash: !!salon.softDeletedAt,
        restoreEligibleUntil: salon.restoreEligibleUntil?.toISOString() ?? null,
      },
      keptRecords: {
        chairs: salon._count.chairs,
        services: salon._count.services,
        staff: salon._count.staff,
        bookings: salon._count.bookings,
      },
      blockers,
      pendingRequest: pending
        ? { id: pending.id, requestedAt: pending.requestedAt.toISOString() }
        : null,
      recoveryWindowDays: RECOVERY_WINDOW_MS / 86_400_000,
      consequences: [
        'Nothing is deleted. A different Super Admin must approve with a fresh authenticator code.',
        'After approval the shop is suspended: it disappears from customers, takes no bookings or queue joins, and becomes read-only.',
        'All history (bookings, payments, staff, reviews, audit) is kept.',
        `A Super Admin can restore the shop for ${RECOVERY_WINDOW_MS / 86_400_000} days. After that it stays in read-only Trash; nothing is purged automatically.`,
      ],
    };
  }

  async request(
    actorUserId: string,
    salonId: string,
    input: { reason: string; typedShopName: string },
  ) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.lockActorWithRole(tx, actorUserId, Role.CO_FOUNDER);
      const salon = await this.lockSalon(tx, salonId);
      if (salon.softDeletedAt) {
        return deny(
          'SHOP_ALREADY_QUARANTINED',
          'This shop is already in recovery Trash.',
        );
      }
      if (normaliseName(input.typedShopName) !== normaliseName(salon.name)) {
        return deny(
          'SHOP_NAME_MISMATCH',
          'Type the shop name exactly as shown to confirm.',
          HttpStatus.BAD_REQUEST,
        );
      }
      const pending = await tx.shopDeletionRequest.findFirst({
        where: { salonId, status: ShopDeletionRequestStatus.PENDING },
        select: { id: true },
      });
      if (pending) {
        return deny(
          'SHOP_DELETE_ALREADY_REQUESTED',
          'A deletion request for this shop is already awaiting Super Admin approval.',
        );
      }
      const created = await tx.shopDeletionRequest.create({
        data: {
          salonId,
          shopName: salon.name,
          shopPublicId: salon.publicId,
          requestedByUserId: actorUserId,
          reason: input.reason.trim(),
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
      return { kind: 'ok' as const, value: created };
    });
    return unwrap(outcome);
  }

  // ------------------------------------------------------------------ Super Admin reads

  async list(input: { cursor?: string; status?: string } = {}) {
    const cursor = decodeCursor(input.cursor);
    const allowed = ['PENDING', 'APPROVED', 'REJECTED', 'RESOLVED'];
    if (input.status && !allowed.includes(input.status)) {
      throw new AppException(
        'INVALID_DELETION_REQUEST_STATUS',
        'The deletion request status filter is invalid.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const status: Prisma.ShopDeletionRequestWhereInput['status'] =
      input.status === 'RESOLVED'
        ? {
            in: [
              ShopDeletionRequestStatus.APPROVED,
              ShopDeletionRequestStatus.REJECTED,
            ],
          }
        : (input.status as ShopDeletionRequestStatus | undefined);
    const rows = await this.prisma.shopDeletionRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(cursor
          ? {
              OR: [
                { requestedAt: { lt: cursor.at } },
                { requestedAt: cursor.at, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
    });
    const items = rows.slice(0, PAGE_SIZE);
    const emails = await this.emailsFor(
      items.flatMap((r) => [r.requestedByUserId, r.decidedByUserId]),
    );
    const last = items[items.length - 1];
    return {
      items: items.map((r) => ({
        ...r,
        requestedByEmail: emails.get(r.requestedByUserId) ?? null,
        decidedByEmail: r.decidedByUserId
          ? (emails.get(r.decidedByUserId) ?? null)
          : null,
      })),
      nextCursor:
        rows.length > PAGE_SIZE && last
          ? encodeCursor(last.requestedAt, last.id)
          : null,
    };
  }

  async listTrash(input: { cursor?: string } = {}) {
    const cursor = decodeCursor(input.cursor);
    const rows = await this.prisma.salon.findMany({
      where: {
        softDeletedAt: { not: null },
        ...(cursor
          ? {
              OR: [
                { softDeletedAt: { lt: cursor.at } },
                { softDeletedAt: cursor.at, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
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
    const items = rows.slice(0, PAGE_SIZE);
    const emails = await this.emailsFor(
      items.map((r) => r.softDeletedByUserId),
    );
    const now = Date.now();
    const last = items[items.length - 1];
    return {
      items: items.map((s) => {
        const until = s.restoreEligibleUntil?.getTime() ?? 0;
        return {
          ...s,
          deletedByEmail: s.softDeletedByUserId
            ? (emails.get(s.softDeletedByUserId) ?? null)
            : null,
          remainingMs: Math.max(0, until - now),
          restoreExpired: until <= now,
        };
      }),
      nextCursor:
        rows.length > PAGE_SIZE && last?.softDeletedAt
          ? encodeCursor(last.softDeletedAt, last.id)
          : null,
    };
  }

  // ------------------------------------------------------------------ Super Admin decisions

  async approve(
    actorUserId: string,
    requestId: string,
    totpCode: string,
    note?: string,
  ) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const actor = await this.lockActorWithRole(
        tx,
        actorUserId,
        Role.PLATFORM_ADMIN,
      );
      const totp = await this.consumeFreshTotp(
        tx,
        actor,
        totpCode,
        'approve',
        requestId,
      );
      if (totp) return totp;
      const request = await this.lockPendingRequest(tx, requestId);
      if (request.requestedByUserId === actorUserId) {
        return deny(
          'SELF_APPROVAL_FORBIDDEN',
          'The person who requested a deletion cannot approve it. Another Super Admin must decide.',
          HttpStatus.FORBIDDEN,
        );
      }
      const salon = await this.lockSalon(tx, request.salonId);
      if (salon.softDeletedAt) {
        return deny(
          'SHOP_ALREADY_QUARANTINED',
          'This shop is already in recovery Trash.',
        );
      }
      const blockers = await this.findOpenObligations(tx, request.salonId);
      if (blockers.length) {
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'SHOP_DELETE_DENIED',
            entityType: 'Salon',
            entityId: request.salonId,
            metadata: {
              requestId,
              reasonCode: 'SHOP_HAS_OPEN_OBLIGATIONS',
              blockers,
            },
          },
        });
        return {
          kind: 'denied' as const,
          code: 'SHOP_HAS_OPEN_OBLIGATIONS',
          message:
            'Resolve current bookings, queue work and unsettled amounts before this shop can move to Trash.',
          details: { blockers },
          audit: true,
        };
      }

      const deletedAt = new Date();
      const restoreEligibleUntil = new Date(
        deletedAt.getTime() + RECOVERY_WINDOW_MS,
      );
      await tx.salon.update({
        where: { id: request.salonId },
        data: {
          softDeletedAt: deletedAt,
          restoreEligibleUntil,
          softDeletedByUserId: actorUserId,
          softDeletionRequestId: request.id,
          statusBeforeSoftDelete: salon.status,
          // Every existing status-only reader immediately stops treating the shop as operational.
          status: SalonStatus.SUSPENDED,
        },
      });
      // Prisma can resolve an interactive transaction callback even when a DEFERRED constraint later
      // rejects COMMIT; force the obligations guard now so success is never reported for a rollback.
      await tx.$executeRaw`SET CONSTRAINTS "salons_quarantine_obligations_guard" IMMEDIATE`;
      const updated = await tx.shopDeletionRequest.update({
        where: { id: requestId },
        data: {
          status: ShopDeletionRequestStatus.APPROVED,
          decidedByUserId: actorUserId,
          decidedAt: deletedAt,
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
            previousStatus: salon.status,
            newStatus: SalonStatus.SUSPENDED,
            restoreEligibleUntil: restoreEligibleUntil.toISOString(),
          },
        },
      });
      return {
        kind: 'ok' as const,
        value: {
          request: updated,
          shopName: salon.name,
          restoreEligibleUntil: restoreEligibleUntil.toISOString(),
        },
      };
    });
    return unwrap(outcome);
  }

  async reject(
    actorUserId: string,
    requestId: string,
    totpCode: string,
    note: string,
  ) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const actor = await this.lockActorWithRole(
        tx,
        actorUserId,
        Role.PLATFORM_ADMIN,
      );
      const totp = await this.consumeFreshTotp(
        tx,
        actor,
        totpCode,
        'reject',
        requestId,
      );
      if (totp) return totp;
      const request = await this.lockPendingRequest(tx, requestId);
      if (request.requestedByUserId === actorUserId) {
        return deny(
          'SELF_APPROVAL_FORBIDDEN',
          'The person who requested a deletion cannot decide it. Another Super Admin must decide.',
          HttpStatus.FORBIDDEN,
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
      return { kind: 'ok' as const, value: updated };
    });
    return unwrap(outcome);
  }

  async restore(actorUserId: string, salonId: string, totpCode: string) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const actor = await this.lockActorWithRole(
        tx,
        actorUserId,
        Role.PLATFORM_ADMIN,
      );
      const totp = await this.consumeFreshTotp(
        tx,
        actor,
        totpCode,
        'restore',
        salonId,
      );
      if (totp) return totp;
      // Discover the request id without locking the salon, then follow actor → request → salon.
      const pointer = await tx.salon.findUnique({
        where: { id: salonId },
        select: { softDeletionRequestId: true },
      });
      if (!pointer) throw notFound();
      if (!pointer.softDeletionRequestId) {
        return deny('SHOP_NOT_IN_TRASH', 'This shop is not in recovery Trash.');
      }
      await tx.$queryRaw`
        SELECT "id" FROM "shop_deletion_requests" WHERE "id" = ${pointer.softDeletionRequestId} FOR UPDATE`;
      const salon = await this.lockSalon(tx, salonId);
      if (
        !salon.softDeletedAt ||
        !salon.restoreEligibleUntil ||
        !salon.statusBeforeSoftDelete ||
        salon.softDeletionRequestId !== pointer.softDeletionRequestId
      ) {
        return deny('SHOP_NOT_IN_TRASH', 'This shop is not in recovery Trash.');
      }
      if (Date.now() >= salon.restoreEligibleUntil.getTime()) {
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'SHOP_DELETE_RESTORE_EXPIRED',
            entityType: 'Salon',
            entityId: salonId,
            metadata: {
              requestId: salon.softDeletionRequestId,
              restoreEligibleUntil: salon.restoreEligibleUntil.toISOString(),
            },
          },
        });
        return {
          kind: 'denied' as const,
          code: 'RESTORE_WINDOW_EXPIRED',
          message:
            'The 30-day restore window has ended. The shop stays in read-only Trash; nothing was purged.',
          details: {
            restoreEligibleUntil: salon.restoreEligibleUntil.toISOString(),
          },
          audit: true,
        };
      }

      // A shop only comes back ACTIVE when it still passes the current activation rules.
      let restoredStatus = salon.statusBeforeSoftDelete;
      if (restoredStatus === SalonStatus.ACTIVE) {
        const verification = await tx.verificationRequest.findUnique({
          where: { salonId },
          select: { status: true },
        });
        if (verification?.status !== VerificationStatus.APPROVED) {
          restoredStatus = SalonStatus.PENDING;
        } else {
          try {
            await this.activation.assertReadyToOpen(salonId, tx);
          } catch {
            restoredStatus = SalonStatus.PENDING;
          }
        }
      }

      // The ONLY path allowed past the quarantine update guard: a transaction-local marker naming
      // exactly this shop (it cannot leak to other transactions on a pooled connection).
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
        select: { id: true, name: true, publicId: true, status: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'SHOP_DELETE_RESTORED',
          entityType: 'Salon',
          entityId: salonId,
          metadata: {
            requestId: pointer.softDeletionRequestId,
            originalStatus: salon.statusBeforeSoftDelete,
            restoredStatus,
            restoreEligibleUntil: salon.restoreEligibleUntil.toISOString(),
            shopPublicId: salon.publicId,
          },
        },
      });
      return { kind: 'ok' as const, value: restored };
    });
    return unwrap(outcome);
  }

  // ------------------------------------------------------------------ internals

  /** Locks the actor's user row and the GLOBAL role row; a suspended or demoted actor is refused. */
  private async lockActorWithRole(tx: Tx, userId: string, role: Role) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT u."id" FROM "users" AS u
      INNER JOIN "user_roles" AS r ON r."userId" = u."id"
      WHERE u."id" = ${userId} AND u."status" = 'ACTIVE'
        AND r."role"::text = ${role} AND r."salonId" IS NULL
      FOR UPDATE OF u, r`;
    const actor = locked.length
      ? await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            status: true,
            twoFactorEnabled: true,
            totpSecret: true,
          },
        })
      : null;
    if (!actor || actor.status !== UserStatus.ACTIVE) {
      const admin = role === Role.PLATFORM_ADMIN;
      throw new AppException(
        admin ? 'PLATFORM_ADMIN_REQUIRED' : 'CO_FOUNDER_REQUIRED',
        admin ? 'Super Admin access required.' : 'Co-Founder access required.',
        HttpStatus.FORBIDDEN,
      );
    }
    return actor;
  }

  /**
   * Verifies a CURRENT authenticator code and records it so the same code can never authorise a
   * second decision (approve → restore replay, double submit). Returns a denial instead of throwing so
   * the surrounding transaction stays usable; `ON CONFLICT` keeps a replay from aborting it.
   */
  private async consumeFreshTotp(
    tx: Tx,
    actor: { id: string; twoFactorEnabled: boolean; totpSecret: string | null },
    code: string,
    decision: 'approve' | 'reject' | 'restore',
    subjectId: string,
  ): Promise<Denied | null> {
    // Refused codes are audited too (committed with the denial): repeated failures are visible.
    const refuse = async (
      reasonCode: string,
      message: string,
      status: HttpStatus,
    ) => {
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: 'SHOP_DELETE_TOTP_REFUSED',
          entityType: decision === 'restore' ? 'Salon' : 'ShopDeletionRequest',
          entityId: subjectId,
          metadata: { decision, reasonCode },
        },
      });
      return deny(reasonCode, message, status);
    };
    if (!actor.twoFactorEnabled || !actor.totpSecret) {
      return refuse(
        'TOTP_SETUP_REQUIRED',
        'Set up your authenticator first.',
        HttpStatus.FORBIDDEN,
      );
    }
    let secret: string;
    try {
      secret = this.crypto.decrypt(actor.totpSecret);
    } catch {
      return refuse(
        'TOTP_SETUP_REQUIRED',
        'Your authenticator must be re-enrolled.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!(await this.totp.verifyToken(secret, code))) {
      return refuse(
        'TOTP_INVALID',
        'That authenticator code is not valid. Enter the current code.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const key = `shop-deletion-totp:${actor.id}:${code}`;
    const fresh = await tx.$queryRaw<Array<{ key: string }>>`
      INSERT INTO "idempotency_keys" ("key", "endpoint", "requestHash", "createdAt", "expiresAt")
      VALUES (${key}, 'shop-deletion:totp', 'used', now(), now() + make_interval(secs => ${TOTP_REPLAY_WINDOW_SECONDS}))
      ON CONFLICT ("key") DO UPDATE
        SET "createdAt" = now(), "expiresAt" = EXCLUDED."expiresAt"
        WHERE "idempotency_keys"."expiresAt" <= now()
      RETURNING "key"`;
    if (!fresh.length) {
      return refuse(
        'TOTP_ALREADY_USED',
        'That authenticator code was already used. Wait for the next code.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return null;
  }

  private async lockPendingRequest(tx: Tx, requestId: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "shop_deletion_requests" WHERE "id" = ${requestId} FOR UPDATE`;
    if (!locked.length) {
      throw new AppException(
        'DELETE_REQUEST_NOT_FOUND',
        'Request not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const request = await tx.shopDeletionRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    if (request.status !== ShopDeletionRequestStatus.PENDING) {
      throw new AppException(
        'DELETE_REQUEST_CLOSED',
        'This request has already been decided.',
        HttpStatus.CONFLICT,
      );
    }
    return request;
  }

  private async lockSalon(tx: Tx, salonId: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "salons" WHERE "id" = ${salonId} FOR UPDATE`;
    if (!locked.length) throw notFound();
    return tx.salon.findUniqueOrThrow({
      where: { id: salonId },
      select: {
        id: true,
        name: true,
        publicId: true,
        status: true,
        softDeletedAt: true,
        restoreEligibleUntil: true,
        softDeletionRequestId: true,
        statusBeforeSoftDelete: true,
      },
    });
  }

  async findOpenObligations(
    db: Tx | PrismaService,
    salonId: string,
  ): Promise<ObligationBlocker[]> {
    const [
      booking,
      queue,
      session,
      occupancy,
      payment,
      refund,
      ledger,
      subsidy,
    ] = await Promise.all([
      db.booking.findFirst({
        where: {
          salonId,
          status: {
            in: [BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED],
          },
        },
        select: { id: true },
      }),
      db.queueEntry.findFirst({
        where: {
          salonId,
          status: {
            in: [
              QueueEntryStatus.WAITING,
              QueueEntryStatus.CALLED,
              QueueEntryStatus.IN_SERVICE,
            ],
          },
        },
        select: { id: true },
      }),
      db.serviceSession.findFirst({
        where: { status: ServiceSessionStatus.ACTIVE, queueEntry: { salonId } },
        select: { id: true },
      }),
      db.manualChairOccupancy.findFirst({
        where: { salonId, endedAt: null },
        select: { id: true },
      }),
      db.payment.findFirst({
        where: {
          status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] },
          booking: { salonId },
        },
        select: { id: true },
      }),
      db.refund.findFirst({
        where: {
          status: RefundStatus.INITIATED,
          payment: { booking: { salonId } },
        },
        select: { id: true },
      }),
      db.customerLedgerEntry.findFirst({
        where: { salonId, status: LedgerStatus.OUTSTANDING },
        select: { id: true },
      }),
      db.platformShopSubsidyEntry.findFirst({
        where: { salonId, status: SubsidyLedgerStatus.OUTSTANDING },
        select: { id: true },
      }),
    ]);
    const out: ObligationBlocker[] = [];
    if (booking) out.push('PENDING_OR_CONFIRMED_BOOKING');
    if (queue) out.push('ACTIVE_QUEUE_ENTRY');
    if (session) out.push('ACTIVE_SERVICE_SESSION');
    if (occupancy) out.push('ACTIVE_MANUAL_CHAIR_OCCUPANCY');
    if (payment) out.push('PENDING_PAYMENT');
    if (refund) out.push('PENDING_REFUND');
    if (ledger) out.push('OUTSTANDING_CUSTOMER_LEDGER');
    if (subsidy) out.push('OUTSTANDING_PLATFORM_SUBSIDY');
    return out;
  }

  private async emailsFor(ids: Array<string | null>) {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return new Map<string, string | null>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, email: true },
    });
    return new Map(users.map((u) => [u.id, u.email]));
  }
}

function deny(code: string, message: string, status = HttpStatus.CONFLICT) {
  return { kind: 'denied' as const, code, message, status };
}

/**
 * Denials are RETURNED from the transaction (so audit rows written alongside them commit) and only
 * thrown here, after the transaction has finished.
 */
function unwrap<T>(
  outcome:
    | { kind: 'ok'; value: T }
    | {
        kind: 'denied';
        code: string;
        message: string;
        status?: HttpStatus;
        details?: unknown;
      },
): T {
  if (outcome.kind === 'ok') return outcome.value;
  throw new AppException(
    outcome.code,
    outcome.message,
    outcome.status ?? HttpStatus.CONFLICT,
    outcome.details as Record<string, unknown> | undefined,
  );
}

function notFound() {
  return new AppException(
    'SALON_NOT_FOUND',
    'Shop not found.',
    HttpStatus.NOT_FOUND,
  );
}

function normaliseName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-IN');
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}\n${id}`).toString('base64url');
}

function decodeCursor(value?: string): { at: Date; id: string } | undefined {
  if (!value) return undefined;
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  const [timestamp, id, ...extra] = decoded.split('\n');
  const at = new Date(timestamp ?? '');
  if (
    extra.length ||
    !id ||
    Number.isNaN(at.getTime()) ||
    at.toISOString() !== timestamp
  ) {
    throw new AppException(
      'INVALID_CURSOR',
      'The page cursor is invalid. Refresh and try again.',
      HttpStatus.BAD_REQUEST,
    );
  }
  return { at, id };
}
