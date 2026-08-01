import { ChargeType } from '../enums';
import { computeCancellationCharge, computeSlotCapacity, isSlotBookable } from '../calc';

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
