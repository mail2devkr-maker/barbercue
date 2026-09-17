const fs = require('fs');
const path = require('path');

describe('optional payment booking hotfix', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'BookingFlow.tsx'), 'utf8');

  it('keeps confirm booking enabled when online payment is not configured', () => {
    expect(source).toContain('disabled={submitting}');
    expect(source).not.toContain('paymentInfo !== null && !paymentInfo.onlinePaymentAvailable');
  });

  it('tells customers they can pay at the shop instead of blocking booking', () => {
    expect(source).toContain('Online payment is not configured for this shop. You can still confirm now and pay the shop directly.');
    expect(source).not.toContain('Online booking is unavailable because this shop has not configured online payment yet.');
  });
});
