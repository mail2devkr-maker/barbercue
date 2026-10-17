import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  DEMO_DELETE_CONFIRMATION,
  DEMO_WORKSPACE_BANNER,
  Role,
  type DemoWorkspaceDatasetDto,
  type DemoWorkspaceDeletePreviewDto,
  type DemoWorkspaceReadDto,
  type DemoWorkspaceStatusDto,
  type DeleteDemoWorkspaceResultDto,
  type ImportDemoWorkspaceResultDto,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { createDemoWorkspaceDataset } from './demo-workspace.dataset';

const MAX_PAYLOAD_BYTES = 262_144;
const SALON_NOT_FOUND = 'SALON_NOT_FOUND';
const SALON_ACCESS_DENIED = 'SALON_ACCESS_DENIED';

@Injectable()
export class DemoWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
    private readonly config: ConfigService,
  ) {}

  async getStatus(
    userId: string,
    salonId: string,
  ): Promise<DemoWorkspaceStatusDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    this.assertEnabled();
    return this.prisma.$transaction(async (tx) => {
      await this.lockSalonAndRecheckAccess(tx, userId, salonId);
      const row = await tx.ownerDemoWorkspace.findUnique({
        where: { salonId },
      });
      return this.statusDto(row);
    });
  }

  async import(
    userId: string,
    salonId: string,
    idempotencyKey: string,
  ): Promise<ImportDemoWorkspaceResultDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    this.assertEnabled();
    const idempotencyKeyHash = createHash('sha256')
      .update(idempotencyKey)
      .digest('hex');
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          method: 'POST',
          route: 'demo/import',
          salonId,
          body: {},
        }),
      )
      .digest('hex');
    return this.prisma.$transaction(
      async (tx) => {
        const salon = await this.lockSalonAndRecheckAccess(tx, userId, salonId);
        const priorRequest = await tx.ownerDemoWorkspaceAudit.findFirst({
          where: { salonId, actorUserId: userId, idempotencyKeyHash },
          select: { workspaceId: true, requestHash: true },
        });
        if (priorRequest) {
          if (priorRequest.requestHash !== requestHash) {
            throw new AppException(
              'IDEMPOTENCY_KEY_REUSED',
              'This idempotency key was already used for a different request.',
              HttpStatus.CONFLICT,
            );
          }
          const replayed = await tx.ownerDemoWorkspace.findUnique({
            where: { id: priorRequest.workspaceId },
          });
          if (!replayed) {
            throw new AppException(
              'IDEMPOTENCY_RESULT_EXPIRED',
              'This import was already completed and its demo workspace was later deleted.',
              HttpStatus.CONFLICT,
            );
          }
          return this.statusDto(replayed);
        }

        const existing = await tx.ownerDemoWorkspace.findUnique({
          where: { salonId },
        });
        if (existing) {
          const dataset =
            existing.payload as unknown as DemoWorkspaceDatasetDto;
          await tx.ownerDemoWorkspaceAudit.create({
            data: {
              salonId,
              actorUserId: userId,
              workspaceId: existing.id,
              action: 'REUSED',
              recordCounts: dataset.counts as unknown as Prisma.InputJsonValue,
              idempotencyKeyHash,
              requestHash,
            },
          });
          return this.statusDto(existing);
        }

        const workspaceId = randomUUID();
        const dataset = createDemoWorkspaceDataset({
          workspaceId,
          generatedAt: new Date(),
          timezone: salon.timezone ?? 'UTC',
          currency: salon.currency ?? 'INR',
        });
        const byteLength = Buffer.byteLength(JSON.stringify(dataset), 'utf8');
        if (byteLength > MAX_PAYLOAD_BYTES) {
          throw new AppException(
            'DEMO_DATASET_TOO_LARGE',
            'The demo dataset exceeds its storage limit.',
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }

        const created = await tx.ownerDemoWorkspace.create({
          data: {
            id: workspaceId,
            salonId,
            schemaVersion: dataset.schemaVersion,
            payload: dataset as unknown as Prisma.InputJsonValue,
            createdByUserId: userId,
          },
        });
        await tx.ownerDemoWorkspaceAudit.create({
          data: {
            salonId,
            actorUserId: userId,
            workspaceId,
            action: 'IMPORTED',
            recordCounts: dataset.counts as unknown as Prisma.InputJsonValue,
            idempotencyKeyHash,
            requestHash,
          },
        });

        return this.statusDto(created);
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  async getWorkspace(
    userId: string,
    salonId: string,
    workspaceId: string,
  ): Promise<DemoWorkspaceReadDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    this.assertEnabled();
    return this.prisma.$transaction(async (tx) => {
      await this.lockSalonAndRecheckAccess(tx, userId, salonId);
      const row = await tx.ownerDemoWorkspace.findFirst({
        where: { id: workspaceId, salonId },
      });
      if (!row) {
        throw new AppException(
          'DEMO_WORKSPACE_NOT_FOUND',
          'The demo workspace is not available for this shop.',
          HttpStatus.NOT_FOUND,
        );
      }
      return {
        workspaceId: row.id,
        salonId: row.salonId,
        label: DEMO_WORKSPACE_BANNER,
        dataset: row.payload as unknown as DemoWorkspaceDatasetDto,
      };
    });
  }

  async createDeletePreview(
    userId: string,
    salonId: string,
  ): Promise<DemoWorkspaceDeletePreviewDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    this.assertEnabled();
    return this.prisma.$transaction(async (tx) => {
      await this.lockSalonAndRecheckAccess(tx, userId, salonId);
      const row = await tx.ownerDemoWorkspace.findUnique({
        where: { salonId },
      });
      if (!row) {
        throw new AppException(
          'DEMO_WORKSPACE_NOT_FOUND',
          'There is no active demo workspace to delete.',
          HttpStatus.NOT_FOUND,
        );
      }
      const expiresAt = new Date(Date.now() + 5 * 60_000);
      return {
        confirmationToken: this.signDeletePreview({
          userId,
          salonId,
          workspaceId: row.id,
          expiresAt: expiresAt.getTime(),
        }),
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  async delete(
    userId: string,
    salonId: string,
    workspaceId: string,
    confirmation: string,
    confirmationToken: string,
  ): Promise<DeleteDemoWorkspaceResultDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);
    this.assertEnabled();
    if (confirmation !== DEMO_DELETE_CONFIRMATION) {
      throw this.invalidDeleteConfirmation();
    }
    this.verifyDeletePreview(confirmationToken, userId, salonId, workspaceId);
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockSalonAndRecheckAccess(tx, userId, salonId);
        const existing = await tx.ownerDemoWorkspace.findUnique({
          where: { salonId },
        });
        if (!existing) return { deleted: false, deletedWorkspaceId: null };
        if (existing.id !== workspaceId) {
          throw new AppException(
            'DEMO_WORKSPACE_CHANGED',
            'The active demo workspace changed. Review it and request a new deletion confirmation.',
            HttpStatus.CONFLICT,
          );
        }

        const dataset = existing.payload as unknown as DemoWorkspaceDatasetDto;
        // Delete only the exact isolated workspace identified by the locked salon's unique row.
        // The lifecycle audit uses no workspace FK so it survives payload deletion.
        await tx.ownerDemoWorkspace.delete({ where: { id: existing.id } });
        await tx.ownerDemoWorkspaceAudit.create({
          data: {
            salonId,
            actorUserId: userId,
            workspaceId: existing.id,
            action: 'DELETED',
            recordCounts: dataset.counts as unknown as Prisma.InputJsonValue,
          },
        });
        return {
          deleted: true,
          deletedWorkspaceId: existing.id,
        };
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  private async lockSalonAndRecheckAccess(
    tx: Prisma.TransactionClient,
    userId: string,
    salonId: string,
  ): Promise<{ timezone: string | null; currency: string | null }> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "salons" WHERE "id" = ${salonId} FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new AppException(
        SALON_NOT_FOUND,
        'Shop not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const ownerRole = await tx.userRole.findFirst({
      where: { userId, salonId, role: Role.SALON_OWNER },
      select: { id: true },
    });
    // Lock the exact membership row until this transaction commits. If it is concurrently
    // revoked before the lock is acquired, PostgreSQL returns no row after the delete commits;
    // if revocation starts after this point, it waits until this operation completes.
    const lockedOwnerRole = ownerRole
      ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "user_roles" WHERE "id" = ${ownerRole.id} FOR SHARE
        `
      : [];
    if (lockedOwnerRole.length === 0) {
      throw new AppException(
        SALON_ACCESS_DENIED,
        'You do not have access to this shop.',
        HttpStatus.FORBIDDEN,
      );
    }

    return tx.salon.findUniqueOrThrow({
      where: { id: salonId },
      select: { timezone: true, currency: true },
    });
  }

  private statusDto(
    row: { id: string; payload: Prisma.JsonValue } | null,
  ): DemoWorkspaceStatusDto {
    if (!row) {
      return {
        active: false,
        workspaceId: null,
        label: DEMO_WORKSPACE_BANNER,
        counts: null,
      };
    }
    const dataset = row.payload as unknown as DemoWorkspaceDatasetDto;
    return {
      active: true,
      workspaceId: row.id,
      label: DEMO_WORKSPACE_BANNER,
      counts: dataset.counts,
    };
  }

  private assertEnabled(): void {
    if (this.config.get<string>('OWNER_DEMO_WORKSPACE_ENABLED') === 'true') {
      return;
    }
    throw new AppException(
      'FEATURE_UNAVAILABLE',
      'Demo data is not enabled for this deployment.',
      HttpStatus.NOT_FOUND,
    );
  }

  private signDeletePreview(input: {
    userId: string;
    salonId: string;
    workspaceId: string;
    expiresAt: number;
  }): string {
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        ...input,
        nonce: randomBytes(16).toString('base64url'),
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', this.deletePreviewSigningKey())
      .update(`v1.${payload}`)
      .digest('base64url');
    return `v1.${payload}.${signature}`;
  }

  private verifyDeletePreview(
    token: string,
    userId: string,
    salonId: string,
    workspaceId: string,
  ): void {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1' || parts[1].length > 2048) {
      throw this.invalidDeleteConfirmation();
    }
    let providedSignature: Buffer;
    try {
      providedSignature = Buffer.from(parts[2], 'base64url');
    } catch {
      throw this.invalidDeleteConfirmation();
    }
    const expectedSignature = createHmac(
      'sha256',
      this.deletePreviewSigningKey(),
    )
      .update(`v1.${parts[1]}`)
      .digest();
    if (
      providedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(providedSignature, expectedSignature)
    ) {
      throw this.invalidDeleteConfirmation();
    }

    try {
      const claims = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      if (
        claims.version !== 1 ||
        claims.userId !== userId ||
        claims.salonId !== salonId ||
        claims.workspaceId !== workspaceId ||
        typeof claims.nonce !== 'string' ||
        typeof claims.expiresAt !== 'number' ||
        claims.expiresAt <= Date.now()
      ) {
        throw this.invalidDeleteConfirmation();
      }
    } catch {
      throw this.invalidDeleteConfirmation();
    }
  }

  private deletePreviewSigningKey(): Buffer {
    const accessSecret = this.config.get<string>('JWT_ACCESS_SECRET');
    if (!accessSecret) {
      throw new AppException(
        'DEMO_DELETE_CONFIRMATION_UNAVAILABLE',
        'Deletion confirmation is temporarily unavailable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return createHmac('sha256', accessSecret)
      .update('fastque:owner-demo-workspace-delete-preview:v1')
      .digest();
  }

  private invalidDeleteConfirmation(): AppException {
    return new AppException(
      'DEMO_DELETE_CONFIRMATION_INVALID',
      'The deletion confirmation is invalid or expired. Start again to delete demo data.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
