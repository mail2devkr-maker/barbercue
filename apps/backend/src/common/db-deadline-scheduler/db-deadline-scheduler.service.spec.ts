import { DbDeadlineSchedulerService } from './db-deadline-scheduler.service';

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
});
