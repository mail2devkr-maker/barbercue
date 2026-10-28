import { scheduleStatusAt, type WeeklyHours } from './shop-schedule';

const IST = 'Asia/Kolkata';
// 2026-10-26 is a Monday. 20:00 IST = 14:30 UTC.
const MON_8PM = new Date('2026-10-26T14:30:00.000Z');

function week(
  open: string,
  close: string,
  closedDays: number[] = [],
): WeeklyHours[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    openTime: open,
    closeTime: close,
    isClosed: closedDays.includes(dayOfWeek),
  }));
}

describe('scheduleStatusAt', () => {
  it('matches the blueprint example for Monday 8 PM', () => {
    const a = scheduleStatusAt(week('10:00', '21:00'), IST, MON_8PM);
    const b = scheduleStatusAt(week('09:00', '19:00'), IST, MON_8PM);
    const c = scheduleStatusAt(week('10:00', '21:00', [1]), IST, MON_8PM);

    expect(a).toMatchObject({ state: 'OPEN', todayLabel: '10:00–21:00' });
    expect(a.closesAt).toEqual(new Date('2026-10-26T15:30:00.000Z')); // 21:00 IST
    expect(b.state).toBe('CLOSED');
    expect(b.opensAt).toEqual(new Date('2026-10-27T03:30:00.000Z')); // Tue 09:00 IST
    expect(c).toMatchObject({ state: 'CLOSED', todayLabel: 'Closed' });
  });

  it('keeps an overnight shop open after midnight, from the previous day', () => {
    // Open 18:00–02:00 every day; Tuesday 01:00 IST is inside Monday's interval.
    const hours = week('18:00', '02:00');
    const tue1am = new Date('2026-10-26T19:30:00.000Z');
    const status = scheduleStatusAt(hours, IST, tue1am);
    expect(status.state).toBe('OPEN');
    expect(status.openedAt).toEqual(new Date('2026-10-26T12:30:00.000Z')); // Mon 18:00 IST
    expect(status.closesAt).toEqual(new Date('2026-10-26T20:30:00.000Z')); // Tue 02:00 IST
    expect(status.todayLabel).toBe('18:00–02:00 (overnight)');
  });

  it('does not carry an overnight interval into a day the shop is closed before', () => {
    // Sunday is closed, so early Monday is closed even though other days run overnight.
    const hours = week('18:00', '02:00', [0]);
    const mon1am = new Date('2026-10-25T19:30:00.000Z');
    expect(scheduleStatusAt(hours, IST, mon1am).state).toBe('CLOSED');
  });

  it('treats equal open and close times as open around the clock', () => {
    expect(scheduleStatusAt(week('00:00', '00:00'), IST, MON_8PM).state).toBe(
      'OPEN',
    );
  });

  it('reports UNKNOWN instead of CLOSED when hours or the time zone are missing', () => {
    expect(scheduleStatusAt([], IST, MON_8PM).state).toBe('UNKNOWN');
    expect(scheduleStatusAt(week('10:00', '21:00'), null, MON_8PM).state).toBe(
      'UNKNOWN',
    );
    // Hours configured for other days but not for today.
    const partial = week('10:00', '21:00').filter((h) => h.dayOfWeek !== 1);
    expect(scheduleStatusAt(partial, IST, MON_8PM).state).toBe('UNKNOWN');
  });

  it('uses the shop’s own time zone', () => {
    // 20:00 IST is 10:30 in New York (EDT): a 09:00–19:00 shop there is open.
    expect(
      scheduleStatusAt(week('09:00', '19:00'), 'America/New_York', MON_8PM)
        .state,
    ).toBe('OPEN');
  });
});
