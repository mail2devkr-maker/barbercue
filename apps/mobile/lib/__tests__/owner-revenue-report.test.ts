import {
  dateKeyInTimezone,
  ownerRevenueCsvPath,
  ownerRevenueReportPath,
  ownerRevenueTimezonePath,
  revenuePresetRange,
  validateRevenueRange,
} from '../owner-revenue-report';

describe('owner revenue report helpers', () => {
  it('builds an encoded salon-scoped timezone and report request', () => {
    expect(ownerRevenueTimezonePath('salon/one')).toBe('dashboard/salons/salon%2Fone/timezone');
    expect(ownerRevenueReportPath('salon/one', {
      from: '2026-10-01', to: '2026-10-28', groupBy: 'week', source: 'FASTQUE_APP',
    })).toBe('dashboard/salons/salon%2Fone/revenue/report?from=2026-10-01&to=2026-10-28&groupBy=week&source=FASTQUE_APP');
    expect(ownerRevenueCsvPath('salon/one', {
      from: '2026-10-01', to: '2026-10-28', groupBy: 'week', source: 'FASTQUE_APP',
    })).toBe('dashboard/salons/salon%2Fone/revenue/report.csv?from=2026-10-01&to=2026-10-28&groupBy=week&source=FASTQUE_APP');
  });

  it('derives today in the salon timezone rather than the device timezone', () => {
    expect(dateKeyInTimezone('Asia/Kolkata', new Date('2026-10-27T20:00:00.000Z'))).toBe('2026-10-28');
  });

  it('builds inclusive date presets and validates the same 366-day API boundary', () => {
    expect(revenuePresetRange('7d', '2026-10-28')).toEqual({ from: '2026-10-22', to: '2026-10-28' });
    expect(revenuePresetRange('30d', '2026-10-28')).toEqual({ from: '2026-09-29', to: '2026-10-28' });
    expect(revenuePresetRange('this-month', '2026-10-28')).toEqual({ from: '2026-10-01', to: '2026-10-28' });
    expect(validateRevenueRange('2026-01-01', '2026-12-31')).toBeNull();
    expect(validateRevenueRange('2025-12-30', '2026-12-31')).toContain('366 days');
    expect(validateRevenueRange('2026-02-30', '2026-03-01')).toContain('valid dates');
    expect(validateRevenueRange('2026-03-02', '2026-03-01')).toContain('on or after');
  });
});
