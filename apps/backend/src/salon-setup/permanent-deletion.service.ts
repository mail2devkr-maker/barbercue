import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import {
  PermanentDeletionErrorCode as E,
  Role,
  SessionAudience,
  type PermanentDeletionBlocker,
  type PermanentDeletionConfirmInput,
  type PermanentDeletionKind,
  type PermanentDeletionPreviewDto,
  type PermanentDeletionResultDto,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

/**
 * Issue #378: permanent deletion of ONE chair or ONE staff roster record.
 *
 * Who: only the shop's owner or an authorized platform admin (assertOwnerOrAdminAccess), at preview
 * AND again at confirmation.
 *
 * When: only when the record has NO history and is not in use. Any service session, staff-chair
 * shift, queue entry, booking preference, manual occupancy, inventory usage or verification request
 * blocks deletion, so bookings, invoices, payments and service history keep every reference intact.
 * The database's own foreign keys (restrict) back this up: a reference created by a concurrent
 * request makes the delete fail instead of orphaning history.
 *
 * How: preview (no change) returns a short-lived single-use token bound to the user, shop, kind,
 * target and a fingerprint of the record as shown. Confirmation needs the token, the exact name
 * typed and an explicit acknowledgement; in one transaction it locks the row, re-checks access,
 * the fingerprint and every dependency, deletes and writes an audit entry. A staff deletion removes
 * only this shop's roster record, its skills and working hours, and this shop's staff role. It
 * never deletes the person's User account, other shops' roles or any other data.
 */
const TTL_MS = 5 * 60 * 1000;

interface TokenBody {
  u: string; // user
  s: string; // salon
  k: PermanentDeletionKind;
  t: string; // target id
  f: string; // fingerprint of the record as previewed
  n: string; // nonce
  e: number; // expiry (epoch ms)
}

type Tx = Prisma.TransactionClient;

function key(): Buffer {
  const base = process.env.JWT_ACCESS_SECRET;
  if (!base || base.length < 16) throw new Error('deletion key unavailable');
  return createHmac('sha256', base)
    .update('fastque-permanent-delete-v1')
    .digest();
}
const fingerprint = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');

@Injectable()
export class PermanentDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  // ------------------------------------------------------------------ chairs

  async previewChair(
    userId: string,
    salonId: string,
    chairId: string,
  ): Promise<PermanentDeletionPreviewDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const [salon, chair] = await Promise.all([
      this.salon(salonId),
      this.chairRow(this.prisma, salonId, chairId),
    ]);
    const blockers = await this.chairBlockers(this.prisma, chairId);
    return this.preview(
      userId,
      salonId,
      'chair',
      { id: chair.id, name: chair.label, status: chair.status },
      salon,
      blockers,
      chair,
      {
        effects: [
          `"${chair.label}" is removed from ${salon.name} for good and cannot be restored.`,
          'Your shop will have one chair less for the Live Queue and bookings.',
          'No booking, invoice, payment or service history is touched (a chair with any history cannot be deleted).',
        ],
        alternative:
          'Use "Remove chair" instead: it switches the chair off and keeps its history. You can restore it later.',
      },
    );
  }

  async confirmChair(
    userId: string,
    salonId: string,
    chairId: string,
    input: PermanentDeletionConfirmInput,
  ): Promise<PermanentDeletionResultDto> {
    // Access to THIS shop first: an outsider learns nothing about the token.
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const body = this.openToken(input.token, userId, salonId, 'chair', chairId);
    const label = await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM chairs WHERE id = ${chairId} AND "salonId" = ${salonId} FOR UPDATE`;
        const chair = await this.chairRow(tx, salonId, chairId);
        this.assertSame(body, chair, input.typedName, chair.label);
        const actor = await this.finalGate(tx, userId, salonId, body);
        const blockers = await this.chairBlockers(tx, chairId);
        if (blockers.length) throw this.blocked(blockers);
        await tx.chair.delete({ where: { id: chairId } });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'CHAIR_PERMANENTLY_DELETED',
            entityType: 'Chair',
            entityId: chairId,
            metadata: {
              salonId,
              actor,
              before: { label: chair.label, status: chair.status },
            },
          },
        });
        return chair.label;
      })
      .catch((err) => this.raceSafe(err));
    return {
      kind: 'chair',
      deletedId: chairId,
      name: label,
      message: `${label} was permanently deleted.`,
    };
  }

  private chairRow(db: Tx | PrismaService, salonId: string, chairId: string) {
    return db.chair
      .findFirst({
        where: { id: chairId, salonId },
        select: { id: true, label: true, status: true, updatedAt: true },
      })
      .then((row) => row ?? this.notFound('That chair'));
  }

  private async chairBlockers(
    db: Tx | PrismaService,
    chairId: string,
  ): Promise<PermanentDeletionBlocker[]> {
    const [sessions, active, shifts, queue, manual, manualOpen] =
      await Promise.all([
        db.serviceSession.count({ where: { chairId } }),
        db.serviceSession.count({ where: { chairId, status: 'ACTIVE' } }),
        db.staffChairAssignment.count({ where: { chairId } }),
        db.queueEntry.count({ where: { assignedChairId: chairId } }),
        db.manualChairOccupancy.count({ where: { chairId } }),
        db.manualChairOccupancy.count({ where: { chairId, endedAt: null } }),
      ]);
    return [
      active && {
        code: 'IN_USE',
        count: active,
        message: 'A customer is being served in this chair right now.',
      },
      manualOpen && {
        code: 'OCCUPIED',
        count: manualOpen,
        message: 'This chair is marked occupied right now.',
      },
      sessions && {
        code: 'SERVICE_HISTORY',
        count: sessions,
        message: `This chair has ${sessions} service record(s) in your history.`,
      },
      shifts && {
        code: 'SHIFT_HISTORY',
        count: shifts,
        message: `Staff have worked ${shifts} shift(s) at this chair.`,
      },
      queue && {
        code: 'QUEUE_HISTORY',
        count: queue,
        message: `${queue} queue visit(s) were assigned to this chair.`,
      },
      manual &&
        !manualOpen && {
          code: 'OCCUPANCY_HISTORY',
          count: manual,
          message: `This chair has ${manual} past occupancy record(s).`,
        },
    ].filter(Boolean) as PermanentDeletionBlocker[];
  }

  // ------------------------------------------------------------------ staff

  async previewStaff(
    userId: string,
    salonId: string,
    staffId: string,
  ): Promise<PermanentDeletionPreviewDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const [salon, staff] = await Promise.all([
      this.salon(salonId),
      this.staffRow(this.prisma, salonId, staffId),
    ]);
    const blockers = await this.staffBlockers(
      this.prisma,
      staffId,
      staff.userId,
      userId,
      salon.ownerUserId,
    );
    return this.preview(
      userId,
      salonId,
      'staff',
      { id: staff.id, name: staff.displayName, status: staff.status },
      salon,
      blockers,
      staff,
      {
        effects: [
          `${staff.displayName} is removed from ${salon.name}'s staff list for good and cannot be restored.`,
          `${staff.displayName} can no longer sign in to ${salon.name} as staff. Their FastQue account itself is NOT deleted, and access to any other shop is not affected.`,
          'Their skills and working hours at this shop are deleted with them.',
          'No booking, invoice, payment or service history is touched (staff with any history cannot be deleted).',
        ],
        alternative:
          'Use "Remove access" (stops their login, keeps history) or "Mark not working" instead. Both can be undone.',
      },
    );
  }

  async confirmStaff(
    userId: string,
    salonId: string,
    staffId: string,
    input: PermanentDeletionConfirmInput,
  ): Promise<PermanentDeletionResultDto> {
    // Access to THIS shop first: an outsider learns nothing about the token.
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const body = this.openToken(input.token, userId, salonId, 'staff', staffId);
    const name = await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM salon_staff WHERE id = ${staffId} AND "salonId" = ${salonId} FOR UPDATE`;
        const staff = await this.staffRow(tx, salonId, staffId);
        this.assertSame(body, staff, input.typedName, staff.displayName);
        const actor = await this.finalGate(tx, userId, salonId, body);
        const owner = await tx.salon.findUniqueOrThrow({
          where: { id: salonId },
          select: { ownerUserId: true },
        });
        const blockers = await this.staffBlockers(
          tx,
          staffId,
          staff.userId,
          userId,
          owner.ownerUserId,
        );
        if (blockers.length) throw this.blocked(blockers);
        // Configuration only: skills and weekly hours belong to this roster record.
        await tx.staffService.deleteMany({ where: { staffId } });
        await tx.staffWorkingHours.deleteMany({ where: { staffId } });
        await tx.salonStaff.delete({ where: { id: staffId } });
        // This shop's staff role only (never another shop's, never the User account).
        await tx.userRole.deleteMany({
          where: { userId: staff.userId, salonId, role: Role.SALON_STAFF },
        });
        const stillOperator = await tx.userRole.count({
          where: {
            userId: staff.userId,
            role: { in: [Role.SALON_STAFF, Role.SALON_OWNER] },
          },
        });
        if (stillOperator === 0)
          await tx.refreshToken.updateMany({
            where: {
              userId: staff.userId,
              audience: SessionAudience.STAFF,
              revokedAt: null,
            },
            data: { revokedAt: new Date() },
          });
        await tx.auditLog.create({
          data: {
            actorUserId: userId,
            action: 'STAFF_PERMANENTLY_DELETED',
            entityType: 'SalonStaff',
            entityId: staffId,
            metadata: {
              salonId,
              actor,
              targetUserId: staff.userId,
              before: { displayName: staff.displayName, status: staff.status },
              staffSessionsRevoked: stillOperator === 0,
            },
          },
        });
        return staff.displayName;
      })
      .catch((err) => this.raceSafe(err));
    return {
      kind: 'staff',
      deletedId: staffId,
      name,
      message: `${name} was permanently removed from your staff. Their FastQue account was not deleted.`,
    };
  }

  private staffRow(db: Tx | PrismaService, salonId: string, staffId: string) {
    return db.salonStaff
      .findFirst({
        where: { id: staffId, salonId },
        select: {
          id: true,
          userId: true,
          displayName: true,
          status: true,
          accessRevokedAt: true,
          updatedAt: true,
        },
      })
      .then((row) => row ?? this.notFound('That staff member'));
  }

  private async staffBlockers(
    db: Tx | PrismaService,
    staffId: string,
    staffUserId: string,
    actorId: string,
    ownerUserId: string,
  ): Promise<PermanentDeletionBlocker[]> {
    const [
      sessions,
      active,
      shifts,
      assigned,
      preferredQueue,
      bookings,
      verification,
      usage,
    ] = await Promise.all([
      db.serviceSession.count({ where: { staffId } }),
      db.serviceSession.count({ where: { staffId, status: 'ACTIVE' } }),
      db.staffChairAssignment.count({ where: { staffId } }),
      db.queueEntry.count({ where: { assignedStaffId: staffId } }),
      db.queueEntry.count({ where: { preferredStaffId: staffId } }),
      db.booking.count({ where: { preferredStaffId: staffId } }),
      db.verificationRequest.count({ where: { staffId } }),
      db.serviceUsage.count({ where: { staffId } }),
    ]);
    return [
      staffUserId === actorId && {
        code: 'SELF',
        count: 1,
        message: 'You cannot delete your own staff profile.',
      },
      staffUserId === ownerUserId &&
        staffUserId !== actorId && {
          code: 'OWNER',
          count: 1,
          message: "This is the shop owner's own staff profile.",
        },
      active && {
        code: 'IN_USE',
        count: active,
        message: 'This staff member is serving a customer right now.',
      },
      sessions && {
        code: 'SERVICE_HISTORY',
        count: sessions,
        message: `${sessions} service record(s) in your history name this staff member.`,
      },
      shifts && {
        code: 'SHIFT_HISTORY',
        count: shifts,
        message: `This staff member has ${shifts} chair shift(s) in your history.`,
      },
      assigned && {
        code: 'QUEUE_HISTORY',
        count: assigned,
        message: `${assigned} queue visit(s) were assigned to this staff member.`,
      },
      preferredQueue && {
        code: 'QUEUE_PREFERENCE',
        count: preferredQueue,
        message: `${preferredQueue} queue visit(s) asked for this staff member.`,
      },
      bookings && {
        code: 'BOOKING_HISTORY',
        count: bookings,
        message: `${bookings} booking(s) asked for this staff member.`,
      },
      verification && {
        code: 'VERIFICATION',
        count: verification,
        message: 'A verification request refers to this staff member.',
      },
      usage && {
        code: 'INVENTORY_USAGE',
        count: usage,
        message: `${usage} product-usage record(s) name this staff member.`,
      },
    ].filter(Boolean) as PermanentDeletionBlocker[];
  }

  // ------------------------------------------------------------------ shared

  private async salon(salonId: string) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { id: true, name: true, ownerUserId: true },
    });
    return salon ?? this.notFound('That shop');
  }

  private preview(
    userId: string,
    salonId: string,
    kind: PermanentDeletionKind,
    target: { id: string; name: string; status: string },
    salon: { id: string; name: string },
    blockers: PermanentDeletionBlocker[],
    row: unknown,
    text: { effects: string[]; alternative: string },
  ): PermanentDeletionPreviewDto {
    const base: PermanentDeletionPreviewDto = {
      kind,
      target,
      salon: { id: salon.id, name: salon.name },
      deletable: blockers.length === 0,
      blockers,
      effects: text.effects,
      confirmName: target.name,
      alternative: blockers.length ? text.alternative : null,
    };
    if (blockers.length) return base;
    const exp = Date.now() + TTL_MS;
    const tokenBody: TokenBody = {
      u: userId,
      s: salonId,
      k: kind,
      t: target.id,
      f: fingerprint(row),
      n: randomUUID(),
      e: exp,
    };
    const b = Buffer.from(JSON.stringify(tokenBody)).toString('base64url');
    const sig = createHmac('sha256', key()).update(b).digest('base64url');
    return {
      ...base,
      token: `${b}.${sig}`,
      expiresAt: new Date(exp).toISOString(),
    };
  }

  private openToken(
    token: string,
    userId: string,
    salonId: string,
    kind: PermanentDeletionKind,
    targetId: string,
  ): TokenBody {
    const [b, sig] = token.split('.');
    const bad = () =>
      new AppException(
        E.TOKEN_INVALID,
        'This confirmation is not valid. Nothing was deleted. Open the delete dialog again.',
        HttpStatus.BAD_REQUEST,
      );
    if (!b || !sig) throw bad();
    const expected = createHmac('sha256', key()).update(b).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      throw bad();
    let body: TokenBody;
    try {
      body = JSON.parse(
        Buffer.from(b, 'base64url').toString('utf8'),
      ) as TokenBody;
    } catch {
      throw bad();
    }
    // Bound to this user, this shop, this kind of record and this exact record.
    if (
      body.u !== userId ||
      body.s !== salonId ||
      body.k !== kind ||
      body.t !== targetId
    )
      throw bad();
    if (Date.now() > body.e)
      throw new AppException(
        E.TOKEN_EXPIRED,
        'This confirmation expired. Nothing was deleted. Open the delete dialog again.',
        HttpStatus.GONE,
      );
    return body;
  }

  private assertSame(
    body: TokenBody,
    row: unknown,
    typed: string,
    name: string,
  ) {
    if (fingerprint(row) !== body.f)
      throw new AppException(
        E.STALE,
        'This record changed after you opened the dialog. Nothing was deleted. Please check it and try again.',
        HttpStatus.CONFLICT,
      );
    if (typed.trim() !== name.trim())
      throw new AppException(
        E.NAME_MISMATCH,
        `Type the exact name "${name}" to confirm. Nothing was deleted.`,
        HttpStatus.BAD_REQUEST,
      );
  }

  /**
   * Review fix (PR #380): the LAST check before the delete, inside the same transaction.
   *
   * 1. Access, re-read under row locks: the shop row and the caller's owner/admin role rows are
   *    locked FOR SHARE, so an ownership transfer (updates the shop, moves the owner role) or a
   *    role revocation (deletes the role row) either waits for this transaction or has already
   *    committed and is seen here. A suspended or deleted caller is refused too.
   * 2. Single use, durably: the token's nonce is written to idempotency_keys (primary key) in the
   *    same transaction. A second use - concurrent, on another server instance or after a restart -
   *    hits the key and is refused; if this transaction rolls back nothing was deleted, so the
   *    token correctly remains unused.
   */
  private async finalGate(
    tx: Tx,
    userId: string,
    salonId: string,
    body: TokenBody,
  ): Promise<'OWNER' | 'PLATFORM_ADMIN'> {
    const salon = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM salons WHERE id = ${salonId} FOR SHARE`;
    if (!salon.length) this.notFound('That shop');
    const caller = await tx.$queryRaw<
      { status: string }[]
    >`SELECT status::text AS status FROM users WHERE id = ${userId} FOR SHARE`;
    const roles = await tx.$queryRaw<{ role: string }[]>`
      SELECT role::text AS role FROM user_roles
      WHERE "userId" = ${userId}
        AND (("salonId" = ${salonId} AND role = 'SALON_OWNER') OR ("salonId" IS NULL AND role = 'PLATFORM_ADMIN'))
      FOR SHARE`;
    if (caller[0]?.status !== 'ACTIVE' || roles.length === 0)
      throw new AppException(
        E.ACCESS_CHANGED,
        'Your access to this shop changed, so nothing was deleted.',
        HttpStatus.FORBIDDEN,
      );
    try {
      await tx.idempotencyKey.create({
        data: {
          key: `permanent-delete:${body.n}`,
          endpoint: `permanent-deletion:${body.k}`,
          requestHash: createHash('sha256')
            .update(`${body.u}|${body.s}|${body.t}`)
            .digest('hex'),
          expiresAt: new Date(body.e + 24 * 60 * 60 * 1000),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        throw new AppException(
          E.TOKEN_USED,
          'This confirmation was already used. Nothing more was deleted.',
          HttpStatus.CONFLICT,
        );
      throw err;
    }
    return roles.some((r) => r.role === 'SALON_OWNER')
      ? 'OWNER'
      : 'PLATFORM_ADMIN';
  }

  private blocked(blockers: PermanentDeletionBlocker[]) {
    return new AppException(
      E.BLOCKED,
      `This cannot be permanently deleted: ${blockers.map((b) => b.message).join(' ')} Nothing was deleted.`,
      HttpStatus.CONFLICT,
      { blockers },
    );
  }

  /** A reference created by a concurrent request is refused by the database (restrict): report it plainly. */
  private raceSafe(err: unknown): never {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === 'P2003' || err.code === 'P2014')
    )
      throw new AppException(
        E.BLOCKED,
        'This record was just used by another action, so it cannot be deleted. Nothing was deleted.',
        HttpStatus.CONFLICT,
      );
    throw err;
  }

  private notFound(what: string): never {
    throw new AppException(
      E.NOT_FOUND,
      `${what} was not found in this shop. Nothing was deleted.`,
      HttpStatus.NOT_FOUND,
    );
  }
}
