import { ChargeType } from '../enums';
import {
  computeCancellationCharge,
  computeSlotCapacity,
  estimateWaitMinutes,
  estimateWaitRangeMinutes,
  haversineDistanceKm,
  isSlotBookable,
  isWaitAlertWorthy,
  remainingSessionMinutes,
} from '../calc';

describe('computeCancellationCharge', () => {
  const policy = {
    freeCancellationWindowMinutes: 60,
    lateCancellationChargeType: ChargeType.PERCENTAGE,
    lateCancellationChargeValue: 50,
    noShowChargeType: ChargeType.PERCENTAGE,
    noShowChargeValue: 100,
  };

  it('charges nothing when cancelling outside the free window', () => {
    expect(computeCancellationCharge(policy, 500, 90, false)).toBe(0);
  });

  it('charges the late-cancellation percentage inside the free window', () => {
    expect(computeCancellationCharge(policy, 500, 10, false)).toBe(250);
  });

  it('charges the full no-show percentage regardless of the free window', () => {
    expect(computeCancellationCharge(policy, 500, 999, true)).toBe(500);
  });

  it('never exceeds the service price', () => {
    const flatOver = { ...policy, lateCancellationChargeType: ChargeType.FLAT, lateCancellationChargeValue: 9999 };
    expect(computeCancellationCharge(flatOver, 500, 10, false)).toBe(500);
  });
});

describe('computeSlotCapacity', () => {
  it('is bound by the scarcer resource: 3 barbers + 2 chairs = capacity 2', () => {
    expect(computeSlotCapacity(3, 2)).toBe(2);
  });

  it('is bound by the scarcer resource: 2 barbers + 3 chairs = capacity 2', () => {
    expect(computeSlotCapacity(2, 3)).toBe(2);
  });

  it('3 barbers + 3 chairs = capacity 3', () => {
    expect(computeSlotCapacity(3, 3)).toBe(3);
  });
});

describe('isSlotBookable', () => {
  it('rejects when consumed capacity meets slot capacity', () => {
    expect(isSlotBookable(2, 2)).toBe(false);
  });

  it('allows when consumed capacity is below slot capacity', () => {
    expect(isSlotBookable(2, 1)).toBe(true);
  });
});

describe('estimateWaitMinutes', () => {
  it('returns null when there is no capacity at all', () => {
    expect(estimateWaitMinutes(0, 5, 30, 0)).toBeNull();
  });

  it('is 0 plus the active-session offset when nobody is ahead', () => {
    expect(estimateWaitMinutes(2, 0, 30, 10)).toBe(10);
  });

  it('distributes people ahead across the server count in whole batches', () => {
    // 5 people ahead, 2 servers -> 2 full batches (10 people would be 5 batches; 5/2 floors to 2)
    expect(estimateWaitMinutes(2, 5, 30, 0)).toBe(60);
  });

  it('adds the active-sessions-remaining offset on top of the batch estimate', () => {
    expect(estimateWaitMinutes(2, 5, 30, 12)).toBe(72);
  });

  it('a single server serializes everyone ahead in sequence', () => {
    expect(estimateWaitMinutes(1, 3, 20, 0)).toBe(60);
  });
});

describe('haversineDistanceKm', () => {
  it('is 0 for the same point', () => {
    expect(haversineDistanceKm(12.9716, 77.5946, 12.9716, 77.5946)).toBeCloseTo(0, 5);
  });

  it('matches the known ~1.5km straight-line distance between two Bengaluru landmarks', () => {
    // MG Road (12.9716, 77.6033) to Cubbon Park (12.9763, 77.5929) — real-world reference distance.
    const km = haversineDistanceKm(12.9716, 77.6033, 12.9763, 77.5929);
    expect(km).toBeGreaterThan(1);
    expect(km).toBeLessThan(2);
  });

  it('is symmetric', () => {
    const a = haversineDistanceKm(12.97, 77.59, 13.08, 80.27);
    const b = haversineDistanceKm(13.08, 80.27, 12.97, 77.59);
    expect(a).toBeCloseTo(b, 8);
  });
});

describe('remainingSessionMinutes', () => {
  it('returns the straightforward remainder when still within nominal duration', () => {
    expect(remainingSessionMinutes(30, 10)).toBe(20);
  });

  it('is 0 remaining at the exact nominal duration', () => {
    // Exactly 0 remaining is itself "not > 0", so it falls to the overrun tail (5) rather than 0 —
    // still in the chair at minute 30 of a 30-minute cut is not "already done."
    expect(remainingSessionMinutes(30, 30)).toBe(5);
  });

  it('floors at the overrun tail instead of reporting negative/zero once past nominal duration', () => {
    expect(remainingSessionMinutes(30, 45)).toBe(5);
  });
});

describe('estimateWaitRangeMinutes', () => {
  it('is null when there is no point estimate to build a range around', () => {
    expect(estimateWaitRangeMinutes(null)).toBeNull();
  });

  it('never goes below 0 on the low end even for a small estimate', () => {
    expect(estimateWaitRangeMinutes(2)).toEqual({ min: 0, max: 7 });
  });

  it('widens proportionally for a larger estimate', () => {
    // 40 * 0.25 = 10 band
    expect(estimateWaitRangeMinutes(40)).toEqual({ min: 30, max: 50 });
  });
});

describe('isWaitAlertWorthy', () => {
  it('is true the moment the wait first drops into the turn-approaching window', () => {
    expect(isWaitAlertWorthy(12, 4)).toBe(true);
  });

  it('is false when already within the window and staying there (no new information)', () => {
    expect(isWaitAlertWorthy(4, 3)).toBe(false);
  });

  it('is true for a large swing even outside the approaching window', () => {
    expect(isWaitAlertWorthy(15, 30)).toBe(true);
  });

  it('is false for a small routine fluctuation', () => {
    expect(isWaitAlertWorthy(20, 22)).toBe(false);
  });

  it('is false once the estimate becomes unknown (nothing new to alert about)', () => {
    expect(isWaitAlertWorthy(20, null)).toBe(false);
  });

  it('is true on the very first estimate landing inside the approaching window', () => {
    expect(isWaitAlertWorthy(null, 3)).toBe(true);
  });
});
