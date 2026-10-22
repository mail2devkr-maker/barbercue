import { QueueAutoAssignTrigger } from './queue-auto-assign.trigger';

describe('QueueAutoAssignTrigger', () => {
  const originalMaintenanceMode = process.env.FASTQUE_MAINTENANCE_MODE;

  afterEach(() => {
    if (originalMaintenanceMode === undefined)
      delete process.env.FASTQUE_MAINTENANCE_MODE;
    else process.env.FASTQUE_MAINTENANCE_MODE = originalMaintenanceMode;
  });

  it('does not start an automatic assignment pass while maintenance is enabled', async () => {
    process.env.FASTQUE_MAINTENANCE_MODE = 'true';
    const trigger = new QueueAutoAssignTrigger();
    const handler = jest.fn(async () => undefined);
    trigger.register(handler);

    trigger.trigger('salon-1');
    await trigger.idle('salon-1');

    expect(handler).not.toHaveBeenCalled();
  });

  it('runs normal triggers when maintenance is disabled', async () => {
    delete process.env.FASTQUE_MAINTENANCE_MODE;
    const trigger = new QueueAutoAssignTrigger();
    const handler = jest.fn(async () => undefined);
    trigger.register(handler);

    trigger.trigger('salon-1');
    await trigger.idle('salon-1');

    expect(handler).toHaveBeenCalledWith('salon-1');
  });

  it('drains the active assignment without starting a queued repeat on shutdown', async () => {
    delete process.env.FASTQUE_MAINTENANCE_MODE;
    const trigger = new QueueAutoAssignTrigger();
    let announceStarted: () => void = () => {};
    let unblock: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      announceStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const handler = jest.fn(async () => {
      announceStarted();
      await blocked;
    });
    trigger.register(handler);

    trigger.trigger('salon-1');
    await started;
    trigger.trigger('salon-1');
    const shutdown = trigger.onModuleDestroy();
    unblock();
    await shutdown;

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
