import { ChargeType } from '../enums';
import {
  computeCancellationCharge,
  computeSlotCapacity,
  estimateWaitMinutes,
  haversineDistanceKm,
  isSlotBookable,
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
