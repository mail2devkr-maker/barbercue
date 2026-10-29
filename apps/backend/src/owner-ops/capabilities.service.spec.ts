import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import {
  FASTQUE_CAPABILITY_KEYS,
  SalonDescriptionErrorCode,
} from '@barbercue/shared';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { SalonCapabilitiesService } from './capabilities.service';

describe('SalonCapabilitiesService', () => {
  const salonAccess = {
    assertOwnerAccess: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn() };
  let service: SalonCapabilitiesService;

  beforeEach(() => {
    jest.resetAllMocks();
    salonAccess.assertOwnerAccess.mockResolvedValue(undefined);
    config.get.mockReturnValue(undefined);
    service = new SalonCapabilitiesService(
      salonAccess as unknown as SalonAccessService,
      config as unknown as ConfigService,
    );
  });

  it('reports registered provider-free features without requiring activation', async () => {
    const result = await service.getForOwner('owner-1', 'salon-1');
    expect(Object.keys(result.features).sort()).toEqual(
      [...FASTQUE_CAPABILITY_KEYS].sort(),
    );
    expect(result.features.demoData).toMatchObject({
      status: 'DISABLED',
      reasonCode: 'FEATURE_DISABLED',
    });
    for (const key of [
      'revenueReport',
      'inventory',
      'locationPin',
      'offers',
    ] as const) {
      expect(result.features[key]).toEqual({
        status: 'ENABLED',
        reasonCode: null,
        updatedAt: null,
      });
    }
    expect(result.features.ownerAssistant).toEqual({
      status: 'ENABLED',
      reasonCode: 'DETERMINISTIC_QUERY_ONLY',
      updatedAt: null,
    });
    expect(result.features.customerAssistant).toEqual({
      status: 'ENABLED',
      reasonCode: 'DETERMINISTIC_CATALOG_AVAILABILITY_SEARCH',
      updatedAt: null,
    });
    expect(salonAccess.assertOwnerAccess).toHaveBeenCalledWith(
      'owner-1',
      'salon-1',
    );
  });

  it('reports demo data as sandbox only when its explicit deployment flag is enabled', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'OWNER_DEMO_WORKSPACE_ENABLED' ? 'true' : undefined,
    );
    const result = await service.getForOwner('owner-1', 'salon-1');
    expect(result.features.demoData).toEqual({
      status: 'SANDBOX',
      reasonCode: null,
      updatedAt: null,
    });
  });

  it('does not claim unfinished provider-backed features are available', async () => {
    config.get.mockReturnValue('true');
    const result = await service.getForOwner('owner-1', 'salon-1');
    for (const key of [
      'consultations',
      'professionals',
      'subscription',
      'ownerEmail',
      'socialImport',
    ] as const) {
      expect(result.features[key].status).toBe('UNCONFIGURED');
      expect(result.features[key].reasonCode).toBe('FEATURE_NOT_IMPLEMENTED');
    }
    expect(result.features.aiDescription).toMatchObject({
      status: 'UNCONFIGURED',
      reasonCode: SalonDescriptionErrorCode.PROVIDER_NOT_CONFIGURED,
    });
    expect(result.features.contactImport).toMatchObject({
      status: 'UNCONFIGURED',
      reasonCode: 'CONTACT_IMPORT_PREVIEW_ONLY',
    });
  });

  it.each([undefined, 'false', 'TRUE', '1', '', true])(
    'does not enable demo for a noncanonical flag value: %s',
    async (value) => {
      config.get.mockReturnValue(value);
      const result = await service.getForOwner('owner-1', 'salon-1');
      expect(result.features.demoData.status).toBe('DISABLED');
    },
  );

  it('rejects salon access before reading configuration or exposing capabilities', async () => {
    const denied = new ForbiddenException();
    salonAccess.assertOwnerAccess.mockRejectedValueOnce(denied);
    await expect(service.getForOwner('other-owner', 'salon-1')).rejects.toBe(
      denied,
    );
    expect(config.get).not.toHaveBeenCalled();
  });

  it('does not share mutable capability objects between responses', async () => {
    const first = await service.getForOwner('owner-1', 'salon-1');
    first.features.inventory.status = 'DISABLED';
    first.features.offers.status = 'DISABLED';
    const second = await service.getForOwner('owner-2', 'salon-2');
    expect(second.features.inventory.status).toBe('ENABLED');
    expect(second.features.offers.status).toBe('ENABLED');
  });
});
