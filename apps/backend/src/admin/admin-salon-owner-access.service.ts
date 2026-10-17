import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import {
  Prisma,
  Role as DbRole,
  SalonOwnerInvitationStatus,
} from '@prisma/client';
import {
  AuthErrorCode,
  OwnerAccessErrorCode,
  SessionAudience,
  UserStatus,
  type OwnerAccessMutationInput,
  type OwnerAccessMutationResultDto,
  type OwnerAccessAuditPageDto,
  type OwnerAccessPreviewDto,
  type OwnerAccessShopDto,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_SENDER, type EmailSender } from '../auth/services/email-sender';
import { PasswordService } from '../auth/services/password.service';
import { TotpService } from '../auth/services/totp.service';
import { CryptoService } from '../auth/services/crypto.service';
import { passwordWebBaseUrl } from '../auth/services/password-link';

const INVITE_DAYS = 7;
const TRANSACTION = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;
const shopInclude = {
  city: { select: { name: true } },
  owner: {
    select: { id: true, email: true, emailVerifiedAt: true, status: true },
  },
  userRoles: { where: { role: DbRole.SALON_OWNER }, select: { userId: true } },
  ownerInvitations: {
    where: { status: SalonOwnerInvitationStatus.PENDING },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} as const satisfies Prisma.SalonInclude;
type ShopRecord = Prisma.SalonGetPayload<{ include: typeof shopInclude }>;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AdminSalonOwnerAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly crypto: CryptoService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  async search(query: string, actorId: string): Promise<OwnerAccessShopDto[]> {
    await this.assertAdminRead(actorId);
    const term = query.trim();
    if (term.length < 2 || term.length > 100) return [];
    const shops = await this.prisma.salon.findMany({
      where: {
        OR: [
          { id: { contains: term, mode: 'insensitive' } },
          { publicId: { contains: term, mode: 'insensitive' } },
          { name: { contains: term, mode: 'insensitive' } },
        ],
      },
      include: shopInclude,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    return shops.map((shop) => this.toDto(shop));
  }

  async getShop(
    salonId: string,
    actorId?: string,
  ): Promise<OwnerAccessShopDto> {
    if (actorId) await this.assertAdminRead(actorId);
    const shop = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: shopInclude,
    });
    if (!shop)
      throw this.error(
        OwnerAccessErrorCode.SHOP_NOT_FOUND,
        'Shop not found.',
        HttpStatus.NOT_FOUND,
      );
    return this.toDto(shop);
  }

  async preview(
    email: string,
    actorId: string,
  ): Promise<OwnerAccessPreviewDto> {
    await this.assertAdminRead(actorId);
    const normalized = email.trim().toLowerCase();
    const accounts = await this.prisma.user.findMany({
      where: { email: { equals: normalized, mode: 'insensitive' } },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        emailVerifiedAt: true,
      },
      take: 2,
    });
    if (accounts.length > 1)
      throw this.error(
        OwnerAccessErrorCode.EMAIL_AMBIGUOUS,
        'More than one account matches this email. Resolve the identity conflict first.',
        HttpStatus.CONFLICT,
      );
    const account = accounts[0];
    const available =
      account && account.status === UserStatus.ACTIVE && !account.deletedAt;
    return {
      email: normalized,
      account: account
        ? {
            id: account.id,
            status: account.status,
            emailVerified: !!account.emailVerifiedAt,
          }
        : null,
      action: !account
        ? 'INVITE_NEW'
        : !available
          ? 'UNAVAILABLE'
          : account.emailVerifiedAt
            ? 'ASSIGN_VERIFIED'
            : 'INVITE_EXISTING',
    };
  }

  async auditHistory(
    salonId: string,
    actorId: string,
    cursor?: string,
  ): Promise<OwnerAccessAuditPageDto> {
    await this.assertAdminRead(actorId);
    if (cursor) {
      const belongs = await this.prisma.auditLog.findFirst({
        where: {
          id: cursor,
          entityType: 'Salon',
          entityId: salonId,
          action: { startsWith: 'SALON_OWNER_' },
        },
        select: { id: true },
      });
      if (!belongs)
        throw this.error(
          OwnerAccessErrorCode.SHOP_NOT_FOUND,
          'Audit cursor does not belong to this shop.',
          HttpStatus.BAD_REQUEST,
        );
    }
    const rows = await this.prisma.auditLog.findMany({
      where: {
        entityType: 'Salon',
        entityId: salonId,
        action: { startsWith: 'SALON_OWNER_' },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return {
      items: rows.slice(0, 50).map((row) => {
        const metadata =
          row.metadata &&
          typeof row.metadata === 'object' &&
          !Array.isArray(row.metadata)
            ? (row.metadata as Record<string, unknown>)
            : {};
        return {
          id: row.id,
          action: row.action,
          actorUserId: row.actorUserId,
          createdAt: row.createdAt.toISOString(),
          beforeOwnerUserId:
            typeof metadata.beforeOwnerUserId === 'string'
              ? metadata.beforeOwnerUserId
              : null,
          afterOwnerUserId:
            typeof metadata.afterOwnerUserId === 'string'
              ? metadata.afterOwnerUserId
              : null,
          reason: typeof metadata.reason === 'string' ? metadata.reason : null,
        };
      }),
      nextCursor: rows.length > 50 ? rows[49].id : null,
    };
  }

  async assign(
    actorId: string,
    salonId: string,
    input: OwnerAccessMutationInput,
  ): Promise<OwnerAccessMutationResultDto> {
    const normalized = input.email.trim().toLowerCase();
    const changed = await this.conflictOnRace(() =>
      this.prisma.$transaction(async (tx) => {
        await this.assertAdmin(tx, actorId, input.totpCode);
        const accounts = await tx.user.findMany({
          where: { email: { equals: normalized, mode: 'insensitive' } },
          select: {
            id: true,
            status: true,
            deletedAt: true,
            emailVerifiedAt: true,
          },
          take: 2,
        });
        if (accounts.length > 1)
          throw this.error(
            OwnerAccessErrorCode.EMAIL_AMBIGUOUS,
            'More than one account matches this email.',
            HttpStatus.CONFLICT,
          );
        const target = accounts[0];
        if (
          !target ||
          target.status !== UserStatus.ACTIVE ||
          target.deletedAt ||
          !target.emailVerifiedAt
        ) {
          throw this.error(
            OwnerAccessErrorCode.ACCOUNT_UNAVAILABLE,
            'A verified, active account is required. Send an invitation first.',
            HttpStatus.CONFLICT,
          );
        }
        return this.mapInTransaction(
          tx,
          salonId,
          target.id,
          input.expectedOwnerUserId,
          input.reason,
          input.transferConfirmed,
          actorId,
          actorId,
        );
      }, TRANSACTION),
    );
    return {
      outcome: changed ? 'MAPPED' : 'ALREADY_MAPPED',
      shop: await this.getShop(salonId),
    };
  }

  async invite(
    actorId: string,
    salonId: string,
    input: OwnerAccessMutationInput,
  ): Promise<OwnerAccessMutationResultDto> {
    this.email.assertAvailable();
    const webBase = passwordWebBaseUrl();
    const normalized = input.email.trim().toLowerCase();
    const rawToken = randomBytes(32).toString('hex');
    const link = new URL('/owner-invitation/accept', webBase);
    link.hash = new URLSearchParams({ token: rawToken }).toString();
    const invite = await this.conflictOnRace(() =>
      this.prisma.$transaction(async (tx) => {
        await this.assertAdmin(tx, actorId, input.totpCode);
        const shop = await tx.salon.findUnique({
          where: { id: salonId },
          select: { id: true, name: true, ownerUserId: true },
        });
        if (!shop)
          throw this.error(
            OwnerAccessErrorCode.SHOP_NOT_FOUND,
            'Shop not found.',
            HttpStatus.NOT_FOUND,
          );
        if (shop.ownerUserId !== input.expectedOwnerUserId)
          throw this.staleOwner();
        const users = await tx.user.findMany({
          where: { email: { equals: normalized, mode: 'insensitive' } },
          select: {
            id: true,
            status: true,
            deletedAt: true,
            emailVerifiedAt: true,
          },
          take: 2,
        });
        if (users.length > 1)
          throw this.error(
            OwnerAccessErrorCode.EMAIL_AMBIGUOUS,
            'More than one account matches this email.',
            HttpStatus.CONFLICT,
          );
        const target = users[0];
        if (shop.ownerUserId !== target?.id && !input.transferConfirmed) {
          // Every different-owner mapping requires explicit confirmation, including placeholders.
          throw this.error(
            OwnerAccessErrorCode.TRANSFER_CONFIRMATION_REQUIRED,
            'Confirm replacement of the current owner.',
            HttpStatus.CONFLICT,
          );
        }
        if (target && (target.status !== UserStatus.ACTIVE || target.deletedAt))
          throw this.error(
            OwnerAccessErrorCode.ACCOUNT_UNAVAILABLE,
            'This account cannot receive owner access.',
            HttpStatus.CONFLICT,
          );
        if (target?.emailVerifiedAt)
          throw this.error(
            OwnerAccessErrorCode.ACCOUNT_UNAVAILABLE,
            'This account is already verified. Use verified assignment.',
            HttpStatus.CONFLICT,
          );
        await tx.salonOwnerInvitation.updateMany({
          where: { salonId, status: SalonOwnerInvitationStatus.PENDING },
          data: { status: SalonOwnerInvitationStatus.REVOKED },
        });
        const created = await tx.salonOwnerInvitation.create({
          data: {
            salonId,
            email: normalized,
            targetUserId: target?.id ?? null,
            expectedOwnerUserId: input.expectedOwnerUserId,
            actorUserId: actorId,
            reason: input.reason,
            transferConfirmed: input.transferConfirmed,
            tokenHash: hashToken(rawToken),
            expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: actorId,
            action: 'SALON_OWNER_INVITATION_CREATED',
            entityType: 'Salon',
            entityId: salonId,
            metadata: {
              invitationId: created.id,
              currentOwnerUserId: shop.ownerUserId,
              proposedUserId: target?.id ?? null,
              reason: input.reason,
            },
          },
        });
        return { id: created.id, name: shop.name };
      }, TRANSACTION),
    );

    let delivery: 'SENT' | 'DEV_NOT_DELIVERED';
    try {
      delivery = await this.email.sendSalonOwnerInvitation(
        normalized,
        link.toString(),
        invite.name,
        INVITE_DAYS,
      );
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        const result = await tx.salonOwnerInvitation.updateMany({
          where: { id: invite.id, status: SalonOwnerInvitationStatus.PENDING },
          data: { status: SalonOwnerInvitationStatus.REVOKED },
        });
        if (result.count)
          await tx.auditLog.create({
            data: {
              actorUserId: actorId,
              action: 'SALON_OWNER_INVITATION_DELIVERY_FAILED',
              entityType: 'Salon',
              entityId: salonId,
              metadata: { invitationId: invite.id },
            },
          });
      });
      throw error;
    }
    return {
      outcome: delivery === 'SENT' ? 'INVITATION_SENT' : 'INVITATION_CREATED',
      shop: await this.getShop(salonId),
    };
  }

  async revokeInvite(
    actorId: string,
    salonId: string,
    invitationId: string,
  ): Promise<OwnerAccessShopDto> {
    await this.conflictOnRace(() =>
      this.prisma.$transaction(async (tx) => {
        await this.assertAdmin(tx, actorId);
        const result = await tx.salonOwnerInvitation.updateMany({
          where: {
            id: invitationId,
            salonId,
            status: SalonOwnerInvitationStatus.PENDING,
          },
          data: { status: SalonOwnerInvitationStatus.REVOKED },
        });
        if (!result.count)
          throw this.error(
            OwnerAccessErrorCode.INVITATION_CONFLICT,
            'Invitation is no longer pending.',
            HttpStatus.CONFLICT,
          );
        await tx.auditLog.create({
          data: {
            actorUserId: actorId,
            action: 'SALON_OWNER_INVITATION_REVOKED',
            entityType: 'Salon',
            entityId: salonId,
            metadata: { invitationId },
          },
        });
      }, TRANSACTION),
    );
    return this.getShop(salonId);
  }

  async acceptNew(
    token: string,
    password: string,
  ): Promise<{ salonId: string }> {
    const hashed = await this.passwords.hash(password);
    return this.accept(token, null, hashed);
  }

  async acceptExisting(
    token: string,
    userId: string,
  ): Promise<{ salonId: string }> {
    return this.accept(token, userId, null);
  }

  private async accept(
    token: string,
    existingUserId: string | null,
    passwordHash: string | null,
  ): Promise<{ salonId: string }> {
    const tokenHash = hashToken(token);
    return this.conflictOnRace(() =>
      this.prisma.$transaction(async (tx) => {
        const invite = await tx.salonOwnerInvitation.findUnique({
          where: { tokenHash },
        });
        if (!invite || invite.status !== SalonOwnerInvitationStatus.PENDING)
          throw this.error(
            OwnerAccessErrorCode.INVITATION_INVALID,
            'Invitation is invalid or has already been used.',
            HttpStatus.BAD_REQUEST,
          );
        const now = new Date();
        if (invite.expiresAt <= now)
          throw this.error(
            OwnerAccessErrorCode.INVITATION_EXPIRED,
            'Invitation has expired. Ask the administrator to resend it.',
            HttpStatus.GONE,
          );
        await this.assertAdmin(tx, invite.actorUserId);
        const accounts = await tx.user.findMany({
          where: { email: { equals: invite.email, mode: 'insensitive' } },
          select: {
            id: true,
            status: true,
            deletedAt: true,
            emailVerifiedAt: true,
          },
          take: 2,
        });
        if (accounts.length > 1)
          throw this.error(
            OwnerAccessErrorCode.EMAIL_AMBIGUOUS,
            'Account identity conflict. Contact support.',
            HttpStatus.CONFLICT,
          );
        const account = accounts[0];
        let targetId: string;
        if (existingUserId) {
          if (
            !account ||
            !invite.targetUserId ||
            account.id !== existingUserId ||
            invite.targetUserId !== existingUserId ||
            account.status !== UserStatus.ACTIVE ||
            account.deletedAt
          ) {
            throw this.error(
              OwnerAccessErrorCode.INVITATION_INVALID,
              'Sign in to the invited account to accept.',
              HttpStatus.FORBIDDEN,
            );
          }
          targetId = existingUserId;
          if (!account.emailVerifiedAt)
            await tx.user.update({
              where: { id: targetId },
              data: { emailVerifiedAt: now },
            });
        } else {
          if (invite.targetUserId || account || !passwordHash)
            throw this.error(
              OwnerAccessErrorCode.INVITATION_CONFLICT,
              'An existing account must sign in before accepting this invitation.',
              HttpStatus.CONFLICT,
            );
          const created = await tx.user.create({
            data: { email: invite.email, emailVerifiedAt: now, passwordHash },
          });
          targetId = created.id;
        }
        const claimed = await tx.salonOwnerInvitation.updateMany({
          where: {
            id: invite.id,
            status: SalonOwnerInvitationStatus.PENDING,
            expiresAt: { gt: now },
          },
          data: {
            status: SalonOwnerInvitationStatus.ACCEPTED,
            acceptedAt: now,
            targetUserId: targetId,
          },
        });
        if (!claimed.count)
          throw this.error(
            OwnerAccessErrorCode.INVITATION_CONFLICT,
            'Invitation was already used.',
            HttpStatus.CONFLICT,
          );
        await this.mapInTransaction(
          tx,
          invite.salonId,
          targetId,
          invite.expectedOwnerUserId,
          invite.reason,
          invite.transferConfirmed,
          targetId,
          invite.actorUserId,
          invite.id,
        );
        return { salonId: invite.salonId };
      }, TRANSACTION),
    );
  }

  private async mapInTransaction(
    tx: Prisma.TransactionClient,
    salonId: string,
    targetId: string,
    expectedOwnerId: string,
    reason: string,
    transferConfirmed: boolean,
    actorId: string,
    authorizedById: string,
    invitationId?: string,
  ): Promise<boolean> {
    const shop = await tx.salon.findUnique({
      where: { id: salonId },
      select: { ownerUserId: true },
    });
    if (!shop)
      throw this.error(
        OwnerAccessErrorCode.SHOP_NOT_FOUND,
        'Shop not found.',
        HttpStatus.NOT_FOUND,
      );
    if (shop.ownerUserId !== expectedOwnerId) throw this.staleOwner();
    const target = await tx.user.findUnique({
      where: { id: targetId },
      select: { status: true, deletedAt: true, emailVerifiedAt: true },
    });
    if (
      !target ||
      target.status !== UserStatus.ACTIVE ||
      target.deletedAt ||
      !target.emailVerifiedAt
    )
      throw this.error(
        OwnerAccessErrorCode.ACCOUNT_UNAVAILABLE,
        'Owner account must be active and email verified.',
        HttpStatus.CONFLICT,
      );
    const ownerRoles = await tx.userRole.findMany({
      where: { salonId, role: DbRole.SALON_OWNER },
      select: { userId: true },
    });
    const hasTargetRole = ownerRoles.some((role) => role.userId === targetId);
    const removedIds = ownerRoles
      .filter((role) => role.userId !== targetId)
      .map((role) => role.userId);
    const ownerChanges = shop.ownerUserId !== targetId;
    if ((ownerChanges || removedIds.length) && !transferConfirmed)
      throw this.error(
        OwnerAccessErrorCode.TRANSFER_CONFIRMATION_REQUIRED,
        'Confirm the owner change and review existing owner roles.',
        HttpStatus.CONFLICT,
      );
    if (!ownerChanges && hasTargetRole && !removedIds.length) return false;
    const updated = await tx.salon.updateMany({
      where: { id: salonId, ownerUserId: expectedOwnerId },
      data: { ownerUserId: targetId },
    });
    if (!updated.count) throw this.staleOwner();
    if (!hasTargetRole)
      await tx.userRole.create({
        data: { userId: targetId, role: DbRole.SALON_OWNER, salonId },
      });
    if (removedIds.length)
      await tx.userRole.deleteMany({
        where: {
          salonId,
          role: DbRole.SALON_OWNER,
          userId: { in: removedIds },
        },
      });
    const sessionUserIds = [
      ...new Set([
        ...removedIds,
        ...(ownerChanges ? [shop.ownerUserId] : []),
        targetId,
      ]),
    ];
    await tx.refreshToken.updateMany({
      where: {
        userId: { in: sessionUserIds },
        audience: SessionAudience.STAFF,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    await tx.salonOwnerInvitation.updateMany({
      where: { salonId, status: SalonOwnerInvitationStatus.PENDING },
      data: { status: SalonOwnerInvitationStatus.REVOKED },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actorId,
        action: ownerChanges
          ? 'SALON_OWNER_TRANSFERRED'
          : 'SALON_OWNER_ROLE_REPAIRED',
        entityType: 'Salon',
        entityId: salonId,
        metadata: {
          beforeOwnerUserId: shop.ownerUserId,
          afterOwnerUserId: targetId,
          removedRoleUserIds: removedIds,
          authorizedByUserId: authorizedById,
          reason,
          invitationId: invitationId ?? null,
        },
      },
    });
    return true;
  }

  private async assertAdmin(
    tx: Prisma.TransactionClient,
    actorId: string,
    totpCode?: string,
  ): Promise<void> {
    const admin = await tx.user.findUnique({
      where: { id: actorId },
      select: {
        status: true,
        deletedAt: true,
        twoFactorEnabled: true,
        totpSecret: true,
        roles: {
          where: { role: DbRole.PLATFORM_ADMIN, salonId: null },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (
      !admin ||
      admin.status !== UserStatus.ACTIVE ||
      admin.deletedAt ||
      !admin.roles.length
    )
      throw this.error(
        AuthErrorCode.FORBIDDEN_ROLE,
        'Platform Admin access is required.',
        HttpStatus.FORBIDDEN,
      );
    if (totpCode !== undefined) {
      if (!admin.twoFactorEnabled || !admin.totpSecret)
        throw this.error(
          AuthErrorCode.TOTP_SETUP_REQUIRED,
          'Authenticator setup is required.',
          HttpStatus.FORBIDDEN,
        );
      let secret: string;
      try {
        secret = this.crypto.decrypt(admin.totpSecret);
      } catch {
        throw this.error(
          AuthErrorCode.TOTP_SETUP_REQUIRED,
          'Authenticator setup must be repaired.',
          HttpStatus.FORBIDDEN,
        );
      }
      if (!(await this.totp.verifyToken(secret, totpCode)))
        throw this.error(
          AuthErrorCode.TOTP_INVALID,
          'Incorrect authenticator code.',
          HttpStatus.UNAUTHORIZED,
        );
    }
  }

  private async assertAdminRead(actorId: string): Promise<void> {
    const admin = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: {
        status: true,
        deletedAt: true,
        roles: {
          where: { role: DbRole.PLATFORM_ADMIN, salonId: null },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (
      !admin ||
      admin.status !== UserStatus.ACTIVE ||
      admin.deletedAt ||
      !admin.roles.length
    )
      throw this.error(
        AuthErrorCode.FORBIDDEN_ROLE,
        'Platform Admin access is required.',
        HttpStatus.FORBIDDEN,
      );
  }

  private toDto(shop: ShopRecord): OwnerAccessShopDto {
    const pending = shop.ownerInvitations[0];
    return {
      id: shop.id,
      publicId: shop.publicId,
      name: shop.name,
      status: shop.status,
      location: [shop.localityText, shop.city.name].filter(Boolean).join(', '),
      owner: {
        id: shop.owner.id,
        email: shop.owner.email,
        status: shop.owner.status,
        emailVerified: !!shop.owner.emailVerifiedAt,
        hasOwnerRole: shop.userRoles.some(
          (role) => role.userId === shop.ownerUserId,
        ),
      },
      extraOwnerRoleCount: shop.userRoles.filter(
        (role) => role.userId !== shop.ownerUserId,
      ).length,
      invitation: pending
        ? {
            id: pending.id,
            email: pending.email,
            status: pending.expiresAt <= new Date() ? 'EXPIRED' : 'PENDING',
            expiresAt: pending.expiresAt.toISOString(),
            targetUserId: pending.targetUserId,
          }
        : null,
    };
  }

  private staleOwner(): AppException {
    return this.error(
      OwnerAccessErrorCode.STALE_OWNER,
      'Shop ownership changed. Refresh before continuing.',
      HttpStatus.CONFLICT,
    );
  }

  private error(
    code: string,
    message: string,
    status: HttpStatus,
  ): AppException {
    return new AppException(code, message, status);
  }

  private async conflictOnRace<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        throw this.error(
          OwnerAccessErrorCode.INVITATION_CONFLICT,
          'This request conflicted with another change. Refresh and retry.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }
}
