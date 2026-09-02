import {
  INDIA_TIME_ZONE,
  addZonedCalendarDays,
  isOpenAt,
  resolveSalonTimeZone,
  utcToZonedDateStr,
  zonedDayBounds,
  zonedHourOf,
  zonedWallTimeToUtc,
} from './timezone';

describe('timezone helpers', () => {
  it('uses an explicit valid IANA timezone and falls back only for India', () => {
    expect(
      resolveSalonTimeZone({
        timezone: 'Europe/London',
        countryCode: 'GB',
      }),
    ).toBe('Europe/London');
    expect(resolveSalonTimeZone({ countryCode: 'IN' })).toBe(
      INDIA_TIME_ZONE,
    );
    expect(resolveSalonTimeZone({ countryCode: 'US' })).toBeNull();
    expect(
      resolveSalonTimeZone({ timezone: 'Not/AZone', countryCode: 'US' }),
    ).toBeNull();
  });

  it('converts London wall time with the correct summer and winter offsets', () => {
    expect(
      zonedWallTimeToUtc(
        '2026-07-01',
        '09:00',
        'Europe/London',
      )?.toISOString(),
    ).toBe('2026-07-01T08:00:00.000Z');
    expect(
      zonedWallTimeToUtc(
        '2026-01-15',
        '09:00',
        'Europe/London',
      )?.toISOString(),
    ).toBe('2026-01-15T09:00:00.000Z');
  });

  it('rejects a wall time inside a DST spring-forward gap', () => {
    expect(
      zonedWallTimeToUtc('2026-03-29', '01:30', 'Europe/London'),
    ).toBeNull();
  });

  it('pins down the deterministic (but unflagged) instant chosen during a DST fall-back, unlike the spring-forward gap above', () => {
    // 2026-11-01 is America/New_York's fall-back date (02:00 EDT -> 01:00 EST at 06:00 UTC), so
    // "01:30" is a real, valid local time that occurs twice: 05:30Z (EDT) and 06:30Z (EST). This
    // does NOT return null the way the spring-forward gap does — see this function's own doc
    // comment for why an ambiguous-but-valid local time is treated differently from a
    // nonexistent one. Pinned here so a future change to the iterative correction can't silently
    // flip which of the two valid instants gets returned without a test catching it.
    expect(
      zonedWallTimeToUtc(
        '2026-11-01',
        '01:30',
        'America/New_York',
      )?.toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
  });

  it('builds 23-hour and 25-hour local-day bounds across DST changes', () => {
    const spring = zonedDayBounds(
      new Date('2026-03-29T12:00:00.000Z'),
      'Europe/London',
    );
    const autumn = zonedDayBounds(
      new Date('2026-10-25T12:00:00.000Z'),
      'Europe/London',
    );
    expect(spring!.end.getTime() - spring!.start.getTime()).toBe(
      23 * 60 * 60_000,
    );
    expect(autumn!.end.getTime() - autumn!.start.getTime()).toBe(
      25 * 60 * 60_000,
    );
  });

  it('converts instants to the salon-local date and hour', () => {
    const instant = new Date('2026-07-01T23:30:00.000Z');
    expect(utcToZonedDateStr(instant, 'Asia/Kolkata')).toBe('2026-07-02');
    expect(zonedHourOf(instant, 'America/New_York')).toBe(19);
    expect(addZonedCalendarDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('computes Open now in the salon timezone and stays unknown without one', () => {
    const hours = [
      {
        dayOfWeek: 1,
        isClosed: false,
        openTime: '09:00',
        closeTime: '18:00',
      },
    ];
    const mondayNoonLondon = new Date('2026-07-06T11:00:00.000Z');
    expect(isOpenAt(hours, 'Europe/London', mondayNoonLondon)).toBe(true);
    expect(isOpenAt(hours, null, mondayNoonLondon)).toBeNull();
  });
});
