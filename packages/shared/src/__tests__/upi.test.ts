import { buildBookingUpiUri, canLaunchBookingUpi, setSalonUpiSchema } from '../upi';
import { BookingStatus, PrepaymentRequirement } from '../enums';
const booking = { id: 'abc12345-booking', status: BookingStatus.CONFIRMED, payableAmount: 419.25 };
const info = { onlinePaymentAvailable: true, paymentMethod: 'UPI_QR' as const, paymentQrImageUrl: 'https://cdn.example/qr.png',
  upiVpa: 'merchant@bank', upiPayeeName: 'Shop & Sons / नाम', currency: 'INR', prepaymentRequirement: PrepaymentRequirement.NONE, prepaymentPercentage: null };
const attempt = '12345678-1234-4567-8910-123456789012';
describe('UPI intent contract (not settlement)', () => {
  it('no booking means no payment URI', () => expect(buildBookingUpiUri(null, info, attempt)).toBeNull());
  it('QR-only works without an intent', () => expect(canLaunchBookingUpi(booking, { ...info, upiVpa: null })).toBe(false));
  it('uses and encodes authoritative credits-adjusted payable amount, not a service estimate', () => {
    const url = new URL(buildBookingUpiUri({ ...booking, servicePrice: 500 } as typeof booking, info, attempt)!);
    expect(url.protocol).toBe('upi:'); expect(url.host).toBe('pay');
    expect(Object.fromEntries(url.searchParams)).toEqual({ pa: info.upiVpa, pn: info.upiPayeeName,
      tr: 'FQ12345678123445678910123456789012', tn: 'FastQue booking abc12345', am: '419.25', cu: 'INR' });
    expect(url.searchParams.get('tr')!.length).toBeLessThanOrEqual(35);
  });
  it('distinct launch attempts have distinct references', () => {
    expect(buildBookingUpiUri(booking, info, attempt)).not.toBe(buildBookingUpiUri(booking, info, '22345678-1234-4567-8910-123456789012'));
  });
  it.each([0, -1, NaN, Infinity, 1.234, 100000000])('does not launch invalid/zero amount %s', (payableAmount) => {
    expect(buildBookingUpiUri({ ...booking, payableAmount }, info, attempt)).toBeNull();
  });
  it('formats paise safely without rounding errors', () => {
    expect(new URL(buildBookingUpiUri({ ...booking, payableAmount: 10.10 }, info, attempt)!).searchParams.get('am')).toBe('10.10');
  });
  it('missing QR remains blocked even with routing fields', () => expect(canLaunchBookingUpi(booking, { ...info, paymentQrImageUrl: null })).toBe(false));
  it.each([undefined, null, 'GBP'])('does not label unknown/non-INR amounts as rupees', (currency) => expect(canLaunchBookingUpi(booking, { ...info, currency })).toBe(false));
  it.each([BookingStatus.CANCELLED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW])('cannot pay inactive booking %s', (status) => expect(canLaunchBookingUpi({ ...booking, status }, info)).toBe(false));
  it('build never mutates booking or invents a payment success', () => {
    const frozen = Object.freeze({ ...booking }); buildBookingUpiUri(frozen, info, attempt);
    expect(frozen).toEqual(booking); expect(buildBookingUpiUri(booking, info, 'fake-reference')).toBeNull();
  });
  it('requires explicit payee name with a VPA and enforces lengths', () => {
    expect(setSalonUpiSchema.safeParse({ upiVpa: 'x@bank', upiPayeeName: '' }).success).toBe(false);
    expect(setSalonUpiSchema.safeParse({ upiVpa: 'x'.repeat(256) + '@bank', upiPayeeName: 'Shop' }).success).toBe(false);
    expect(setSalonUpiSchema.safeParse({ upiVpa: 'x@bank', upiPayeeName: 'x'.repeat(101) }).success).toBe(false);
  });
});
