import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { ComboChart, SERIES_COLORS } from '../ComboChart';
import { assignAxes, bucketLabel, clampMetrics, formatterFor, seriesTypeFor, timeseriesCsv } from '../chart-config';
import { matchesFilter } from '../../shops/ShopStatusBoard';

const count = (v) => String(v);

describe('chart configuration', () => {
  it('puts each unit on its own axis and refuses a third unit instead of mixing scales', () => {
    const { axes, units, blocked } = assignAxes(['appointmentsBooked', 'completedServiceValuePaise', 'cancelled', 'cancellationRatePercent']);
    expect(units).toEqual(['count', 'inr']);
    expect(Object.fromEntries(axes)).toEqual({ appointmentsBooked: 'left', completedServiceValuePaise: 'right', cancelled: 'left' });
    expect(blocked).toEqual(['cancellationRatePercent']);
  });

  it('three count KPIs share one axis (multi-line chart)', () => {
    const { axes, units, blocked } = assignAxes(['appointmentsBooked', 'appointmentsCompleted', 'cancelled']);
    expect(units).toEqual(['count']);
    expect([...axes.values()]).toEqual(['left', 'left', 'left']);
    expect(blocked).toEqual([]);
  });

  it('a combination chart draws the left-axis measure as columns and the other as a line', () => {
    expect(seriesTypeFor('combo', 'left')).toBe('column');
    expect(seriesTypeFor('combo', 'right')).toBe('line');
    expect(seriesTypeFor('area', 'right')).toBe('area');
  });

  it('never lets an untracked KPI (e.g. platform revenue) into a request', () => {
    expect(clampMetrics(['platformRevenue', 'cancelled', 'cancelled', 'chairUtilization'])).toEqual(['cancelled']);
  });

  it('labels units clearly', () => {
    expect(formatterFor('inr')(123456)).toBe('₹1,235');
    expect(formatterFor('percent')(12.34)).toBe('12.3%');
    expect(formatterFor('hours')(2.66)).toBe('2.7 h');
    expect(bucketLabel('2026-10-26', 'week')).toBe('Wk of 26 Oct');
    expect(bucketLabel('2026-10-01', 'month')).toBe('Oct 2026');
  });

  it('exports chart data in rupees with blanks for "not measurable" and comparison columns', () => {
    const csv = timeseriesCsv({
      from: '2026-10-01', to: '2026-10-02', granularity: 'day', timeZone: 'Asia/Kolkata', generatedAt: 'g',
      buckets: ['2026-10-01', '2026-10-02'],
      series: [
        { metric: 'completedServiceValuePaise', label: 'Completed service value', unit: 'inr', values: [12345, 0], previousValues: [100, null] },
        { metric: 'cancellationRatePercent', label: 'Cancellation rate', unit: 'percent', values: [null, 25] },
      ],
    }).split('\r\n');
    expect(csv[1]).toBe('"Period start (IST)","Completed service value (INR)","Completed service value (INR) — previous period","Cancellation rate (%)"');
    expect(csv[2]).toBe('"2026-10-01","123.45","1.00",""');
    expect(csv[3]).toBe('"2026-10-02","0.00","","25"');
  });
});

describe('ComboChart', () => {
  const render = (props) => {
    let tree;
    act(() => { tree = TestRenderer.create(<ComboChart ariaLabel="test" labels={['1 Oct', '2 Oct', '3 Oct']} {...props} />); });
    return tree;
  };
  const series = [
    { key: 'visits', label: 'Completed visits', values: [4, 0, 6], type: 'column', axis: 'left', color: SERIES_COLORS[0], format: count },
    { key: 'value', label: 'Service value', values: [1000, null, 3000], type: 'line', axis: 'right', color: SERIES_COLORS[1], format: (v) => `₹${v}` },
  ];

  it('labels both axes with their units and lists every series in the legend', () => {
    const tree = render({ series, leftAxisLabel: 'Count', rightAxisLabel: '₹ (INR)' });
    const texts = tree.root.findAll((n) => n.type === 'text').map((n) => n.children.join(''));
    expect(texts).toEqual(expect.arrayContaining(['Count', '₹ (INR)', '₹5000', '10'])); // rounded axis maxima
    const legend = tree.root.findAll((n) => n.type === 'button').map((b) => b.props['aria-pressed']);
    expect(legend).toEqual([true, true]);
  });

  it('draws a null as a gap in the line, not as zero', () => {
    const tree = render({ series });
    const linePaths = tree.root.findAll((n) => n.type === 'path' && n.props.stroke === SERIES_COLORS[1]);
    expect(linePaths).toHaveLength(2); // two separate segments around the missing day
    const rows = tree.root.findByType('tbody').findAllByType('tr');
    expect(rows[1].findAllByType('td').map((td) => td.children.join(''))).toEqual(['0', 'not measurable']);
  });

  it('hides a toggled series and reports the toggle', () => {
    const onToggle = jest.fn();
    const tree = render({ series, hidden: new Set(['value']), onToggle });
    expect(tree.root.findAll((n) => n.type === 'path' && n.props.stroke === SERIES_COLORS[1])).toHaveLength(0);
    const buttons = tree.root.findAll((n) => n.type === 'button');
    expect(buttons[1].props['aria-pressed']).toBe(false);
    act(() => buttons[1].props.onClick());
    expect(onToggle).toHaveBeenCalledWith('value');
  });
});

describe('shop status filters', () => {
  const now = Date.parse('2026-10-26T14:30:00.000Z');
  const row = (over) => ({
    scheduled: 'OPEN', opensAt: null, closesAt: null, temporarilyClosed: false, acceptingBookings: true, quietSince: null, ...over,
  });

  it('keeps scheduled status, temporary closure and accepting bookings separate', () => {
    const closedToday = row({ scheduled: 'OPEN', temporarilyClosed: true, acceptingBookings: false });
    expect(matchesFilter(closedToday, 'open', now)).toBe(true);
    expect(matchesFilter(closedToday, 'tempClosed', now)).toBe(true);
    expect(matchesFilter(closedToday, 'accepting', now)).toBe(false);
    expect(matchesFilter(row({ scheduled: 'UNKNOWN' }), 'closed', now)).toBe(false);
  });

  it('"soon" means within the next hour', () => {
    expect(matchesFilter(row({ scheduled: 'CLOSED', opensAt: '2026-10-26T15:00:00.000Z' }), 'openingSoon', now)).toBe(true);
    expect(matchesFilter(row({ scheduled: 'CLOSED', opensAt: '2026-10-26T16:00:00.000Z' }), 'openingSoon', now)).toBe(false);
    expect(matchesFilter(row({ closesAt: '2026-10-26T15:20:00.000Z' }), 'closingSoon', now)).toBe(true);
    expect(matchesFilter(row({ quietSince: '2026-10-26T09:00:00.000Z' }), 'quiet', now)).toBe(true);
  });
});
