import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PushProvider,
  type PushDeviceDto,
  type RegisterPushDeviceInput,
  type UnregisterPushDeviceInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PushDevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    userId: string,
    input: RegisterPushDeviceInput,
  ): Promise<PushDeviceDto> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return this.toDto(await this.registerOnce(userId, input));
      } catch (error) {
        if (!(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          attempt === 0
        )) {
          throw error;
        }
        // A simultaneous token refresh/login may win either unique key between our reads and
        // upsert. Re-read once; the second pass converges on the row that won the race.
      }
    }
    throw new Error('Push device registration retry exhausted');
  }

  private async registerOnce(userId: string, input: RegisterPushDeviceInput) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const byInstallation = await tx.pushDevice.findUnique({
        where: {
          provider_installationId: {
            provider: PushProvider.EXPO,
            installationId: input.installationId,
          },
        },
      });
      const byToken = await tx.pushDevice.findUnique({
        where: { pushToken: input.pushToken },
      });

      // A refreshed token can occasionally have been observed first under a stale installation.
      // Retire that association without deleting its delivery history, then attach the token to
      // the authenticated installation below.
      if (byToken && byToken.id !== byInstallation?.id) {
        await tx.pushDevice.update({
          where: { id: byToken.id },
          data: {
            enabled: false,
            pushToken: `retired:${byToken.id}:${Date.now()}`,
          },
        });
      }

      return tx.pushDevice.upsert({
        where: {
          provider_installationId: {
            provider: PushProvider.EXPO,
            installationId: input.installationId,
          },
        },
        update: {
          userId,
          platform: input.platform,
          pushToken: input.pushToken,
          enabled: true,
          lastSeenAt: now,
        },
        create: {
          userId,
          platform: input.platform,
          provider: input.provider,
          pushToken: input.pushToken,
          installationId: input.installationId,
          enabled: true,
          lastSeenAt: now,
        },
      });
    });
  }

  async unregister(
    userId: string,
    input: UnregisterPushDeviceInput,
  ): Promise<void> {
    await this.prisma.pushDevice.updateMany({
      where: {
        userId,
        provider: input.provider,
        installationId: input.installationId,
      },
      data: { enabled: false, lastSeenAt: new Date() },
    });
  }

  private toDto(row: {
    id: string;
    platform: PushDeviceDto['platform'];
    provider: PushDeviceDto['provider'];
    installationId: string;
    enabled: boolean;
    lastSeenAt: Date;
  }): PushDeviceDto {
    return {
      id: row.id,
      platform: row.platform,
      provider: row.provider,
      installationId: row.installationId,
      enabled: row.enabled,
      lastSeenAt: row.lastSeenAt.toISOString(),
    };
  }
}
