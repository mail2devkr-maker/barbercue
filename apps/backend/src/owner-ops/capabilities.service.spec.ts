import { ConfigService } from '@nestjs/config';
import { FASTQUE_CAPABILITY_KEYS } from '@barbercue/shared';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { SalonCapabilitiesService } from './capabilities.service';

describe('SalonCapabilitiesService', () => {
  const salonAccess = {
    assertOwnerAccess: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn() };
  let service: SalonCapabilitiesService;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue(undefined);
    service = new SalonCapabilitiesService(
      salonAccess as unknown as SalonAccessService,
      config as unknown as ConfigService,
    );
  });

  it('fails closed for every feature when no feature has been activated', async () => {
    const result = await service.getForOwner('owner-1', 'salon-1');
    expect(Object.keys(result.features).sort()).toEqual(
      [...FASTQUE_CAPABILITY_KEYS].sort(),
    );
    expect(result.features.demoData).toMatchObject({
      status: 'DISABLED',
      reasonCode: 'FEATURE_DISABLED',
    });
    expect(result.features.inventory.status).toBe('UNCONFIGURED');
    expect(salonAccess.assertOwnerAccess).toHaveBeenCalledWith(
      'owner-1',
      'salon-1',
    );
  });

  it('reports demo data as sandbox only when its explicit deployment flag is enabled', async () => {
    config.get.mockReturnValue('true');
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
    for (const key of FASTQUE_CAPABILITY_KEYS.filter(
      (entry) => entry !== 'demoData',
    )) {
      expect(result.features[key].status).toBe('UNCONFIGURED');
    }
  });
});
