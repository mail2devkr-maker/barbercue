import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { BookingFlow } from '../BookingFlow';
import { BookingUpiAction } from '../BookingUpiAction';
import { apiFetch, ApiError } from '../../../lib/api';
import { formatMoney } from '@barbercue/shared';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error { code = 'PAYMENT_QR_REQUIRED'; } }));
jest.mock('../../../lib/auth-context', () => ({ useAuth: () => ({ status: 'authenticated' }) }));
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: () => '12345678-1234-4567-8910-123456789012' }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children }) => <a>{children}</a> }));
jest.mock('../../ui/Button', () => ({ Button: ({ children, variant, ...props }) => <button data-variant={variant} {...props}>{children}</button> }));
jest.mock('../../auth/GoogleIdentityButton', () => ({ GoogleIdentityButton: () => null }));
jest.mock('../ServiceStep', () => ({ ServiceStep: () => null }));
jest.mock('../StaffStep', () => ({ StaffStep: () => null }));
jest.mock('../DateStep', () => ({ DateStep: ({ onSelect }) => <button onClick={() => onSelect('2026-10-10')}>Select date</button> }));
jest.mock('../SlotStep', () => ({ SlotStep: ({ onSelect }) => <button onClick={() => onSelect({ slotStart: '2026-10-10T10:00:00Z', slotEnd: '2026-10-10T10:30:00Z' })}>Select slot</button> }));
jest.mock('../CancelBookingDialog', () => ({ CancelBookingDialog: () => null }));
jest.mock('../RescheduleBookingDialog', () => ({ RescheduleBookingDialog: () => null }));
jest.mock('../BookingActionsBar', () => ({ BookingActionsBar: () => null }));
jest.mock('../../queue/CheckInPanel', () => ({ canCheckIn: () => false, CheckInPanel: () => null }));

const qr = 'https://cdn.example/qr.png';
const info = { onlinePaymentAvailable: true, paymentQrImageUrl: qr, upiVpa: 'merchant@bank', upiPayeeName: 'Shop & Sons', currency: 'INR', upiQrDecoded: true };
const booking = { id: 'booking1', status: 'CONFIRMED', payableAmount: 419.25, servicePrice: 500, creditsRedeemedAmount: 80.75,
  serviceName: 'Haircut', salonName: 'Shop', slotStart: '2026-10-10T10:00:00Z', salonTimezone: 'Asia/Kolkata' };
let tree; let paymentInfo; let createBooking;
const text = () => JSON.stringify(tree.toJSON());
const qrImages = () => tree.root.findAllByType('img').filter((image) => image.props.src === qr);
const buttons = (label) => tree.root.findAllByType('button').filter((button) => button.children.join('') === label);
async function click(label) { await act(async () => buttons(label)[0].props.onClick()); }
async function renderFlow() {
  await act(async () => { tree = TestRenderer.create(<BookingFlow salonId="s" services={[{ id: 'svc', name: 'Haircut', price: 500 }]} operatingHours={[]}
    initialServiceId="svc" initialStaffId={null} currency="INR" countryCode="IN" salonTimezone="Asia/Kolkata" />); });
  await click('Select date'); await click('Select slot');
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Android', clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } } });
  globalThis.window = { location: { assign: jest.fn() } };
  jest.clearAllMocks(); paymentInfo = { ...info }; createBooking = async () => ({ ...booking });
  apiFetch.mockImplementation(async (path, opts) => {
    if (opts?.method === 'POST') return createBooking();
    if (path.includes('payment-info')) return paymentInfo;
    if (path.includes('balance')) return { balance: 100 };
    if (path.includes('cancellation-policy')) return null;
    return [];
  });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });
it('pre-booking hides QR/direct intent and does not label any final payable amount', async () => {
  await renderFlow(); expect(qrImages()).toHaveLength(0); expect(buttons('Tap to Pay with UPI')).toHaveLength(0);
  expect(text()).not.toContain('Amount payable:'); expect(window.location.assign).not.toHaveBeenCalled();
});
it('post-booking uses exact returned amount in mobile web intent and retains QR', async () => {
  await renderFlow(); await click('Confirm booking'); expect(qrImages()).toHaveLength(1);
  expect(text()).toContain(formatMoney(419.25, 'INR', 'IN')); await click('Tap to Pay with UPI');
  expect(window.location.assign).toHaveBeenCalledWith(expect.stringMatching(/^upi:\/\/pay\?.*am=419\.25&cu=INR$/));
  expect(text()).toContain('does not automatically verify'); expect(text()).not.toContain('Payment successful');
  expect(apiFetch.mock.calls.filter(([, opts]) => opts?.method)).toHaveLength(1);
});
it('desktop never launches a payment app and offers QR + copyable VPA instead', async () => {
  navigator.userAgent = 'Windows desktop'; await renderFlow(); await click('Confirm booking');
  expect(buttons('Tap to Pay with UPI')).toHaveLength(0); expect(qrImages()).toHaveLength(1); expect(text()).toContain('Pay from your phone');
  await click('Copy UPI ID'); expect(navigator.clipboard.writeText).toHaveBeenCalledWith('merchant@bank');
  expect(window.location.assign).not.toHaveBeenCalled();
});
it('unsupported mobile browser keeps QR with truthful no-handler instructions', async () => {
  window.location.assign.mockImplementation(() => { throw new Error('unsupported'); });
  await renderFlow(); await click('Confirm booking'); await click('Tap to Pay with UPI');
  expect(qrImages()).toHaveLength(1); expect(text()).toContain('If no UPI app opens');
});
it('QR-only salon remains bookable with QR fallback and no direct intent', async () => {
  paymentInfo = { ...info, upiVpa: null }; await renderFlow(); await click('Confirm booking');
  expect(qrImages()).toHaveLength(1); expect(buttons('Tap to Pay with UPI')).toHaveLength(0);
});
it('missing QR disables confirm without exposing routing', async () => {
  paymentInfo = { ...info, onlinePaymentAvailable: false, paymentQrImageUrl: null }; await renderFlow();
  expect(buttons('Confirm booking')[0].props.disabled).toBe(true); expect(qrImages()).toHaveLength(0);
});
it('server PAYMENT_QR_REQUIRED after stale read preserves pre-booking safety', async () => {
  createBooking = async () => { throw new ApiError('Shop payment QR is required'); };
  await renderFlow(); await click('Confirm booking'); expect(text()).toContain('Shop payment QR is required');
  expect(qrImages()).toHaveLength(0); expect(buttons('Tap to Pay with UPI')).toHaveLength(0);
});
it('in-flight booking never exposes QR or intent', async () => {
  let resolve; createBooking = () => new Promise((r) => { resolve = r; });
  await renderFlow(); await click('Confirm booking'); expect(qrImages()).toHaveLength(0); expect(buttons('Tap to Pay with UPI')).toHaveLength(0);
  await act(async () => resolve(booking)); expect(qrImages()).toHaveLength(1);
});
it('missing/cancelled booking action is inert', async () => {
  await act(async () => { tree = TestRenderer.create(<BookingUpiAction booking={null} paymentInfo={info} />); }); expect(tree.toJSON()).toBeNull();
  await act(async () => tree.update(<BookingUpiAction booking={{ ...booking, status: 'CANCELLED' }} paymentInfo={info} />)); expect(tree.toJSON()).toBeNull();
});
