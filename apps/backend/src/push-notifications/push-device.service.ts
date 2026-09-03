import { HttpStatus, Injectable } from '@nestjs/common';
import type { PushDevice } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { isPlausibleExpoPushToken } from './expo-push-sender';

@Injectable()
export class PushDeviceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert by token, not by (userId, token): the token IS the device+app-install identity. If a
   * different user later signs into the same physical device, this correctly reassigns the
   * existing row to them rather than leaving a stale registration pointing at the previous
   * account (which would otherwise silently push a new owner's bookings to a departed one).
   */
  async register(
    userId: string,
    expoPushToken: string,
    platform: string | undefined,
  ): Promise<Pick<PushDevice, 'id'>> {
    if (!isPlausibleExpoPushToken(expoPushToken)) {
      throw new AppException(
        'INVALID_PUSH_TOKEN',
        'expoPushToken is not a recognized Expo push token format.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.prisma.pushDevice.upsert({
      where: { expoPushToken },
      create: { userId, expoPushToken, platform },
      update: { userId, platform },
      select: { id: true },
    });
  }

  /**
   * Deletes only if the token belongs to this user — idempotent no-op otherwise (already
   * unregistered, or never was this user's), never an error either way, since "make sure this
   * token isn't registered to me anymore" is the only thing a caller is actually asking for.
   */
  async unregister(userId: string, expoPushToken: string): Promise<void> {
    await this.prisma.pushDevice.deleteMany({
      where: { userId, expoPushToken },
    });
  }

  async devicesForUser(userId: string): Promise<PushDevice[]> {
    return this.prisma.pushDevice.findMany({ where: { userId } });
  }

  async removeStaleTokens(expoPushTokens: string[]): Promise<void> {
    if (expoPushTokens.length === 0) return;
    await this.prisma.pushDevice.deleteMany({
      where: { expoPushToken: { in: expoPushTokens } },
    });
  }
}
