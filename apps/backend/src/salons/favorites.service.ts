import { HttpStatus, Injectable } from '@nestjs/common';
import { SalonStatus, type FavoriteSalonDto } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonsService } from './salons.service';

/**
 * A customer's saved salons. Every method is scoped to the authenticated user's own rows — the
 * user ID always comes from the session, never from the request — and add/remove are idempotent,
 * so a double tap or a retried request can never create duplicates or errors.
 */
@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salons: SalonsService,
  ) {}

  /** Newest first. Salons that are no longer active are left out (the row is kept). */
  async list(userId: string): Promise<FavoriteSalonDto[]> {
    const rows = await this.prisma.customerFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { salonId: true, createdAt: true },
    });
    const items = await this.salons.listItemsByIds(rows.map((r) => r.salonId));
    const savedAt = new Map(
      rows.map((r) => [r.salonId, r.createdAt.toISOString()]),
    );
    return items.map((item) => ({
      ...item,
      favoritedAt: savedAt.get(item.id)!,
    }));
  }

  async ids(userId: string): Promise<{ salonIds: string[] }> {
    const rows = await this.prisma.customerFavorite.findMany({
      where: { userId, salon: { status: SalonStatus.ACTIVE } },
      select: { salonId: true },
    });
    return { salonIds: rows.map((r) => r.salonId) };
  }

  async add(
    userId: string,
    salonId: string,
  ): Promise<{ salonId: string; favorited: true }> {
    const salon = await this.prisma.salon.findFirst({
      where: { id: salonId, status: SalonStatus.ACTIVE },
      select: { id: true },
    });
    if (!salon) {
      throw new AppException(
        'SALON_NOT_FOUND',
        'That shop is not available.',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.prisma.customerFavorite.upsert({
      where: { userId_salonId: { userId, salonId } },
      create: { userId, salonId },
      update: {},
    });
    return { salonId, favorited: true };
  }

  async remove(
    userId: string,
    salonId: string,
  ): Promise<{ salonId: string; favorited: false }> {
    await this.prisma.customerFavorite.deleteMany({
      where: { userId, salonId },
    });
    return { salonId, favorited: false };
  }
}
