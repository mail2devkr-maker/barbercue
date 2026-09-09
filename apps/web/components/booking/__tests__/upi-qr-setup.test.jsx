import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { PaymentQrSection } from '../../dashboard/PaymentQrSection';
import { apiFetch } from '../../../lib/api';
jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class extends Error {} }));
jest.mock('../../ui/Button', () => ({ Button: ({ children, variant, ...props }) => <button data-variant={variant} {...props}>{children}</button> }));
let tree;
const detected = { salonId: 's', paymentQrImageUrl: 'https://cdn.example/qr.png', upiVpa: 'shop@bank', upiPayeeName: 'Shop', upiQrDecoded: true };
const text = () => JSON.stringify(tree.toJSON());
const button = (label) => tree.root.findAllByType('button').find((node) => node.children.join('') === label);
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); apiFetch.mockResolvedValue(detected); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });
async function render() { await act(async () => { tree = TestRenderer.create(<PaymentQrSection salonId="s" />); }); }
it('normal owner UI displays extracted data, no VPA/payee inputs or save button', async () => {
  await render(); expect(text()).toContain('shop@bank'); expect(text()).toContain('Tap to Pay enabled');
  expect(tree.root.findAllByType('input').map((node) => node.props.type)).toEqual(['url', 'file']);
  expect(button('Save UPI details')).toBeUndefined();
});
it('upload displays new detected routing directly from its response', async () => {
  await render(); apiFetch.mockResolvedValue({ ...detected, upiVpa: 'new@bank' });
  await act(async () => tree.root.findAllByType('input').find((node) => node.props.type === 'file').props.onChange({ target: { files: [new Blob(['test'], { type: 'image/png' })] } }));
  await act(async () => button('Upload QR code').props.onClick());
  expect(apiFetch).toHaveBeenLastCalledWith('dashboard/salons/s/payment-qr/upload', expect.objectContaining({ method: 'POST', body: expect.any(FormData) }));
  expect(text()).toContain('new@bank'); expect(text()).not.toContain('shop@bank');
});
it('undecoded link replacement removes old account and shows QR-only fallback', async () => {
  await render(); apiFetch.mockResolvedValue({ ...detected, upiVpa: null, upiPayeeName: null, upiQrDecoded: false });
  await act(async () => tree.root.findAllByType('input').find((node) => node.props.type === 'url').props.onChange({ target: { value: 'https://cdn.example/replacement.png' } }));
  await act(async () => button('Link QR code image').props.onClick());
  expect(text()).not.toContain('shop@bank'); expect(text()).toContain('Tap to Pay is unavailable');
});
it('delete immediately removes detected UI', async () => {
  await render(); apiFetch.mockResolvedValue(undefined); await act(async () => button('Remove QR code').props.onClick());
  expect(text()).not.toContain('shop@bank'); expect(text()).toContain('Upload your shop UPI QR');
});
