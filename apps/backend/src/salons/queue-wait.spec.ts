import { estimateQueueWait } from './queue-wait';

const base = {
  waitingCount: 0,
  activeStaff: 2,
  activeChairs: 2,
  occupiedChairs: 0,
  avgServiceMinutes: 30,
  activeSessions: [],
};

describe('estimateQueueWait (same formula as the queue page)', () => {
  it('no one waiting and no one in the chair → no wait', () => {
    expect(estimateQueueWait(base)).toEqual({
      waitingCount: 0,
      estimatedWaitMinutes: 0,
      range: { min: 0, max: 5 },
    });
  });

  it('people ahead are served in batches of the salon capacity, plus time left in the chair', () => {
    // 5 waiting, capacity 2 → 2 full batches × 30 min, plus 10 min left on the current services.
    const wait = estimateQueueWait({
      ...base,
      waitingCount: 5,
      activeSessions: [
        { durationMinutes: 30, elapsedMinutes: 20 },
        { durationMinutes: 30, elapsedMinutes: 20 },
      ],
    });
    expect(wait?.estimatedWaitMinutes).toBe(70);
    expect(wait?.range).toEqual({ min: 52, max: 88 });
  });

  it('capacity is the scarcer of staff and free chairs; none at all → no estimate', () => {
    expect(
      estimateQueueWait({
        ...base,
        waitingCount: 3,
        activeChairs: 2,
        occupiedChairs: 1,
      })?.estimatedWaitMinutes,
    ).toBe(90); // 1 free chair → 3 batches
    expect(estimateQueueWait({ ...base, activeStaff: 0 })).toBeNull();
    expect(
      estimateQueueWait({ ...base, avgServiceMinutes: null, waitingCount: 2 })
        ?.estimatedWaitMinutes,
    ).toBe(30); // falls back to 30-minute services
  });
});
