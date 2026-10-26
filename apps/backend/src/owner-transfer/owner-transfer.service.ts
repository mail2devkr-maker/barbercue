import { randomInt } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  OwnerTransferStatus,
  OwnerVerificationMethod,
  Prisma,
  Role,
  UserStatus,
} from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { PasswordService } from '../auth/services/password.service';

export const prepareOwnerTransferSchema = z.object({
  newEmail: z.string().trim().toLowerCase().email().max(254),
});
export type PrepareOwnerTransferInput = z.infer<
  typeof prepareOwnerTransferSchema
>;

export const verifyOwnerTransferSchema = z.object({
  method: z.nativeEnum(OwnerVerificationMethod),
  // What was checked, by whom, and how (never a document number or a password). Kept in the audit trail.
  reference: z.string().trim().min(10).max(200),
  // REGISTERED_PHONE_CALLBACK only: the last four digits of the number that was actually called. It must match the
  // phone FastQue holds for the shop, so a callback to some other number cannot be recorded as verification.
  registeredPhoneLast4: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
});
export type VerifyOwnerTransferInput = z.infer<
  typeof verifyOwnerTransferSchema
>;

export interface OwnerTransferDto {
  id: string;
  salonId: string;
  newEmail: string;
  status: OwnerTransferStatus;
  verificationMethod: OwnerVerificationMethod | null;
  verifiedAt: string | null;
  preparedAt: string;
  completedAt: string | null;
}

export interface ExecutedOwnerTransferDto extends OwnerTransferDto {
  newOwnerUserId: string;
  /** Shown exactly once. Never stored in plain text and never logged. */
  temporaryPassword: string;
  temporaryPasswordExpiresAt: string;
}

export const TEMPORARY_PASSWORD_HOURS = 72;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function generateTemporaryPassword(): string {
  const pick = () => ALPHABET[randomInt(ALPHABET.length)];
  const group = () => Array.from({ length: 5 }, pick).join('');
  return [group(), group(), group(), group()].join('-');
}

/**
 * Administrator-authorized transfer of a shop to a different owner identity.
 *
 * The shop is never deleted or recreated: staff, services, photos, chairs, history and the shop's status stay exactly
 * as they are. Only the owner link moves, in one transaction, and only after the new owner's identity was verified
 * outside FastQue (offline document or a callback to the phone FastQue already holds for the shop) - the administrator
 * has no access to the owner's inbox, so no e-mail round trip is ever treated as proof.
 */
@Injectable()
export class OwnerTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  private toDto(row: {
    id: string;
    salonId: string;
    newEmail: string;
    status: OwnerTransferStatus;
    verificationMethod: OwnerVerificationMethod | null;
    verifiedAt: Date | null;
    preparedAt: Date;
    completedAt: Date | null;
  }): OwnerTransferDto {
    return {
      id: row.id,
      salonId: row.salonId,
      newEmail: row.newEmail,
      status: row.status,
      verificationMethod: row.verificationMethod,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
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
    if (!salon)
      this.fail('SALON_NOT_FOUND', 'Shop not found.', HttpStatus.NOT_FOUND);
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
    const taken = await this.prisma.user.findUnique({
      where: { email: input.newEmail },
      select: { id: true },
    });
    if (taken) {
      this.fail(
        'OWNER_TRANSFER_EMAIL_IN_USE',
        'That e-mail address already belongs to an account. Use an address that has no FastQue account yet.',
        HttpStatus.CONFLICT,
      );
    }
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.salonOwnerTransfer.create({
          data: {
            salonId,
            fromUserId: salon.ownerUserId,
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
            metadata: { salonId, fromUserId: salon.ownerUserId },
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
      include: { salon: { select: { phone: true } } },
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
    // Independent verification: when another active platform administrator exists, they - not the person who prepared
    // the transfer - must be the one who confirms the owner's identity.
    if (transfer.preparedByAdminId === adminId) {
      const otherAdmins = await this.prisma.userRole.count({
        where: {
          role: Role.PLATFORM_ADMIN,
          userId: { not: adminId },
          user: { status: UserStatus.ACTIVE },
        },
      });
      if (otherAdmins > 0) {
        this.fail(
          'OWNER_TRANSFER_NOT_INDEPENDENT',
          'Another administrator must verify the owner, not the one who prepared the transfer.',
          HttpStatus.FORBIDDEN,
        );
      }
    }
    if (input.method === OwnerVerificationMethod.REGISTERED_PHONE_CALLBACK) {
      const registered = (transfer.salon.phone ?? '').replace(/\D/g, '');
      if (registered.length < 4 || !input.registeredPhoneLast4) {
        this.fail(
          'OWNER_TRANSFER_PHONE_UNVERIFIABLE',
          'A phone callback needs the shop to have a registered phone and the last four digits of the number called.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (registered.slice(-4) !== input.registeredPhoneLast4) {
        this.fail(
          'OWNER_TRANSFER_PHONE_MISMATCH',
          'That is not the phone number registered for this shop.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }
    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.salonOwnerTransfer.updateMany({
        where: { id: transferId, status: OwnerTransferStatus.PREPARED },
        data: {
          status: OwnerTransferStatus.VERIFIED,
          verificationMethod: input.method,
          verificationReference: input.reference,
          verifiedByAdminId: adminId,
          verifiedAt: new Date(),
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
            method: input.method,
            reference: input.reference,
            sameAdminAsPreparer: transfer.preparedByAdminId === adminId,
          },
        },
      });
      return tx.salonOwnerTransfer.findUniqueOrThrow({
        where: { id: transferId },
      });
    });
    return this.toDto(claimed);
  }

  async cancel(adminId: string, transferId: string): Promise<OwnerTransferDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      const result = await tx.salonOwnerTransfer.updateMany({
        where: {
          id: transferId,
          status: {
            in: [OwnerTransferStatus.PREPARED, OwnerTransferStatus.VERIFIED],
          },
        },
        data: {
          status: OwnerTransferStatus.CANCELLED,
          openSlot: null,
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

  async execute(
    adminId: string,
    transferId: string,
  ): Promise<ExecutedOwnerTransferDto> {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const expiresAt = new Date(
      Date.now() + TEMPORARY_PASSWORD_HOURS * 3_600_000,
    );

    const done = await this.prisma.$transaction(async (tx) => {
      // Lock the row first: a transfer completes at most once, and only after verification. A concurrent execute waits
      // here and then finds it COMPLETED.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "salon_owner_transfers"
        WHERE "id" = ${transferId} AND "status" = 'VERIFIED'::"OwnerTransferStatus"
        FOR UPDATE`;
      if (locked.length !== 1) {
        this.fail(
          'OWNER_TRANSFER_STATE',
          'Only a verified transfer can be completed, and only once.',
          HttpStatus.CONFLICT,
        );
      }
      const transfer = await tx.salonOwnerTransfer.findUniqueOrThrow({
        where: { id: transferId },
      });
      const salon = await tx.salon.findUniqueOrThrow({
        where: { id: transfer.salonId },
        select: { id: true, ownerUserId: true, status: true },
      });
      if (salon.ownerUserId !== transfer.fromUserId) {
        this.fail(
          'OWNER_TRANSFER_STALE',
          'The shop owner changed after this transfer was prepared. Prepare a new one.',
          HttpStatus.CONFLICT,
        );
      }
      if (
        await tx.user.findUnique({
          where: { email: transfer.newEmail },
          select: { id: true },
        })
      ) {
        this.fail(
          'OWNER_TRANSFER_EMAIL_IN_USE',
          'That e-mail address now belongs to an account.',
          HttpStatus.CONFLICT,
        );
      }

      const newOwner = await tx.user.create({
        data: {
          email: transfer.newEmail,
          status: UserStatus.ACTIVE,
          // The administrator cannot read the inbox, so the address is NOT marked verified by this transfer.
          passwordHash,
          passwordChangeRequired: true,
          temporaryPasswordExpiresAt: expiresAt,
        },
      });
      await tx.userRole.create({
        data: {
          userId: newOwner.id,
          role: Role.SALON_OWNER,
          salonId: transfer.salonId,
        },
      });
      await tx.salon.update({
        where: { id: transfer.salonId },
        data: { ownerUserId: newOwner.id },
      });

      // The former account loses every role scoped to THIS shop and nothing else; its own rows elsewhere stay.
      const removedRoles = await tx.userRole.deleteMany({
        where: { userId: transfer.fromUserId, salonId: transfer.salonId },
      });
      // A staff row the former owner held in this shop moves with the ownership; history keeps pointing at the row.
      const movedStaff = await tx.salonStaff.updateMany({
        where: { salonId: transfer.salonId, userId: transfer.fromUserId },
        data: { userId: newOwner.id },
      });
      // Sessions and unused recovery links of the former account end now.
      const revoked = await tx.refreshToken.updateMany({
        where: { userId: transfer.fromUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: transfer.fromUserId, usedAt: null },
        data: { usedAt: new Date() },
      });

      const completed = await tx.salonOwnerTransfer.update({
        where: { id: transferId },
        data: {
          status: OwnerTransferStatus.COMPLETED,
          openSlot: null,
          completedAt: new Date(),
          toUserId: newOwner.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: adminId,
          action: 'SALON_OWNER_TRANSFER_COMPLETED',
          entityType: 'SalonOwnerTransfer',
          entityId: transferId,
          metadata: {
            salonId: transfer.salonId,
            fromUserId: transfer.fromUserId,
            toUserId: newOwner.id,
            shopStatusUnchanged: salon.status,
            removedFormerRoles: removedRoles.count,
            movedStaffRows: movedStaff.count,
            revokedFormerSessions: revoked.count,
          },
        },
      });
      return { completed, newOwnerId: newOwner.id };
    });

    return {
      ...this.toDto(done.completed),
      newOwnerUserId: done.newOwnerId,
      temporaryPassword,
      temporaryPasswordExpiresAt: expiresAt.toISOString(),
    };
  }
}
