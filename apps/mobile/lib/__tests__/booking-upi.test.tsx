/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { Image, Linking } from 'react-native';
import { formatMoney } from '@barbercue/shared';
import ConfirmBookingScreen from '../../screens/ConfirmBookingScreen';
import { BookingUpiAction } from '../../components/booking/BookingUpiAction';
import { Button } from '../../components/ui/Button';
import { apiFetch, ApiError } from '../api';

jest.mock('../api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {
  code = 'PAYMENT_QR_REQUIRED'; constructor(_status: number, body: { error: { message: string } }) { super(body.error.message); }
} }));
jest.mock('../auth-context', () => ({ useAuth: () => ({ status: 'authenticated' }) }));
jest.mock('../language-context', () => ({ useLanguage: () => ({ language: 'EN', t: require('@barbercue/shared').uiStringsFor('EN') }) }));
jest.mock('../idempotency', () => ({ newIdempotencyKey: () => '12345678-1234-4567-8910-123456789012' }));
jest.mock('../../components/auth/GoogleSignInGate', () => ({ GoogleSignInGate: () => null }));
jest.mock('../../components/ui', () => {
  const { View, Text } = require('react-native');
  return { Screen: View, Card: View, SectionHeader: () => null,
    Button: require('../../components/ui/Button').Button,
    InlineError: ({ message }: { message: string }) => require('react').createElement(Text, null, message) };
});

const qrUrl = 'https://cdn.example/qr.png';
const info = { onlinePaymentAvailable: true, paymentQrImageUrl: qrUrl, upiVpa: 'merchant@bank', upiPayeeName: 'Shop & Sons', currency: 'INR', upiQrDecoded: true };
const booking = { id: 'booking1', status: 'CONFIRMED', payableAmount: 419.25, servicePrice: 500, creditsRedeemedAmount: 80.75,
  serviceName: 'Haircut', salonName: 'Test Shop', slotStart: '2026-10-10T10:00:00Z', salonTimezone: 'Asia/Kolkata' };
const props = { route: { params: { salonId: 's', salonName: 'Test Shop', serviceId: 'svc', serviceName: 'Haircut', servicePrice: 500,
  salonTimezone: 'Asia/Kolkata', slotStart: booking.slotStart, slotEnd: '2026-10-10T10:30:00Z' } }, navigation: { navigate: jest.fn(), popToTop: jest.fn() } };
let tree: ReturnType<typeof TestRenderer.create>;
type TestNode = { props: Record<string, any> };
let createBooking: () => Promise<unknown>;
let paymentInfo: typeof info;
const qrImages = () => tree.root.findAllByType(Image).filter((image: TestNode) => image.props.source?.uri === qrUrl);
const payButtons = () => tree.root.findAllByType(Button).filter((button: TestNode) => button.props.title === 'Tap to Pay with UPI');
const screenText = () => JSON.stringify(tree.toJSON());
async function render() { await act(async () => { tree = TestRenderer.create(createElement(ConfirmBookingScreen, props as never)); }); }
async function confirm() {
  const button = tree.root.findAllByType(Button).find((item: TestNode) => item.props.title === require('@barbercue/shared').uiStringsFor('EN').confirm)!;
  await act(async () => { button.props.onPress(); });
}
beforeEach(() => {
  jest.clearAllMocks(); paymentInfo = { ...info }; createBooking = async () => ({ ...booking });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  (apiFetch as jest.Mock).mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method === 'POST') return createBooking();
    if (path.includes('payment-info')) return paymentInfo;
    if (path.includes('balance')) return { balance: 100 };
    return null;
  });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); jest.restoreAllMocks(); });

it('pre-booking has no QR, final payable value or payment action', async () => {
  await render(); expect(qrImages()).toHaveLength(0); expect(payButtons()).toHaveLength(0);
  expect(screenText()).not.toContain('Amount payable:'); expect(Linking.openURL).not.toHaveBeenCalled();
});
it('only successful creation enables QR and generic UPI using returned credits-adjusted amount', async () => {
  await render(); await confirm(); expect(qrImages()).toHaveLength(1); expect(payButtons()).toHaveLength(1);
  expect(screenText()).toContain(formatMoney(419.25, null));
  await act(async () => payButtons()[0].props.onPress());
  const uri = (Linking.openURL as jest.Mock).mock.calls[0][0];
  expect(uri).toMatch(/^upi:\/\/pay\?/); expect(uri).toContain('am=419.25'); expect(uri).toContain('pa=merchant%40bank');
  expect(screenText()).toContain('does not automatically verify'); expect(screenText()).not.toContain('Payment successful');
  expect((apiFetch as jest.Mock).mock.calls.filter(([, opts]) => opts?.method)).toHaveLength(1);
  expect(booking.status).toBe('CONFIRMED');
});
it('no Android handler yields actionable fallback, keeps QR and never writes a payment result', async () => {
  (Linking.openURL as jest.Mock).mockRejectedValue(new Error('No Activity found'));
  await render(); await confirm(); await act(async () => payButtons()[0].props.onPress());
  expect(qrImages()).toHaveLength(1); expect(screenText()).toContain('Could not open a UPI app');
  expect((apiFetch as jest.Mock).mock.calls.filter(([, opts]) => opts?.method)).toHaveLength(1);
});
it('QR-only salon can confirm and pay by QR without an intent button', async () => {
  paymentInfo = { ...info, upiVpa: null, upiPayeeName: null } as never;
  await render(); await confirm(); expect(qrImages()).toHaveLength(1); expect(payButtons()).toHaveLength(0);
});
it('unconfigured QR keeps confirm disabled', async () => {
  paymentInfo = { ...info, onlinePaymentAvailable: false, paymentQrImageUrl: null } as never;
  await render(); expect(tree.root.findAllByType(Button).some((button: TestNode) => button.props.disabled)).toBe(true);
  expect(qrImages()).toHaveLength(0); expect(payButtons()).toHaveLength(0);
});
it('server PAYMENT_QR_REQUIRED after a stale capability read never exposes pay action/QR', async () => {
  createBooking = async () => { throw new ApiError(400, { error: { code: 'PAYMENT_QR_REQUIRED', message: 'Shop payment QR is required' } }); };
  await render(); await confirm(); expect(screenText()).toContain('Shop payment QR is required');
  expect(qrImages()).toHaveLength(0); expect(payButtons()).toHaveLength(0);
});
it('pending create does not expose payment, then rejected create stays safe', async () => {
  let reject!: (reason: Error) => void;
  createBooking = () => new Promise((_, rejectPromise) => { reject = rejectPromise; });
  await render(); await confirm(); expect(qrImages()).toHaveLength(0); expect(payButtons()).toHaveLength(0);
  await act(async () => reject(new Error('slot full'))); expect(qrImages()).toHaveLength(0);
});
it('null or cancelled booking cannot launch a UPI action', async () => {
  await act(async () => { tree = TestRenderer.create(createElement(BookingUpiAction, { booking: null, paymentInfo: info as never })); });
  expect(tree.toJSON()).toBeNull();
  await act(async () => tree.update(createElement(BookingUpiAction, { booking: { ...booking, status: 'CANCELLED' } as never, paymentInfo: info as never })));
  expect(tree.toJSON()).toBeNull(); expect(Linking.openURL).not.toHaveBeenCalled();
});
