import {
  allocatePaise,
  buildRevenueExcelXml,
  csvCell,
} from './revenue-report.service';
import type { OwnerRevenueReportDto } from '@barbercue/shared';

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

  it('builds an Excel-compatible workbook with typed text cells and escaped XML', () => {
    const metrics = {
      completedVisits: 2,
      grossServiceValue: 150,
      estimatedServiceValue: 150,
      invoiceCount: 1,
      invoiceDiscounts: 10,
      invoicedAmount: 140,
      recordedCollections: 100,
      refunds: 0,
      netRecordedCollections: 100,
    };
    const report: OwnerRevenueReportDto = {
      salonId: 'salon-1',
      currency: 'INR',
      timeZone: 'Asia/Kolkata',
      from: '2026-10-01',
      to: '2026-10-02',
      groupBy: 'day',
      source: null,
      periods: [{ period: '2026-10-01', ...metrics }],
      totals: metrics,
      byService: [{ key: 'service-1', serviceId: 'service-1', label: '=1+1 & Haircut', ...metrics }],
      byStaff: [{ key: 'staff-1', staffId: 'staff-1', label: 'Staff <One>', identityVerified: true, ...metrics }],
      byCustomer: [{ key: 'customer-1', customerId: 'customer-1', label: 'Customer "One"', identityVerified: true, ...metrics }],
      dataSemantics: {
        estimateBasis: 'BOOKING_PRICE_SNAPSHOT_AND_CURRENT_QUEUE_SERVICE_PRICE',
        cashSource: 'SHOP_RECORDED_INVOICE_PAYMENT_LEDGER',
        serviceCashAllocation: 'PRO_RATA_BY_INVOICE_LINE_TOTAL',
        externalAttribution: 'CAMPAIGN_TOKEN_WHEN_PRESENT_LEGACY_SOURCE_PROJECTION_OTHERWISE',
      },
    };

    const workbook = buildRevenueExcelXml(report).toString('utf8');
    expect(workbook).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(workbook).toContain('<Worksheet ss:Name="Summary">');
    expect(workbook).toContain('<Worksheet ss:Name="Periods">');
    expect(workbook).toContain('<Worksheet ss:Name="Services">');
    expect(workbook).toContain('<Worksheet ss:Name="Staff">');
    expect(workbook).toContain('<Worksheet ss:Name="Customers">');
    expect(workbook).toContain('<Data ss:Type="Number">100</Data>');
    expect(workbook).toContain('<Data ss:Type="String">=1+1 &amp; Haircut</Data>');
    expect(workbook).toContain('Staff &lt;One&gt;');
    expect(workbook).toContain('Customer &quot;One&quot;');
    expect(workbook).not.toContain('ss:Formula');
  });
});
