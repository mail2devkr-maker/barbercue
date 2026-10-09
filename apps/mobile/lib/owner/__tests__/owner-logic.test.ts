import { ChairStatus, StaffMemberStatus, type OwnerBookingDetailDto, type SalonStaffDto } from '@barbercue/shared';
import {
  ANALYTICS_VIEWS,
  MOBILE_ANALYTICS_RANGES,
  analyticsPath,
  columnChart,
  formatDay,
  formatHour,
  formatHourList,
  formatMinutes,
  heatIntensity,
  rankedWidths,
  splitPercent,
  timezonePath,
} from '../analytics';
import { UNASSIGNED_COLUMN, addDays, bookingsForDatePath, formatDateHeading, groupBookingsByBarber, isPreferredOnly, todayInZone } from '../schedule';
import { computeReadiness, filterTimeZones, isReady, isSetupIncomplete, readinessFromDetails, statusLabel, supportedTimeZones } from '../settings';
import { buildQrLayout, QR_QUIET_ZONE } from '../qr';
import { OWNER_SECTIONS, WEBSITE_SECTION_IDS } from '../owner-sections';
import { uiStringsFor } from '@barbercue/shared';

describe('analytics helpers', () => {
  it('builds the same endpoint the website uses, scoped to one shop and range', () => {
    expect(analyticsPath('salon-1', '7d')).toBe('dashboard/salons/salon-1/analytics?range=7d');
    expect(timezonePath('salon-1')).toBe('dashboard/salons/salon-1/timezone');
    expect(analyticsPath('a/b', 'today')).toContain('a%2Fb');
  });

  it('offers exactly the ranges and views the website offers (no custom range)', () => {
    expect([...MOBILE_ANALYTICS_RANGES]).toEqual(['today', '7d', '30d']);
    expect([...ANALYTICS_VIEWS]).toEqual(['overview', 'value', 'operations']);
  });

  it('formats minutes like the website', () => {
    expect(formatMinutes(null)).toBe('—');
    expect(formatMinutes(0.4)).toBe('<1m');
    expect(formatMinutes(12)).toBe('12m');
    expect(formatMinutes(4.5)).toBe('4.5m');
    expect(formatMinutes(0)).toBe('0m');
  });

  it('formats hours in the shop wall clock without touching the device locale or zone', () => {
    expect([0, 1, 9, 12, 13, 23].map(formatHour)).toEqual(['12 AM', '1 AM', '9 AM', '12 PM', '1 PM', '11 PM']);
    expect(formatHour(24)).toBe('12 AM');
    expect(formatHourList([{ hour: 9, count: 4 }, { hour: 17, count: 2 }])).toBe('9 AM (4), 5 PM (2)');
  });

  it('formats already-local dates without a time zone shift', () => {
    expect(formatDay('2026-10-09')).toBe('Oct 9');
    expect(formatDay('2026-01-01')).toBe('Jan 1');
    expect(formatDay('garbage')).toBe('garbage');
    expect(formatDay('2026-13-01')).toBe('2026-13-01');
  });

  it('draws the value trend: tallest day is 100%, a small day stays visible, zero is flat, labels are thinned', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, completedCount: 1, estimatedServiceValue: i === 0 ? 0 : i === 1 ? 1 : 1000 }));
    const bars = columnChart(rows);
    expect(bars[0].heightPercent).toBe(0);
    expect(bars[1].heightPercent).toBeGreaterThanOrEqual(4);
    expect(bars[2].heightPercent).toBe(100);
    const shown = bars.filter((b) => b.showLabel);
    expect(shown.length).toBeLessThanOrEqual(8);
    expect(bars[bars.length - 1].showLabel).toBe(true);
    expect(columnChart([])).toEqual([]);
  });

  it('ranked bars scale to the largest value; nothing is invented for empty input', () => {
    expect(rankedWidths([])).toEqual([]);
    expect(rankedWidths([200, 100, 0])).toEqual([100, 50, 0]);
    expect(rankedWidths([1, 1000])[0]).toBeGreaterThanOrEqual(3);
  });

  it('split bars give 50/50 when there is nothing to compare, otherwise the true share', () => {
    expect(splitPercent(0, 0)).toBe(50);
    expect(splitPercent(3, 1)).toBe(75);
    expect(splitPercent(0, 5)).toBe(0);
  });

  it('heat intensity is clamped 0..1', () => {
    expect(heatIntensity(0, 100)).toBe(0);
    expect(heatIntensity(50, 100)).toBe(0.5);
    expect(heatIntensity(500, 100)).toBe(1);
    expect(heatIntensity(10, 0)).toBe(0);
  });
});

describe('schedule helpers', () => {
  const booking = (over: Partial<OwnerBookingDetailDto>): OwnerBookingDetailDto =>
    ({
      id: 'b',
      slotStart: '2026-10-09T04:30:00.000Z',
      slotEnd: '2026-10-09T05:00:00.000Z',
      serviceName: 'Haircut',
      status: 'CONFIRMED',
      assignedStaffId: null,
      assignedStaffName: null,
      preferredStaffId: null,
      preferredStaffName: null,
      customerPhone: null,
      ...over,
    }) as OwnerBookingDetailDto;
  const staff = [
    { id: 's1', displayName: 'Ravi' },
    { id: 's2', displayName: 'Amit' },
  ] as SalonStaffDto[];

  it("computes 'today' in the SHOP's zone, not the phone's", () => {
    const instant = new Date('2026-10-09T20:30:00.000Z'); // already Oct 10 in Kolkata, still Oct 9 in New York
    expect(todayInZone('Asia/Kolkata', instant)).toBe('2026-10-10');
    expect(todayInZone('America/New_York', instant)).toBe('2026-10-09');
  });

  it('does calendar arithmetic across month and year ends without a zone', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('nope', 1)).toBe('nope');
  });

  it('shows the requested calendar date regardless of device zone', () => {
    expect(formatDateHeading('2026-10-09', 'en-IN')).toMatch(/9/);
    expect(formatDateHeading('x')).toBe('x');
  });

  it('builds the paged bookings request for one day', () => {
    expect(bookingsForDatePath('s', '2026-10-09')).toBe('dashboard/salons/s/bookings?date=2026-10-09&limit=50');
    expect(bookingsForDatePath('s', '2026-10-09', 'c1')).toContain('cursor=c1');
  });

  it('groups by assigned barber, else preferred barber, else "no preference" — each booking once, in time order', () => {
    const list = [
      booking({ id: 'late', slotStart: '2026-10-09T09:00:00.000Z', preferredStaffId: 's1' }),
      booking({ id: 'early', slotStart: '2026-10-09T05:00:00.000Z', assignedStaffId: 's1' }),
      booking({ id: 'amit', assignedStaffId: 's2' }),
      booking({ id: 'any' }),
    ];
    const columns = groupBookingsByBarber(list, staff);
    expect(columns.map((c) => c.key)).toEqual(['s1', 's2', UNASSIGNED_COLUMN]);
    expect(columns[0].bookings.map((b) => b.id)).toEqual(['early', 'late']);
    expect(columns[2].label).toBeNull();
    expect(columns.flatMap((c) => c.bookings)).toHaveLength(list.length);
  });

  it('never loses a booking whose barber is no longer on the roster', () => {
    const columns = groupBookingsByBarber([booking({ id: 'x', assignedStaffId: 'gone', assignedStaffName: 'Old Barber' })], staff);
    expect(columns).toHaveLength(1);
    expect(columns[0].label).toBe('Old Barber');
  });

  it('distinguishes a customer preference from a real assignment', () => {
    expect(isPreferredOnly({ assignedStaffId: null, preferredStaffId: 's1' })).toBe(true);
    expect(isPreferredOnly({ assignedStaffId: 's2', preferredStaffId: 's1' })).toBe(false);
    expect(isPreferredOnly({ assignedStaffId: null, preferredStaffId: null })).toBe(false);
  });
});

describe('settings rules', () => {
  const svc = (isActive: boolean) => ({ isActive });
  const chair = (status: ChairStatus) => ({ status });
  const barber = (status: StaffMemberStatus) => ({ status });

  it('readiness needs an ACTIVE service, chair and barber (matches the backend gate)', () => {
    expect(computeReadiness([svc(true)], [chair(ChairStatus.ACTIVE)], [barber(StaffMemberStatus.ACTIVE)])).toEqual({ hasActiveService: true, hasActiveChair: true, hasActiveStaff: true });
    const missing = computeReadiness([svc(false)], [chair(ChairStatus.INACTIVE)], []);
    expect(missing).toEqual({ hasActiveService: false, hasActiveChair: false, hasActiveStaff: false });
    expect(isReady(missing)).toBe(false);
    expect(isReady({ hasActiveService: true, hasActiveChair: true, hasActiveStaff: true })).toBe(true);
  });

  it('narrows server readiness details instead of trusting them', () => {
    expect(readinessFromDetails({ hasActiveService: true, hasActiveChair: false, hasActiveStaff: true })).toEqual({ hasActiveService: true, hasActiveChair: false, hasActiveStaff: true });
    expect(readinessFromDetails({ hasActiveService: 'yes' })).toBeNull();
    expect(readinessFromDetails(null)).toBeNull();
    expect(readinessFromDetails(undefined)).toBeNull();
    expect(isSetupIncomplete('SALON_SETUP_INCOMPLETE')).toBe(true);
    expect(isSetupIncomplete('OTHER')).toBe(false);
  });

  it('names the shop status in plain words, including closed-for-today', () => {
    const t = uiStringsFor('EN');
    expect(statusLabel('PENDING', false, t)).toBe(t.shopStatusNotOpen);
    expect(statusLabel('ACTIVE', false, t)).toBe(t.shopStatusOpen);
    expect(statusLabel('ACTIVE', true, t)).toBe(t.shopStatusClosedToday);
    expect(statusLabel('SUSPENDED', false, t)).toBe(t.shopStatusPaused);
  });

  it('always offers Asia/Kolkata and keeps an unusual stored zone selectable', () => {
    const noSupport = supportedTimeZones('Legacy/Zone', { supportedValuesOf: undefined } as never);
    expect(noSupport).toContain('Asia/Kolkata');
    expect(noSupport[0]).toBe('Legacy/Zone');
    const calcuttaOnly = supportedTimeZones(null, { supportedValuesOf: () => ['Asia/Calcutta', 'UTC'] } as never);
    expect(calcuttaOnly[0]).toBe('Asia/Kolkata');
    expect(supportedTimeZones(null, { supportedValuesOf: () => { throw new Error('nope'); } } as never)).toContain('Asia/Kolkata');
  });

  it('time-zone search ignores case and treats spaces, slashes and underscores alike, and is bounded', () => {
    const zones = ['America/New_York', 'Asia/Kolkata', 'Europe/London', 'America/Los_Angeles'];
    expect(filterTimeZones(zones, 'new york')).toEqual(['America/New_York']);
    expect(filterTimeZones(zones, 'KOLKATA')).toEqual(['Asia/Kolkata']);
    expect(filterTimeZones(zones, 'america')).toHaveLength(2);
    expect(filterTimeZones(zones, '', 2)).toHaveLength(2);
    expect(filterTimeZones(zones, 'zzz')).toEqual([]);
  });
});

describe('QR layout', () => {
  it('produces a square symbol with a quiet zone and the three finder patterns', () => {
    const layout = buildQrLayout('https://fastque.com/q/abc123');
    expect(layout.rows).toHaveLength(layout.size);
    // Quiet-zone rows are empty.
    for (let i = 0; i < QR_QUIET_ZONE; i += 1) {
      expect(layout.rows[i]).toEqual([]);
      expect(layout.rows[layout.size - 1 - i]).toEqual([]);
    }
    // The first symbol row begins with the top-left finder pattern: a 7-module dark run.
    const firstRow = layout.rows[QR_QUIET_ZONE];
    expect(firstRow[0]).toEqual({ start: QR_QUIET_ZONE, length: 7 });
    // ...and the top-right finder ends exactly at the symbol's right edge.
    const last = firstRow[firstRow.length - 1];
    expect(last.start + last.length).toBe(layout.size - QR_QUIET_ZONE);
    // No run leaves the grid.
    for (const row of layout.rows) for (const run of row) expect(run.start + run.length).toBeLessThanOrEqual(layout.size);
  });

  it('is deterministic and grows with the payload', () => {
    expect(buildQrLayout('hello')).toEqual(buildQrLayout('hello'));
    expect(buildQrLayout('x'.repeat(200)).size).toBeGreaterThan(buildQrLayout('x').size);
  });
});

describe('owner section registry', () => {
  it('has exactly the website\'s 13 sections, in the website\'s order, each with a label and hint in both languages', () => {
    expect(OWNER_SECTIONS.map((s) => s.id)).toEqual([...WEBSITE_SECTION_IDS]);
    expect(OWNER_SECTIONS).toHaveLength(13);
    for (const language of ['EN', 'HI'] as const) {
      const t = uiStringsFor(language);
      for (const section of OWNER_SECTIONS) {
        expect(t[section.labelKey]).toBeTruthy();
        expect(t[section.hintKey]).toBeTruthy();
      }
    }
  });

  it('routes live queue and bookings to the existing tabs and everything else to its own screen', () => {
    const byId = Object.fromEntries(OWNER_SECTIONS.map((s) => [s.id, s.target]));
    expect(byId.queue).toEqual({ kind: 'tab', tab: 'OwnerQueueTab' });
    expect(byId.bookings).toEqual({ kind: 'tab', tab: 'OwnerBookingsTab' });
    for (const id of ['settings', 'schedule', 'customers', 'analytics', 'reviews', 'verification', 'services', 'hours', 'photos', 'chairs', 'staff']) {
      expect(byId[id].kind).toBe('screen');
    }
    const screens = OWNER_SECTIONS.flatMap((s) => (s.target.kind === 'screen' ? [s.target.screen] : []));
    expect(new Set(screens).size).toBe(screens.length);
  });
});
