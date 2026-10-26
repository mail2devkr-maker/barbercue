import { createHash, randomBytes } from 'crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  OwnerEvidenceKind,
  OwnerTransferStatus,
  Prisma,
  Role,
  UserStatus,
} from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { PasswordService } from '../auth/services/password.service';
import { EMAIL_SENDER, type EmailSender } from '../auth/services/email-sender';
import { passwordWebBaseUrl } from '../auth/services/password-link';

export const INVITATION_TTL_HOURS = 72;
export const MAX_INVITATIONS = 3;
export const MIN_REINVITE_MINUTES = 10;
export const BREAK_GLASS_COOLDOWN_HOURS = 24;

export const prepareOwnerTransferSchema = z.object({
  newEmail: z.string().trim().toLowerCase().email().max(254),
});
export type PrepareOwnerTransferInput = z.infer<
  typeof prepareOwnerTransferSchema
>;

export const verifyOwnerTransferSchema = z.object({
  // What was actually checked. The server requires BOTH an identity item (government ID or an in-person visit) AND an
  // authority item (business/shop proof or the current owner's written consent). A callback to the shop's public phone
  // number is allowed as supplementary evidence but can never satisfy either requirement.
  evidence: z.array(z.nativeEnum(OwnerEvidenceKind)).min(2).max(5),
  // Who checked what, when and how. Never a document number.
  reference: z.string().trim().min(20).max(300),
  // Only when no second administrator exists. Written, audited, and followed by a cool-down before the invitation.
  breakGlassJustification: z.string().trim().min(50).max(500).optional(),
});
export type VerifyOwnerTransferInput = z.infer<
  typeof verifyOwnerTransferSchema
>;

export const inviteOwnerTransferSchema = z.object({
  // Required when RE-issuing an invitation after the previous one expired: why the recipient is still the right person.
  reference: z.string().trim().min(10).max(300).optional(),
});
export type InviteOwnerTransferInput = z.infer<
  typeof inviteOwnerTransferSchema
>;

export const inspectOwnerInvitationSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export type InspectOwnerInvitationInput = z.infer<
  typeof inspectOwnerInvitationSchema
>;

export const acceptOwnerInvitationSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  // Required only when the destination e-mail has no FastQue account yet; the owner chooses it, nobody else ever sees it.
  password: z.string().min(8).max(72).optional(),
});
export type AcceptOwnerInvitationInput = z.infer<
  typeof acceptOwnerInvitationSchema
>;

export interface OwnerTransferDto {
  id: string;
  salonId: string;
  newEmail: string;
  status: OwnerTransferStatus;
  verificationEvidence: OwnerEvidenceKind[];
  verifiedAt: string | null;
  inviteNotBefore: string | null;
  invitationExpiresAt: string | null;
  invitationCount: number;
  breakGlass: boolean;
  preparedAt: string;
  completedAt: string | null;
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const IDENTITY_KINDS: OwnerEvidenceKind[] = [
  OwnerEvidenceKind.GOVERNMENT_ID,
  OwnerEvidenceKind.IN_PERSON_VISIT,
];
const AUTHORITY_KINDS: OwnerEvidenceKind[] = [
  OwnerEvidenceKind.BUSINESS_OR_SHOP_PROOF,
  OwnerEvidenceKind.CURRENT_OWNER_WRITTEN_CONSENT,
];

/**
 * Administrator-authorized transfer of a shop to a different owner identity.
 *
 * The shop is never deleted or recreated: staff, services, photos, chairs, history and the shop's status stay exactly
 * as they are. Only the owner link moves, in one transaction, and only when the holder of the destination e-mail
 * address accepts a single-use emailed invitation - an administrator typing an address is never treated as proof of
 * anything. Before an invitation can be sent, the person's identity AND authority over the shop must have been checked
 * outside FastQue by an administrator other than the one who prepared the transfer (a single administrator may act
 * alone only through a written, audited break-glass exception followed by a cool-down).
 */
@Injectable()
export class OwnerTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
  ) {}

  private toDto(row: {
    id: string;
    salonId: string;
    newEmail: string;
    status: OwnerTransferStatus;
    verificationEvidence: OwnerEvidenceKind[];
    verifiedAt: Date | null;
    inviteNotBefore: Date | null;
    invitationExpiresAt: Date | null;
    invitationCount: number;
    breakGlassJustification: string | null;
    preparedAt: Date;
    completedAt: Date | null;
  }): OwnerTransferDto {
    return {
      id: row.id,
      salonId: row.salonId,
      newEmail: row.newEmail,
      status: row.status,
      verificationEvidence: row.verificationEvidence,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      inviteNotBefore: row.inviteNotBefore?.toISOString() ?? null,
      invitationExpiresAt: row.invitationExpiresAt?.toISOString() ?? null,
      invitationCount: row.invitationCount,
      breakGlass: row.breakGlassJustification !== null,
      preparedAt: row.preparedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  private fail(code: string, message: string, status: HttpStatus): never {
    throw new AppException(code, message, status);
  }

  async list(salonId: string): Promise<OwnerTransferDto[]> {
    const rows = await this.prisma.salonOwnerTransfer.findMany({
      where: { salonId },
      orderBy: [{ preparedAt: 'desc' }, { id: 'desc' }],
      take: 20,
    });
    return rows.map((row) => this.toDto(row));
  }

  async prepare(
    adminId: string,
    salonId: string,
    input: PrepareOwnerTransferInput,
  ): Promise<OwnerTransferDto> {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { id: true, ownerUserId: true },
    });
    if (!salon) {
      this.fail('SALON_NOT_FOUND', 'Shop not found.', HttpStatus.NOT_FOUND);
    }
    const owners = await this.prisma.userRole.findMany({
      where: { salonId, role: Role.SALON_OWNER },
      select: { userId: true },
    });
    if (owners.length !== 1 || owners[0].userId !== salon.ownerUserId) {
      this.fail(
        'OWNER_TRANSFER_OWNER_UNCLEAR',
        'The shop does not have exactly one current owner, so it cannot be transferred automatically.',
        HttpStatus.CONFLICT,
      );
    }
    // An address that already has an account is allowed only when that account is active and its e-mail was verified
    // (reversal to a previous owner, or one owner taking a second shop). An unverified existing account is refused: it
    // could belong to anyone.
    const existing = await this.prisma.user.findUnique({
      where: { email: input.newEmail },
      select: { id: true, status: true, emailVerifiedAt: true },
    });
    if (existing) {
      if (
        existing.status !== UserStatus.ACTIVE ||
        existing.emailVerifiedAt === null
      ) {
        this.fail(
          'OWNER_TRANSFER_TARGET_UNVERIFIED',
          'That address belongs to an account whose e-mail was never verified or is not active.',
          HttpStatus.CONFLICT,
        );
      }
      if (existing.id === salon.ownerUserId) {
        this.fail(
          'OWNER_TRANSFER_SAME_OWNER',
          'That account already owns this shop.',
          HttpStatus.CONFLICT,
        );
      }
    }
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.salonOwnerTransfer.create({
          data: {
            salonId,
            fromUserId: salon.ownerUserId,
            targetUserId: existing?.id ?? null,
            newEmail: input.newEmail,
            status: OwnerTransferStatus.PREPARED,
            openSlot: 1,
            preparedByAdminId: adminId,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: adminId,
            action: 'SALON_OWNER_TRANSFER_PREPARED',
            entityType: 'SalonOwnerTransfer',
            entityId: created.id,
            metadata: {
              salonId,
              fromUserId: salon.ownerUserId,
              targetsExistingAccount: existing !== null,
            },
          },
        });
        return created;
      });
      return this.toDto(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.fail(
          'OWNER_TRANSFER_OPEN',
          'This shop already has an unfinished transfer. Complete or cancel it first.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async verify(
    adminId: string,
    transferId: string,
    input: VerifyOwnerTransferInput,
  ): Promise<OwnerTransferDto> {
    const transfer = await this.prisma.salonOwnerTransfer.findUnique({
      where: { id: transferId },
    });
    if (!transfer) {
      this.fail(
        'OWNER_TRANSFER_NOT_FOUND',
        'Transfer not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (transfer.status !== OwnerTransferStatus.PREPARED) {
      this.fail(
        'OWNER_TRANSFER_STATE',
        'Only a newly prepared transfer can be verified.',
        HttpStatus.CONFLICT,
      );
    }
    const evidence = Array.from(new Set(input.evidence));
    if (
      !evidence.some((k) => IDENTITY_KINDS.includes(k)) ||
      !evidence.some((k) => AUTHORITY_KINDS.includes(k))
    ) {
      this.fail(
        'OWNER_TRANSFER_EVIDENCE_INSUFFICIENT',
        "Evidence must include an identity check (government ID or in-person visit) and proof of authority over the shop (business/shop proof or the current owner's written consent). A phone callback alone is not enough.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Independent verification: when another active platform administrator exists, they - not the person who prepared
    // the transfer - must confirm. With no second administrator, a written break-glass justification is mandatory and a
    // cool-down delays the invitation.
    const otherAdmins = await this.prisma.userRole.count({
      where: {
        role: Role.PLATFORM_ADMIN,
        userId: { not: transfer.preparedByAdminId },
        user: { status: UserStatus.ACTIVE },
      },
    });
    const samePerson = transfer.preparedByAdminId === adminId;
    if (samePerson && otherAdmins > 0) {
      this.fail(
        'OWNER_TRANSFER_NOT_INDEPENDENT',
        'Another administrator must verify the owner, not the one who prepared the transfer.',
        HttpStatus.FORBIDDEN,
      );
    }
    const breakGlass = samePerson;
    if (breakGlass && !input.breakGlassJustification) {
      this.fail(
        'OWNER_TRANSFER_BREAK_GLASS_REQUIRED',
        'No second administrator exists. A written break-glass justification is required.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const verifiedAt = new Date();
    const inviteNotBefore = breakGlass
      ? new Date(verifiedAt.getTime() + BREAK_GLASS_COOLDOWN_HOURS * 3_600_000)
      : verifiedAt;
    const done = await this.prisma.$transaction(async (tx) => {
      const result = await tx.salonOwnerTransfer.updateMany({
        where: { id: transferId, status: OwnerTransferStatus.PREPARED },
        data: {
          status: OwnerTransferStatus.VERIFIED,
          verificationEvidence: evidence,
          verificationReference: input.reference,
          verifiedByAdminId: adminId,
          verifiedAt,
          breakGlassJustification: breakGlass
            ? input.breakGlassJustification
            : null,
          inviteNotBefore,
        },
      });
      if (result.count !== 1) {
        this.fail(
          'OWNER_TRANSFER_STATE',
          'Only a newly prepared transfer can be verified.',
          HttpStatus.CONFLICT,
        );
      }
      await tx.auditLog.create({
        data: {
          actorUserId: adminId,
          action: 'SALON_OWNER_TRANSFER_VERIFIED',
          entityType: 'SalonOwnerTransfer',
          entityId: transferId,
          metadata: {
            salonId: transfer.salonId,
            evidence,
            reference: input.reference,
            breakGlass,
            breakGlassJustification: breakGlass
              ? input.breakGlassJustification
              : null,
            inviteNotBefore: inviteNotBefore.toISOString(),
          },
        },
      });
      return tx.salonOwnerTransfer.findUniqueOrThrow({
        where: { id: transferId },
      });
    });
    return this.toDto(done);
  }

  async cancel(adminId: string, transferId: string): Promise<OwnerTransferDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const result = await tx.salonOwnerTransfer.updateMany({
        where: {
          id: transferId,
          status: {
            in: [
              OwnerTransferStatus.PREPARED,
              OwnerTransferStatus.VERIFIED,
              OwnerTransferStatus.INVITED,
            ],
          },
        },
        data: {
          status: OwnerTransferStatus.CANCELLED,
          openSlot: null,
          invitationTokenHash: null,
          cancelledAt: new Date(),
        },
      });
      if (result.count !== 1) {
        this.fail(
          'OWNER_TRANSFER_NOT_FOUND',
          'No open transfer found.',
          HttpStatus.NOT_FOUND,
        );
      }
      const updated = await tx.salonOwnerTransfer.findUniqueOrThrow({
        where: { id: transferId },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: adminId,
          action: 'SALON_OWNER_TRANSFER_CANCELLED',
          entityType: 'SalonOwnerTransfer',
          entityId: transferId,
          metadata: { salonId: updated.salonId },
        },
      });
      return updated;
    });
    return this.toDto(row);
  }

  /**
   * Sends (or, after expiry, re-sends) the single-use invitation to the destination address. The token is never
   * returned: only the holder of that inbox can ever see it. Re-issuing is the recovery path for an expired invitation -
   * no second account and no second transfer - and is limited to three invitations, ten minutes apart, each needing a
   * fresh written reason, and each one invalidates the previous token.
   */
  async invite(
    adminId: string,
    transferId: string,
    input: InviteOwnerTransferInput,
  ): Promise<OwnerTransferDto> {
    this.emailSender.assertAvailable();
    const webBase = passwordWebBaseUrl();
    const transfer = await this.prisma.salonOwnerTransfer.findUnique({
      where: { id: transferId },
    });
    if (!transfer) {
      this.fail(
        'OWNER_TRANSFER_NOT_FOUND',
        'Transfer not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const now = new Date();
    const reissue = transfer.status === OwnerTransferStatus.INVITED;
    if (
      transfer.status !== OwnerTransferStatus.VERIFIED &&
      !(
        reissue &&
        (transfer.invitationExpiresAt?.getTime() ?? 0) <= now.getTime()
      )
    ) {
      this.fail(
        'OWNER_TRANSFER_STATE',
        reissue
          ? 'The current invitation has not expired yet.'
          : 'Only a verified transfer can be invited.',
        HttpStatus.CONFLICT,
      );
    }
    if (transfer.inviteNotBefore && transfer.inviteNotBefore > now) {
      this.fail(
        'OWNER_TRANSFER_COOLING_DOWN',
        `This break-glass transfer cannot send an invitation before ${transfer.inviteNotBefore.toISOString()}.`,
        HttpStatus.CONFLICT,
      );
    }
    if (reissue) {
      if (!input.reference) {
        this.fail(
          'OWNER_TRANSFER_REASON_REQUIRED',
          'Re-sending an invitation needs a written reason (for example that the recipient was re-confirmed).',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (transfer.invitationCount >= MAX_INVITATIONS) {
        this.fail(
          'OWNER_TRANSFER_INVITATION_LIMIT',
          'The invitation limit for this transfer was reached. Cancel it and verify again.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (
        transfer.lastInvitedAt &&
        now.getTime() - transfer.lastInvitedAt.getTime() <
          MIN_REINVITE_MINUTES * 60_000
      ) {
        this.fail(
          'OWNER_TRANSFER_TOO_SOON',
          'Wait a few minutes before sending another invitation.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      now.getTime() + INVITATION_TTL_HOURS * 3_600_000,
    );
    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.salonOwnerTransfer.updateMany({
        where: {
          id: transferId,
          status: transfer.status,
          invitationCount: transfer.invitationCount,
        },
        data: {
          status: OwnerTransferStatus.INVITED,
          invitationTokenHash: hashInvitationToken(token),
          invitationExpiresAt: expiresAt,
          invitationCount: { increment: 1 },
          lastInvitedAt: now,
        },
      });
      if (result.count !== 1) {
        this.fail(
          'OWNER_TRANSFER_STATE',
          'The transfer changed while the invitation was prepared. Try again.',
          HttpStatus.CONFLICT,
        );
      }
      await tx.auditLog.create({
        data: {
          actorUserId: adminId,
          action: reissue
            ? 'SALON_OWNER_TRANSFER_REINVITED'
            : 'SALON_OWNER_TRANSFER_INVITED',
          entityType: 'SalonOwnerTransfer',
          entityId: transferId,
          // Never the token.
          metadata: {
            salonId: transfer.salonId,
            invitationNumber: transfer.invitationCount + 1,
            reason: input.reference ?? null,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });
      return tx.salonOwnerTransfer.findUniqueOrThrow({
        where: { id: transferId },
      });
    });

    // The token rides in the URL fragment: browsers never send a fragment to a server, so it cannot reach access logs,
    // proxies, analytics or a Referer header. The page reads it, then removes it from the address bar.
    const url = new URL('/accept-owner-invitation', webBase);
    url.hash = `t=${token}`;
    try {
      await this.emailSender.sendOwnerTransferInvitation(
        transfer.newEmail,
        url.toString(),
        INVITATION_TTL_HOURS,
      );
    } catch (error) {
      // The provider's answer is uncertain: the message may or may not have been delivered. Either way this token must
      // never become usable by accident, so it is invalidated at once (and the attempt still counts toward the limit).
      // The administrator can send a fresh invitation after the ten-minute spacing; at most one link is ever live.
      // The update is guarded by the exact token and the INVITED state, so a transfer that was cancelled or re-invited in
      // the meantime is never touched.
      await this.prisma.salonOwnerTransfer.updateMany({
        where: {
          id: transferId,
          status: OwnerTransferStatus.INVITED,
          invitationTokenHash: hashInvitationToken(token),
        },
        data: { invitationExpiresAt: new Date(), invitationTokenHash: null },
      });
      if (error instanceof AppException) throw error;
      this.fail(
        'OWNER_INVITATION_DELIVERY_FAILED',
        'The invitation e-mail could not be confirmed as sent, so its link was cancelled. Wait ten minutes, then send it again with a written reason.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return this.toDto(claimed);
  }

  /** What the invitation page may show before the recipient commits: shop name and whether a password must be chosen. */
  async inspectInvitation(token: string): Promise<{
    shopName: string;
    email: string;
    needsPassword: boolean;
    expiresAt: string;
  }> {
    const transfer = await this.findOpenInvitation(token);
    const salon = await this.prisma.salon.findUniqueOrThrow({
      where: { id: transfer.salonId },
      select: { name: true },
    });
    return {
      shopName: salon.name,
      email: transfer.newEmail,
      needsPassword: transfer.targetUserId === null,
      expiresAt: transfer.invitationExpiresAt!.toISOString(),
    };
  }

  private async findOpenInvitation(token: string) {
    const transfer = /^[a-f0-9]{64}$/.test(token)
      ? await this.prisma.salonOwnerTransfer.findUnique({
          where: { invitationTokenHash: hashInvitationToken(token) },
        })
      : null;
    // One generic answer for unknown, used, cancelled and expired links alike.
    if (
      !transfer ||
      transfer.status !== OwnerTransferStatus.INVITED ||
      !transfer.invitationExpiresAt ||
      transfer.invitationExpiresAt.getTime() <= Date.now()
    ) {
      this.fail(
        'OWNER_INVITATION_INVALID',
        'This invitation is invalid or has expired. Ask FastQue to send a new one.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return transfer;
  }

  /**
   * The only place ownership actually moves. Reached by the holder of the destination inbox presenting the single-use
   * token. For an existing verified account nothing about its credentials changes; for a new address the recipient
   * chooses their own password and the address is marked verified.
   */
  async acceptInvitation(
    input: AcceptOwnerInvitationInput,
  ): Promise<{ shopName: string }> {
    const open = await this.findOpenInvitation(input.token);
    if (open.targetUserId === null && !input.password) {
      this.fail(
        'OWNER_INVITATION_PASSWORD_REQUIRED',
        'Choose a password to finish creating your account.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const passwordHash = input.password
      ? await this.passwords.hash(input.password)
      : null;

    return this.prisma.$transaction(async (tx) => {
      // Lock the row, then check expiry in the application: comparing a timestamp-without-zone column to now() in SQL
      // would depend on the database session time zone.
      const locked = await tx.$queryRaw<
        { id: string; invitationExpiresAt: Date | null }[]
      >`
        SELECT "id", "invitationExpiresAt" FROM "salon_owner_transfers"
        WHERE "id" = ${open.id}
          AND "status" = 'INVITED'::"OwnerTransferStatus"
          AND "invitationTokenHash" = ${hashInvitationToken(input.token)}
        FOR UPDATE`;
      if (
        locked.length !== 1 ||
        !locked[0].invitationExpiresAt ||
        locked[0].invitationExpiresAt.getTime() <= Date.now()
      ) {
        this.fail(
          'OWNER_INVITATION_INVALID',
          'This invitation is invalid or has expired. Ask FastQue to send a new one.',
          HttpStatus.BAD_REQUEST,
        );
      }
      const salon = await tx.salon.findUniqueOrThrow({
        where: { id: open.salonId },
        select: { id: true, name: true, ownerUserId: true, status: true },
      });
      if (salon.ownerUserId !== open.fromUserId) {
        this.fail(
          'OWNER_TRANSFER_STALE',
          'The shop owner changed after this transfer was prepared. Ask FastQue to prepare a new one.',
          HttpStatus.CONFLICT,
        );
      }

      let newOwnerId: string;
      if (open.targetUserId) {
        const target = await tx.user.findUniqueOrThrow({
          where: { id: open.targetUserId },
          select: {
            id: true,
            status: true,
            emailVerifiedAt: true,
            email: true,
          },
        });
        if (
          target.status !== UserStatus.ACTIVE ||
          target.emailVerifiedAt === null ||
          target.email !== open.newEmail
        ) {
          this.fail(
            'OWNER_TRANSFER_TARGET_UNVERIFIED',
            'The destination account is no longer eligible.',
            HttpStatus.CONFLICT,
          );
        }
        newOwnerId = target.id;
      } else {
        if (
          await tx.user.findUnique({
            where: { email: open.newEmail },
            select: { id: true },
          })
        ) {
          this.fail(
            'OWNER_TRANSFER_EMAIL_IN_USE',
            'That e-mail address now belongs to an account.',
            HttpStatus.CONFLICT,
          );
        }
        const created = await tx.user.create({
          data: {
            email: open.newEmail,
            status: UserStatus.ACTIVE,
            // The recipient just proved control of this inbox by presenting a token that was only ever e-mailed there.
            emailVerifiedAt: new Date(),
            passwordHash,
          },
        });
        newOwnerId = created.id;
      }

      // Exactly one owner role for this shop; the unique key forbids a duplicate.
      await tx.userRole.upsert({
        where: {
          userId_role_salonId: {
            userId: newOwnerId,
            role: Role.SALON_OWNER,
            salonId: open.salonId,
          },
        },
        update: {},
        create: {
          userId: newOwnerId,
          role: Role.SALON_OWNER,
          salonId: open.salonId,
        },
      });
      await tx.salon.update({
        where: { id: open.salonId },
        data: { ownerUserId: newOwnerId },
      });
      // The former account loses every role scoped to THIS shop and nothing else; its roles elsewhere stay.
      const removedRoles = await tx.userRole.deleteMany({
        where: { userId: open.fromUserId, salonId: open.salonId },
      });
      // A staff row the former owner held in this shop moves with the ownership (history keeps pointing at the row),
      // unless the new owner already has one there.
      const alreadyStaff = await tx.salonStaff.count({
        where: { salonId: open.salonId, userId: newOwnerId },
      });
      const movedStaff =
        alreadyStaff === 0
          ? await tx.salonStaff.updateMany({
              where: { salonId: open.salonId, userId: open.fromUserId },
              data: { userId: newOwnerId },
            })
          : { count: 0 };
      // Sessions and unused recovery links of the former account end now.
      const revoked = await tx.refreshToken.updateMany({
        where: { userId: open.fromUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: open.fromUserId, usedAt: null },
        data: { usedAt: new Date() },
      });

      await tx.salonOwnerTransfer.update({
        where: { id: open.id },
        data: {
          status: OwnerTransferStatus.COMPLETED,
          openSlot: null,
          completedAt: new Date(),
          toUserId: newOwnerId,
          invitationTokenHash: null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: newOwnerId,
          action: 'SALON_OWNER_TRANSFER_COMPLETED',
          entityType: 'SalonOwnerTransfer',
          entityId: open.id,
          metadata: {
            salonId: open.salonId,
            fromUserId: open.fromUserId,
            toUserId: newOwnerId,
            createdAccount: open.targetUserId === null,
            shopStatusUnchanged: salon.status,
            removedFormerRoles: removedRoles.count,
            movedStaffRows: movedStaff.count,
            revokedFormerSessions: revoked.count,
          },
        },
      });
      return { shopName: salon.name };
    });
  }
}
