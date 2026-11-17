import { recordSalonViewPath, shouldRecordSalonView } from '../record-salon-view';

describe('recording a salon view (Recently viewed)', () => {
  it('records only for a signed-in customer', () => {
    expect(shouldRecordSalonView('authenticated', ['CUSTOMER'])).toBe(true);
    expect(shouldRecordSalonView('authenticated', ['CUSTOMER', 'SALON_OWNER'])).toBe(true);
  });

  it('never records for guests, loading sessions, or owner/staff-only accounts', () => {
    expect(shouldRecordSalonView('unauthenticated', ['CUSTOMER'])).toBe(false);
    expect(shouldRecordSalonView('loading', ['CUSTOMER'])).toBe(false);
    expect(shouldRecordSalonView('authenticated', ['SALON_OWNER'])).toBe(false);
    expect(shouldRecordSalonView('authenticated', [])).toBe(false);
    expect(shouldRecordSalonView('authenticated', undefined)).toBe(false);
  });

  it('posts to recently-viewed/<salon id>', () => {
    expect(recordSalonViewPath('abc-123')).toBe('recently-viewed/abc-123');
  });
});
