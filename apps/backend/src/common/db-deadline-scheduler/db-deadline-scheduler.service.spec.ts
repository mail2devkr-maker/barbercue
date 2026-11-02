import {
  DbDeadlineSchedulerService,
  resolveReconcileIntervalMs,
} from './db-deadline-scheduler.service';

describe('DbDeadlineSchedulerService', () => {
  let service: DbDeadlineSchedulerService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-26T00:00:00.000Z'));
    service = new DbDeadlineSchedulerService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('waits until the real deadline instead of polling every minute', async () => {
    const dueAt = new Date(Date.now() + 5_000);
    const nextDueAt = jest
      .fn(async (): Promise<Date | null> => dueAt)
      .mockResolvedValueOnce(dueAt)
      .mockResolvedValueOnce(null);
    const runDue = jest.fn(async (): Promise<void> => undefined);

    service.register({
      name: 'test-job',
      domain: 'booking',
      nextDueAt,
      runDue,
    });

    await jest.advanceTimersByTimeAsync(0);
    expect(nextDueAt).toHaveBeenCalledTimes(1);
    expect(runDue).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(4_999);
    expect(runDue).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(runDue).toHaveBeenCalledTimes(1);
  });

  it('replans a booking deadline when a live mutation signals the domain', async () => {
    const firstDue = new Date(Date.now() + 60_000);
    const earlierDue = new Date(Date.now() + 2_000);
    const nextDueAt = jest
      .fn(async (): Promise<Date | null> => firstDue)
      .mockResolvedValueOnce(firstDue)
      .mockResolvedValueOnce(earlierDue)
      .mockResolvedValueOnce(null);
    const runDue = jest.fn(async (): Promise<void> => undefined);

    service.register({
      name: 'test-job',
      domain: 'booking',
      nextDueAt,
      runDue,
    });
    await jest.advanceTimersByTimeAsync(0);

    service.signal('booking');
    await jest.advanceTimersByTimeAsync(50);
    expect(nextDueAt).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(1_950);
    expect(runDue).toHaveBeenCalledTimes(1);
  });

  describe('reconcile interval (DB_DEADLINE_RECONCILE_MS)', () => {
    const HOUR = 60 * 60 * 1000;
    const original = process.env.DB_DEADLINE_RECONCILE_MS;

    afterEach(() => {
      if (original === undefined) delete process.env.DB_DEADLINE_RECONCILE_MS;
      else process.env.DB_DEADLINE_RECONCILE_MS = original;
    });

    const lookupsAfter = async (envValue: string | undefined, ms: number) => {
      if (envValue === undefined) delete process.env.DB_DEADLINE_RECONCILE_MS;
      else process.env.DB_DEADLINE_RECONCILE_MS = envValue;
      const scheduler = new DbDeadlineSchedulerService();
      const nextDueAt = jest.fn(async (): Promise<Date | null> => null);
      scheduler.register({
        name: 'idle-job',
        domain: 'booking',
        nextDueAt,
        runDue: async () => undefined,
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(nextDueAt).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(ms);
      const calls = nextDueAt.mock.calls.length;
      scheduler.onModuleDestroy();
      return calls;
    };

    it('keeps the hourly safety-net tick by default (behaviour unchanged)', async () => {
      expect(await lookupsAfter(undefined, HOUR - 1)).toBe(1);
      expect(await lookupsAfter(undefined, HOUR + 1)).toBe(2); // the re-plan runs from a 0 ms timer queued at the tick
    });

    it('stretches the tick when configured, so an idle database is not woken hourly', async () => {
      const sixHours = String(6 * HOUR);
      expect(await lookupsAfter(sixHours, 5 * HOUR)).toBe(1);
      expect(await lookupsAfter(sixHours, 6 * HOUR + 1)).toBe(2);
    });

    it('resolves unsafe values to the default and caps the maximum', () => {
      expect(resolveReconcileIntervalMs(undefined)).toBe(HOUR);
      expect(resolveReconcileIntervalMs('')).toBe(HOUR);
      expect(resolveReconcileIntervalMs('abc')).toBe(HOUR);
      expect(resolveReconcileIntervalMs('1.5')).toBe(HOUR);
      expect(resolveReconcileIntervalMs('-1')).toBe(HOUR);
      expect(resolveReconcileIntervalMs('0')).toBe(HOUR);
      expect(resolveReconcileIntervalMs('299999')).toBe(HOUR);
      expect(resolveReconcileIntervalMs('300000')).toBe(300000);
      expect(resolveReconcileIntervalMs(String(6 * HOUR))).toBe(6 * HOUR);
      expect(resolveReconcileIntervalMs('999999999999')).toBe(24 * HOUR);
    });

    it('never schedules a reconcile more often than the default for a bad value', async () => {
      expect(await lookupsAfter('0', HOUR - 1)).toBe(1);
      expect(await lookupsAfter('1000', HOUR - 1)).toBe(1);
    });
  });
});
