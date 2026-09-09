import { Injectable } from '@nestjs/common';
import { PrepaymentRequirement, type BookingPaymentInfoDto } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from './availability.service';

@Injectable()
export class BookingPaymentInfoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  async get(salonId: string): Promise<BookingPaymentInfoDto> {
    await this.availability.getSalonOrThrow(salonId);
    const policy = await this.prisma.salonPaymentPolicy.findUnique({ where: { salonId } });
    return {
      onlinePaymentAvailable: Boolean(policy?.paymentQrImageUrl),
      paymentMethod: 'UPI_QR',
      paymentQrImageUrl: policy?.paymentQrImageUrl ?? null,
      prepaymentRequirement: policy?.prepaymentRequirement ?? PrepaymentRequirement.NONE,
      prepaymentPercentage: policy?.prepaymentPercentage ?? null,
    };
  }
}
