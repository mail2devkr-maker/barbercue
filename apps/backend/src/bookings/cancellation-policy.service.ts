import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BookingErrorCode,
  effectiveFreeCancellationWindowMinutes,
  type CancellationPolicyDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';

@Injectable()
export class CancellationPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * DATABASE.md: "CancellationPolicy (salonId nullable = platform default row, used when a salon
   * hasn't configured its own)". The platform-default row (salonId: null) is seeded once by
   * prisma/seed.ts — a genuinely missing default (should never happen in a correctly seeded
   * environment) is a hard error, never silently hard-coded numbers in application code.
   */
  async getEffectivePolicy(salonId: string): Promise<CancellationPolicyDto> {
    const salonPolicy = await this.prisma.cancellationPolicy.findUnique({
      where: { salonId },
    });
    const policy =
      salonPolicy ??
      (await this.prisma.cancellationPolicy.findFirst({
        where: { salonId: null },
      }));
    if (!policy) {
      throw new AppException(
        BookingErrorCode.CANCELLATION_POLICY_MISSING,
        'No cancellation policy is configured for this salon and no platform default exists.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      salonId,
      freeCancellationWindowMinutes: policy.freeCancellationWindowMinutes,
      effectiveFreeCancellationWindowMinutes: effectiveFreeCancellationWindowMinutes(
        policy.freeCancellationWindowMinutes,
      ),
      lateCancellationChargeType: policy.lateCancellationChargeType,
      lateCancellationChargeValue: Number(policy.lateCancellationChargeValue),
      noShowChargeType: policy.noShowChargeType,
      noShowChargeValue: Number(policy.noShowChargeValue),
      appointmentArrivalGraceMinutes: policy.appointmentArrivalGraceMinutes,
      queueCallResponseGraceMinutes: policy.queueCallResponseGraceMinutes,
    };
  }
}
