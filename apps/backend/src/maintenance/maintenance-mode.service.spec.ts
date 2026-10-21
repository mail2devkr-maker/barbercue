import {
  isFastQueMaintenanceEnabled,
  MaintenanceModeService,
  readMaintenanceConfiguration,
} from './maintenance-mode.service';

describe('MaintenanceModeService', () => {
  const originalMode = process.env.FASTQUE_MAINTENANCE_MODE;
  const originalMessage = process.env.FASTQUE_MAINTENANCE_MESSAGE;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.FASTQUE_MAINTENANCE_MODE;
    else process.env.FASTQUE_MAINTENANCE_MODE = originalMode;
    if (originalMessage === undefined)
      delete process.env.FASTQUE_MAINTENANCE_MESSAGE;
    else process.env.FASTQUE_MAINTENANCE_MESSAGE = originalMessage;
  });

  it('is disabled by default and exposes no maintenance copy', () => {
    expect(readMaintenanceConfiguration({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      message: null,
    });
  });

  it('only enables for an explicit true value and supplies a safe default notice', () => {
    expect(
      readMaintenanceConfiguration({
        FASTQUE_MAINTENANCE_MODE: ' true ',
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      enabled: true,
      message: expect.stringContaining('FastQue'),
    });
    expect(
      isFastQueMaintenanceEnabled({
        FASTQUE_MAINTENANCE_MODE: 'false',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it('uses only bounded operator-provided plain text and fails startup on invalid configuration', () => {
    expect(
      readMaintenanceConfiguration({
        FASTQUE_MAINTENANCE_MODE: 'true',
        FASTQUE_MAINTENANCE_MESSAGE: ' Scheduled window. ',
      } as NodeJS.ProcessEnv),
    ).toEqual({ enabled: true, message: 'Scheduled window.' });
    expect(() =>
      readMaintenanceConfiguration({
        FASTQUE_MAINTENANCE_MODE: 'enabled',
      } as NodeJS.ProcessEnv),
    ).toThrow('FASTQUE_MAINTENANCE_MODE must be true or false');
    expect(() =>
      readMaintenanceConfiguration({
        FASTQUE_MAINTENANCE_MODE: 'true',
        FASTQUE_MAINTENANCE_MESSAGE: 'x'.repeat(501),
      } as NodeJS.ProcessEnv),
    ).toThrow('FASTQUE_MAINTENANCE_MESSAGE must be at most 500 characters');
  });

  it('blocks model and raw database writes but permits read operations while enabled', () => {
    process.env.FASTQUE_MAINTENANCE_MODE = 'true';
    process.env.FASTQUE_MAINTENANCE_MESSAGE = 'Scheduled window.';
    const service = new MaintenanceModeService();

    expect(() => service.assertDatabaseOperationAllowed('updateMany')).toThrow(
      expect.objectContaining({ code: 'MAINTENANCE_MODE' }),
    );
    expect(() => service.assertDatabaseOperationAllowed('executeRaw')).toThrow(
      expect.objectContaining({ code: 'MAINTENANCE_MODE' }),
    );
    expect(() =>
      service.assertDatabaseOperationAllowed('unknownFutureWrite'),
    ).toThrow(expect.objectContaining({ code: 'MAINTENANCE_MODE' }));
    expect(() =>
      service.assertDatabaseOperationAllowed('findMany'),
    ).not.toThrow();
  });
});
