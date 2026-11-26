import { routeByRules, parsePeriod } from './vi-ask.service';
import { nextRun, tablePdf } from './vi-reports.service';
import { csvEscape, maskContact, viVisitorKey } from './vi-common';
import { countryFromTimezone, geoConfidence, geoFromHeaders } from './vi-geo';

describe('Ask FastQue AI routing (rules, no model)', () => {
  it.each([
    ['How many visitors today?', 'visitors', 'today'],
    ['Which city has the most demand?', 'top_demand_cities', undefined],
    [
      'Where should we onboard the next 100 salons?',
      'onboarding_targets',
      undefined,
    ],
    ['Why are bookings abandoned?', 'abandonment', undefined],
    ['What are people searching for this week?', 'top_searches', '7d'],
    [
      'Which channel brings the most bookings in the last 30 days',
      'channels',
      '30d',
    ],
    ['How many people are online right now', 'live_now', undefined],
    ['what is our conversion this month', 'conversion', 'month'],
  ])('%s', (q, tool, period) => {
    const r = routeByRules(q);
    expect(r?.tool).toBe(tool);
    if (period) expect(r?.period).toBe(period);
  });

  it('extracts both sides of a comparison', () => {
    const r = routeByRules('Compare Delhi-NCR vs Indore');
    expect(r).toMatchObject({
      tool: 'compare_cities',
      cities: ['delhi-ncr', 'indore'],
    });
  });

  it('parses the onboarding target size', () => {
    expect(
      routeByRules('where should we onboard the next 100 salons')?.limit,
    ).toBe(100);
  });

  it('only ever routes to a whitelisted tool (no free-form querying)', () => {
    expect(routeByRules('tell me a joke')).toBeNull();
    // Even SQL-looking text can only select a read-only tool; it is never executed as SQL.
    const r = routeByRules("'; DROP TABLE users; -- how many visitors");
    expect(r?.tool).toBe('visitors');
    expect(Object.keys(r ?? {}).sort()).toEqual(['period', 'tool']);
  });

  it('never returns the custom period from text', () => {
    expect(parsePeriod('ytd')).toBe('year');
    expect(parsePeriod('nothing here')).toBeUndefined();
  });
});

describe('exports', () => {
  it('neutralises spreadsheet formulas and quotes', () => {
    expect(csvEscape('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape(12)).toBe('12');
    expect(csvEscape(null)).toBe('');
  });

  it('builds a structurally valid multi-page PDF', () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({
      City: `City ${i}`,
      Visitors: i,
      'Value (₹)': i * 10,
    }));
    const pdf = tablePdf('Test (report)', rows).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trim().endsWith('%%EOF')).toBe(true);
    expect((pdf.match(/\/Type \/Page /g) ?? []).length).toBeGreaterThan(1);
    const xref = Number(pdf.match(/startxref\n(\d+)/)?.[1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
  });

  it('schedules at 08:00 IST on the right day', () => {
    const from = new Date('2026-11-25T10:00:00Z'); // Wednesday
    expect(nextRun('DAILY', from).toISOString()).toBe(
      '2026-11-26T02:30:00.000Z',
    );
    expect(nextRun('WEEKLY', from).getUTCDay()).toBe(1);
    expect(nextRun('MONTHLY', from).toISOString()).toBe(
      '2026-12-01T02:30:00.000Z',
    );
  });
});

describe('privacy helpers', () => {
  it('masks contacts', () => {
    expect(maskContact('+919876543210')).toBe('*********3210');
    expect(maskContact('person@example.com')).toBe('p***@example.com');
  });

  it('pseudonymous visitor keys are stable, peppered and not the raw id', () => {
    const id = '6f1c4f6e-1f7c-4a63-9a43-2b0c3e8c9d11';
    expect(viVisitorKey(id)).toBe(viVisitorKey(id.toUpperCase()));
    expect(viVisitorKey(id)).toHaveLength(64);
    expect(viVisitorKey(id)).not.toContain('6f1c4f6e');
  });
});

describe('approximate geolocation', () => {
  it('reads CDN headers and never trusts junk codes', () => {
    expect(
      geoFromHeaders({
        'cf-ipcountry': 'IN',
        'cf-ipcity': 'Indore',
        'cf-region': 'Madhya Pradesh',
      }),
    ).toEqual({
      country: 'India',
      state: 'Madhya Pradesh',
      city: 'Indore',
      source: 'CDN_HEADER',
    });
    expect(geoFromHeaders({ 'cf-ipcountry': 'XX' })).toBeNull();
    expect(
      geoFromHeaders({
        'x-vercel-ip-country': 'AE',
        'x-vercel-ip-city': 'Dubai',
      })?.country,
    ).toBe('United Arab Emirates');
    expect(geoFromHeaders({})).toBeNull();
  });

  it('timezone gives a country hint only', () => {
    expect(countryFromTimezone('Asia/Kolkata')).toBe('India');
    expect(countryFromTimezone('America/Chicago')).toBeNull();
  });

  it('IP city is low confidence; explicit permission is high', () => {
    expect(geoConfidence('CDN_HEADER', true)).toBe('low');
    expect(geoConfidence('BROWSER_PERMISSION', true)).toBe('high');
    expect(geoConfidence('USER_SELECTED', true)).toBe('medium');
  });
});
