import { monthEnd, monthStart, previousPeriod } from './finance-overview.service';

describe('finance overview periods', () => {
  it('compares with the same-length period just before', () => {
    expect(previousPeriod('2026-11-01', '2026-11-30')).toEqual({
      from: '2026-10-02',
      to: '2026-10-31',
    });
    expect(previousPeriod('2026-06-01', '2026-11-27')).toEqual({
      from: '2025-12-03',
      to: '2026-05-31',
    });
    expect(previousPeriod('2026-03-01', '2026-03-01')).toEqual({
      from: '2026-02-28',
      to: '2026-02-28',
    });
  });

  it('finds month boundaries across years', () => {
    expect(monthStart('2026-01-15', -1)).toBe('2025-12-01');
    expect(monthEnd('2024-02-10')).toBe('2024-02-29');
  });
});
