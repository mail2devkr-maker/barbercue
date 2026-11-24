import { waitLabel } from '../LiveQueueCard';

describe('waitLabel', () => {
  it('shows No wait for zero', () => {
    expect(waitLabel({ estimatedWaitMinutes: 0, estimatedWaitRangeMinutes: null }, false)).toBe('No wait');
  });
  it('shows a range when the server gives one', () => {
    expect(waitLabel({ estimatedWaitMinutes: 15, estimatedWaitRangeMinutes: { min: 10, max: 20 } }, false)).toBe('10–20 min');
  });
  it('falls back to ~N min, and Hindi labels', () => {
    expect(waitLabel({ estimatedWaitMinutes: 12, estimatedWaitRangeMinutes: null }, false)).toBe('~12 min');
    expect(waitLabel({ estimatedWaitMinutes: 0, estimatedWaitRangeMinutes: null }, true)).toBe('कोई इंतज़ार नहीं');
    expect(waitLabel({ estimatedWaitMinutes: null, estimatedWaitRangeMinutes: null }, false)).toBe('Not available');
  });
});
