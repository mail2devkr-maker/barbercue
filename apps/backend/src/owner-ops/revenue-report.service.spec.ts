import { allocatePaise, csvCell } from './revenue-report.service';

describe('revenue report accounting helpers', () => {
  it('allocates integer paise deterministically without changing the invoice total', () => {
    const result = allocatePaise(1001, [1, 2, 3]);
    expect(result).toEqual([166, 333, 502]);
    expect(result.reduce((sum, amount) => sum + amount, 0)).toBe(1001);
  });

  it('preserves totals when every line has a zero allocation weight', () => {
    const result = allocatePaise(31, [0, 0, 0]);
    expect(result).toEqual([10, 10, 11]);
    expect(result.reduce((sum, amount) => sum + amount, 0)).toBe(31);
  });

  it.each([
    '=SUM(A1:A2)',
    '+cmd',
    '-2+3',
    '@HYPERLINK("https://example.test")',
    '  =1+1',
    '\n=1+1',
    '\u0000 =1+1',
  ])('neutralizes spreadsheet formula text %s', (value) => {
    expect(csvCell(value)).toBe(`"'${value.replace(/"/g, '""')}"`);
  });

  it('quotes and escapes text while preserving numeric cells', () => {
    expect(csvCell('service, "premium"')).toBe('"service, ""premium"""');
    expect(csvCell(-125)).toBe('-125');
    expect(csvCell(null)).toBe('""');
  });
});
