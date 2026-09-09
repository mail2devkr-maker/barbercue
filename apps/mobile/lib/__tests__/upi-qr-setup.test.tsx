/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { TextInput } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { UpiRoutingStatus } from '../../components/owner/UpiRoutingStatus';
import { PaymentQrSection } from '../../components/owner/ShopSetupSections';
import { Button } from '../../components/ui/Button';
import { apiUploadImage } from '../api';
import { uploadImageAsset } from '../image-upload';

jest.mock('expo-image-picker', () => ({ requestMediaLibraryPermissionsAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
jest.mock('../api', () => ({ apiFetch: jest.fn(), apiUploadImage: jest.fn(), ApiError: class extends Error {}, NativeUploadError: class extends Error {} }));
jest.mock('../image-upload', () => ({ uploadImageAsset: jest.fn(), ImageUploadPreparationError: class extends Error {} }));
jest.mock('../language-context', () => ({ useLanguage: () => ({ language: 'EN', t: require('@barbercue/shared').uiStringsFor('EN') }) }));
jest.mock('../../components/ui', () => ({ Button: require('../../components/ui/Button').Button, InlineError: () => null, SafeImage: () => null }));

const detected = { salonId: 's', paymentQrImageUrl: 'https://cdn.example/qr.png', upiVpa: 'shop@bank', upiPayeeName: 'Shop', upiQrDecoded: true };
let tree: ReturnType<typeof TestRenderer.create>;
const text = () => JSON.stringify(tree.toJSON());
afterEach(async () => { if (tree) await act(async () => tree.unmount()); jest.clearAllMocks(); });
it('owner sees detected values read-only with no manual form', async () => {
  await act(async () => { tree = TestRenderer.create(createElement(UpiRoutingStatus, { current: detected })); });
  expect(text()).toContain('shop@bank'); expect(text()).toContain('Tap to Pay enabled');
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0); expect(tree.root.findAllByType(Button)).toHaveLength(0);
});
it('replacement failure removes the old displayed account and gives QR-only guidance', async () => {
  await act(async () => { tree = TestRenderer.create(createElement(UpiRoutingStatus, { current: detected })); });
  await act(async () => tree.update(createElement(UpiRoutingStatus, { current: { ...detected, upiVpa: null, upiPayeeName: null, upiQrDecoded: false } })));
  expect(text()).not.toContain('shop@bank'); expect(text()).toContain('customers can still scan');
});
it('no QR asks only for upload, never manual VPA or invented details', async () => {
  await act(async () => { tree = TestRenderer.create(createElement(UpiRoutingStatus, { current: null })); });
  expect(text()).toContain('Upload your shop UPI QR'); expect(text()).not.toContain('Save UPI details');
});
it('manual/legacy routing is not presented as detected', async () => {
  await act(async () => { tree = TestRenderer.create(createElement(UpiRoutingStatus, { current: { ...detected, upiQrDecoded: false } })); });
  expect(text()).not.toContain('shop@bank'); expect(text()).toContain('Tap to Pay is unavailable');
});
it('Payment QR still uses the proven picker -> prepared file -> native upload path and refreshes detected results', async () => {
  const asset = { uri: 'content://test/image', mimeType: 'image/png' };
  const prepared = { uri: 'file:///cache/qr.png', mimeType: 'image/png', name: 'qr.png' };
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [asset] });
  (uploadImageAsset as jest.Mock).mockImplementation(async (_asset, _name, send) => send(prepared));
  (apiUploadImage as jest.Mock).mockResolvedValue(detected);
  const onChanged = jest.fn();
  await act(async () => { tree = TestRenderer.create(createElement(PaymentQrSection, { salonId: 's', paymentQr: null, onChanged })); });
  const button = tree.root.findAllByType(Button).find((node: { props: { title: string } }) => node.props.title === require('@barbercue/shared').uiStringsFor('EN').uploadPaymentQrAction);
  await act(async () => button.props.onPress());
  expect(uploadImageAsset).toHaveBeenCalledWith(asset, 'payment-qr.jpg', expect.any(Function));
  expect(apiUploadImage).toHaveBeenCalledWith('dashboard/salons/s/payment-qr/upload', prepared);
  expect(onChanged).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(createElement(PaymentQrSection, { salonId: 's', paymentQr: detected, onChanged })));
  expect(text()).toContain('shop@bank'); expect(text()).not.toContain('Save UPI details');
});
