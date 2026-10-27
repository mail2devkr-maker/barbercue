import { adminTimeseriesQuerySchema } from '@barbercue/shared';
import { bucketOf, bucketsFor } from './admin-timeseries.service';

describe('time buckets', () => {
  it('groups days into Monday-start weeks and calendar months', () => {
    expect(bucketOf('2026-10-27', 'day')).toBe('2026-10-27');
    expect(bucketOf('2026-10-27', 'week')).toBe('2026-10-26'); // Tuesday -> Monday
    expect(bucketOf('2026-10-25', 'week')).toBe('2026-10-19'); // Sunday -> previous Monday
    expect(bucketOf('2026-10-27', 'month')).toBe('2026-10-01');
  });

  it('lists every bucket the range touches, in order, once', () => {
    expect(bucketsFor('2026-10-25', '2026-10-27', 'day')).toEqual([
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
    ]);
    expect(bucketsFor('2026-10-01', '2026-10-27', 'week')).toEqual([
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
    expect(bucketsFor('2026-09-15', '2026-11-02', 'month')).toEqual([
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
    ]);
  });
});

describe('adminTimeseriesQuerySchema', () => {
  const parse = (metrics: string, extra: Record<string, string> = {}) =>
    adminTimeseriesQuerySchema.safeParse({
      from: '2026-10-01',
      to: '2026-10-27',
      metrics,
      ...extra,
    });

  it('accepts known metrics, de-duplicates them and defaults to daily, no comparison', () => {
    const result = parse('cancelled, appointmentsBooked,cancelled');
    expect(result.success && result.data).toMatchObject({
      metrics: ['cancelled', 'appointmentsBooked'],
      granularity: 'day',
      compare: 'none',
    });
  });

  it('rejects unknown metrics, more than six series, and unsupported granularities', () => {
    expect(parse('appointmentsBooked,dropTable').success).toBe(false);
    expect(
      parse(
        'a,b,c,d,e,f,g'
          .split(',')
          .map(() => 'x')
          .join(','),
      ).success,
    ).toBe(false);
    expect(
      parse(
        'appointmentsBooked,appointmentsCompleted,walkInsServed,completedVisits,cancelled,noShow,newSalons',
      ).success,
    ).toBe(false);
    expect(parse('appointmentsBooked', { granularity: 'hour' }).success).toBe(
      false,
    );
  });
});
