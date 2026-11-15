import { DbDeadlineSchedulerService, reconcileIntervalMs } from './db-deadline-scheduler.service';

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

  it('tells listeners about domain signals and the reconcile tick (6 h by default)', async () => {
    const seen: string[] = [];
    service.onSignal((reason) => seen.push(reason));
    service.signal('queue');
    expect(seen).toEqual(['queue']);
    jest.advanceTimersByTime(60 * 60 * 1000);
    expect(seen).toEqual(['queue']);
    jest.advanceTimersByTime(5 * 60 * 60 * 1000);
    expect(seen).toEqual(['queue', 'reconcile']);
  });
});

describe('reconcileIntervalMs', () => {
  it('defaults to 6 h, honours an override and never drops below 15 min', () => {
    expect(reconcileIntervalMs(undefined)).toBe(6 * 60 * 60 * 1000);
    expect(reconcileIntervalMs('')).toBe(6 * 60 * 60 * 1000);
    expect(reconcileIntervalMs('abc')).toBe(6 * 60 * 60 * 1000);
    expect(reconcileIntervalMs('3600000')).toBe(3600000);
    expect(reconcileIntervalMs('1000')).toBe(15 * 60 * 1000);
  });
});
