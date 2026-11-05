import { AssistantActionId as A } from '@barbercue/shared';
import { parseAssistantText } from './assistant-parser';
import { parsePeriod, resolvePeriod } from './assistant-period';
import {
  parseReportFollowUp,
  type ReportIntent,
} from './assistant-parser-report';

const shop = (t: string) => parseAssistantText(t, 'shop', 2026);

describe('period reports: the owner directive phrasings', () => {
  it.each([
    [
      "Show this week's bookings",
      A.BOOKINGS_REPORT,
      { kind: 'thisWeek' },
      null,
    ],
    [
      "Show last week's bookings",
      A.BOOKINGS_REPORT,
      { kind: 'lastWeek' },
      null,
    ],
    [
      "Show this month's bookings",
      A.BOOKINGS_REPORT,
      { kind: 'thisMonth' },
      null,
    ],
    [
      "Show last month's bookings",
      A.BOOKINGS_REPORT,
      { kind: 'lastMonth' },
      null,
    ],
    [
      'How many bookings happened in the last 30 days?',
      A.BOOKINGS_REPORT,
      { kind: 'lastDays', days: 30 },
      null,
    ],
    [
      'Pichhle 7 din mein kitni bookings hui?',
      A.BOOKINGS_REPORT,
      { kind: 'lastDays', days: 7 },
      null,
    ],
    [
      'पिछले 7 दिन में कितनी बुकिंग्स हुई',
      A.BOOKINGS_REPORT,
      { kind: 'lastDays', days: 7 },
      null,
    ],
    [
      'Show booking cancellations for this month',
      A.BOOKINGS_REPORT,
      { kind: 'thisMonth' },
      'CANCELLED',
    ],
    [
      'kal kitni bookings hui thi',
      A.BOOKINGS_REPORT,
      { kind: 'yesterday' },
      null,
    ],
    [
      '1 se 15 november ki bookings',
      A.BOOKINGS_REPORT,
      { kind: 'range', from: '2026-11-01', to: '2026-11-15' },
      null,
    ],
    [
      'bookings from 2026-10-01 to 2026-10-31',
      A.BOOKINGS_REPORT,
      { kind: 'range', from: '2026-10-01', to: '2026-10-31' },
      null,
    ],
    [
      'last month completed bookings',
      A.BOOKINGS_REPORT,
      { kind: 'lastMonth' },
      'COMPLETED',
    ],
    ['aaj kitni bookings hain', A.BOOKINGS_REPORT, { kind: 'today' }, null],
  ])('%s', (text, action, period, status) => {
    expect(shop(text)).toEqual({ action, period, status, page: 1 });
  });

  it.each([
    ['Is mahine kitne customers queue mein aaye?', { kind: 'thisMonth' }],
    ['इस महीने कितने कस्टमर क्यू में आए', { kind: 'thisMonth' }],
    ['last week queue mein kitne aaye', { kind: 'lastWeek' }],
    ['aaj queue mein kitne log aaye', { kind: 'today' }],
  ])('queue history: %s', (text, period) => {
    expect(shop(text)).toEqual({ action: A.QUEUE_HISTORY, period, page: 1 });
  });

  it('the live queue stays the live read; a period report never shadows a change or one booking', () => {
    expect(shop('queue mein abhi kitne hain')?.action).toBe(A.QUEUE_STATUS);
    expect(shop('aaj queue mein kitne hain')?.action).toBe(A.QUEUE_STATUS);
    expect(shop('aaj ki bookings dikhao')?.action).toBe(A.SCHEDULE_VIEW);
    expect(shop('aaj 5 baje wala appointment no show')?.action).toBe(
      A.BOOKING_NO_SHOW,
    );
    expect(shop('is mahine bookings kahan se aayi')?.action).toBe(
      A.BOOKING_SOURCES,
    );
    expect(shop('is mahine ki saari bookings cancel karo')?.action).not.toBe(
      A.BOOKINGS_REPORT,
    );
    expect(shop('is hafte ki cancellations')?.action).toBe(
      A.CANCELLATION_ANALYTICS,
    );
  });

  it('customer and admin screens never get shop reports', () => {
    expect(
      parseAssistantText("show this week's bookings", 'customer', 2026)?.action,
    ).not.toBe(A.BOOKINGS_REPORT);
    expect(
      parseAssistantText("show this week's bookings", 'admin', 2026)?.action,
    ).not.toBe(A.BOOKINGS_REPORT);
  });
});

describe('follow-ups change only the period or the page', () => {
  const prev: ReportIntent = {
    action: A.BOOKINGS_REPORT,
    period: { kind: 'thisWeek' },
    status: 'CANCELLED',
    page: 1,
  };
  it.each([
    ['aur last month?', { ...prev, period: { kind: 'lastMonth' } }],
    ['pichhle hafte ka?', { ...prev, period: { kind: 'lastWeek' } }],
    ['aur dikhao', { ...prev, page: 2 }],
    ['page 3', { ...prev, page: 3 }],
  ])('%s', (text, want) => {
    expect(parseReportFollowUp(text, prev, 1, 2026)).toEqual(want);
  });
  it('a new full question or a change is not a follow-up', () => {
    expect(
      parseReportFollowUp('last month queue mein kitne aaye', prev, 1, 2026),
    ).toBeNull();
    expect(
      parseReportFollowUp('chair 2 band kar do', prev, 1, 2026),
    ).toBeNull();
    expect(parseReportFollowUp('haan', prev, 1, 2026)).toBeNull();
  });
});

describe('periods resolve to whole days in the shop timezone (weeks Monday-Sunday)', () => {
  // Thursday 5 Nov 2026, 15:30 in India.
  const now = new Date('2026-11-05T10:00:00.000Z');
  const tz = 'Asia/Kolkata';
  const days = (spec: Parameters<typeof resolvePeriod>[0]) => {
    const r = resolvePeriod(spec, tz, now);
    return [r.fromDay, r.toDay];
  };
  it('calendar periods', () => {
    expect(days({ kind: 'today' })).toEqual(['2026-11-05', '2026-11-05']);
    expect(days({ kind: 'yesterday' })).toEqual(['2026-11-04', '2026-11-04']);
    expect(days({ kind: 'thisWeek' })).toEqual(['2026-11-02', '2026-11-05']);
    expect(days({ kind: 'lastWeek' })).toEqual(['2026-10-26', '2026-11-01']);
    expect(days({ kind: 'thisMonth' })).toEqual(['2026-11-01', '2026-11-05']);
    expect(days({ kind: 'lastMonth' })).toEqual(['2026-10-01', '2026-10-31']);
    expect(days({ kind: 'lastDays', days: 7 })).toEqual([
      '2026-10-30',
      '2026-11-05',
    ]);
    expect(days({ kind: 'lastDays', days: 30 })).toEqual([
      '2026-10-07',
      '2026-11-05',
    ]);
  });
  it('instants are shop midnights (IST = UTC+5:30), end exclusive', () => {
    const r = resolvePeriod({ kind: 'lastMonth' }, tz, now);
    expect(r.start.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });
  it('January last month wraps the year; Sunday belongs to the week that started Monday', () => {
    expect(
      resolvePeriod({ kind: 'lastMonth' }, tz, new Date('2027-01-10T06:00:00Z'))
        .fromDay,
    ).toBe('2026-12-01');
    expect(
      resolvePeriod({ kind: 'thisWeek' }, tz, new Date('2026-11-08T06:00:00Z'))
        .fromDay,
    ).toBe('2026-11-02');
  });
  it('unparseable or impossible dates are not periods', () => {
    expect(parsePeriod('31 feb to 2 mar bookings', 2026)).toBeNull();
    expect(parsePeriod('bookings dikhao', 2026)).toBeNull();
  });
});
