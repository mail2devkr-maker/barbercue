import { MaintenanceStatusController } from './maintenance-status.controller';
import { MaintenanceModeService } from './maintenance-mode.service';

describe('MaintenanceStatusController', () => {
  it('returns only the public maintenance status contract', () => {
    const status = { enabled: true, message: 'Scheduled maintenance.' };
    const controller = new MaintenanceStatusController({
      getStatus: () => status,
    } as MaintenanceModeService);

    expect(controller.status()).toEqual(status);
  });
});
