import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingErrorCode,
  SalonStatus,
  type SalonShareLinksDto,
} from '@barbercue/shared';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';

function configuredWebOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(
      url.hostname,
    );
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '' && url.pathname !== '/') ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback))
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

@Injectable()
export class SalonShareLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
  ) {}

  async getForSalon(
    userId: string,
    salonId: string,
  ): Promise<SalonShareLinksDto> {
    await this.salonAccess.assertOwnerOrAdminAccess(userId, salonId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        id: true,
        status: true,
        name: true,
        description: true,
        slug: true,
        city: { select: { slug: true, countryCode: true } },
        photos: {
          orderBy: { sortOrder: 'asc' },
          select: { url: true, type: true },
        },
      },
    });
    if (!salon) {
      throw new AppException(
        BookingErrorCode.SALON_NOT_FOUND,
        'Salon not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const publicPath = `/${salon.city.countryCode.toLowerCase()}/${encodeURIComponent(salon.city.slug)}/${encodeURIComponent(salon.slug)}`;
    const origin = configuredWebOrigin(process.env.WEB_BASE_URL);
    const reasons: SalonShareLinksDto['readiness']['reasons'] = [];
    if (!origin) reasons.push('WEB_BASE_URL_NOT_CONFIGURED');
    if (salon.status !== SalonStatus.ACTIVE) reasons.push('SALON_NOT_PUBLIC');

    return {
      salonId: salon.id,
      status: salon.status,
      publicPath,
      publicUrl: origin ? `${origin}${publicPath}` : null,
      readiness: { ready: reasons.length === 0, reasons },
      metadata: {
        title: salon.name,
        description: salon.description,
        imageUrl:
          salon.photos.find((photo) => photo.type === 'COVER')?.url ??
          salon.photos[0]?.url ??
          null,
      },
    };
  }
}
