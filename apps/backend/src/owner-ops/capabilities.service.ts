import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FASTQUE_CAPABILITY_KEYS,
  type FeatureCapabilityDto,
  type FastQueCapabilityKey,
  type SalonCapabilitiesDto,
} from '@barbercue/shared';
import { SalonAccessService } from '../common/salon-access/salon-access.service';

const NOT_IMPLEMENTED: FeatureCapabilityDto = {
  status: 'UNCONFIGURED',
  reasonCode: 'FEATURE_NOT_IMPLEMENTED',
  updatedAt: null,
};

@Injectable()
export class SalonCapabilitiesService {
  constructor(
    private readonly salonAccess: SalonAccessService,
    private readonly config: ConfigService,
  ) {}

  async getForOwner(
    userId: string,
    salonId: string,
  ): Promise<SalonCapabilitiesDto> {
    await this.salonAccess.assertOwnerAccess(userId, salonId);

    const features = Object.fromEntries(
      FASTQUE_CAPABILITY_KEYS.map((key) => [key, { ...NOT_IMPLEMENTED }]),
    ) as Record<FastQueCapabilityKey, FeatureCapabilityDto>;

    const demoEnabled =
      this.config.get<string>('OWNER_DEMO_WORKSPACE_ENABLED') === 'true';
    features.demoData = demoEnabled
      ? { status: 'SANDBOX', reasonCode: null, updatedAt: null }
      : { status: 'DISABLED', reasonCode: 'FEATURE_DISABLED', updatedAt: null };

    return { features };
  }
}
