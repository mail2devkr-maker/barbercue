import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FASTQUE_CAPABILITY_KEYS,
  SalonDescriptionErrorCode,
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

// These routes are registered in AppModule and do not need a provider or feature flag.
// A capability describes availability, not authorization: each route still checks salon access.
const AVAILABLE_FEATURES = [
  'revenueReport',
  'inventory',
  'locationPin',
] as const satisfies readonly FastQueCapabilityKey[];

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

    for (const key of AVAILABLE_FEATURES) {
      features[key] = { status: 'ENABLED', reasonCode: null, updatedAt: null };
    }
    // The preview endpoint validates contacts but cannot persist them or send invitations.
    features.contactImport = {
      status: 'UNCONFIGURED',
      reasonCode: 'CONTACT_IMPORT_PREVIEW_ONLY',
      updatedAt: null,
    };
    // SalonDescriptionModule deliberately binds the unconfigured provider. An environment
    // variable alone must not advertise (or activate) an external AI integration.
    features.aiDescription = {
      status: 'UNCONFIGURED',
      reasonCode: SalonDescriptionErrorCode.PROVIDER_NOT_CONFIGURED,
      updatedAt: null,
    };

    const demoEnabled =
      this.config.get<string>('OWNER_DEMO_WORKSPACE_ENABLED') === 'true';
    features.demoData = demoEnabled
      ? { status: 'SANDBOX', reasonCode: null, updatedAt: null }
      : { status: 'DISABLED', reasonCode: 'FEATURE_DISABLED', updatedAt: null };

    return { features };
  }
}
