/// <reference types="jest" />
import { act, createElement } from 'react';
import { Text, TextInput } from 'react-native';
import TestRenderer from 'react-test-renderer';
import type { BillingProfileDto } from '@barbercue/shared';
import OwnerBillingProfileScreen from '../OwnerBillingProfileScreen';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN' }) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, []) }));
jest.mock('../../../components/ui', () => {
  const { createElement: el } = require('react');
  const { Text: NativeText, View: NativeView, Pressable: NativePressable } = require('react-native');
  return {
    Button: ({ title, onPress, disabled }: any) => el(NativePressable, { onPress, disabled }, el(NativeText, null, title)),
    Card: ({ children }: any) => el(NativeView, null, children),
    InlineError: ({ message }: any) => el(NativeText, null, message),
    Screen: ({ children }: any) => el(NativeView, null, children),
    SectionHeader: ({ title }: any) => el(NativeView, null, el(NativeText, null, title)),
    Skeleton: () => null,
  };
});

let tree: ReturnType<typeof TestRenderer.create>;
const profile: BillingProfileDto = {
  salonId: 'salon-1', legalName: 'Synthetic Barber LLC', billingAddress: 'Synthetic address', contactPhone: null,
  contactEmail: null, gstin: null, taxEnabled: false, taxLabel: 'GST', taxRatePercent: null,
  taxMode: 'EXCLUSIVE', invoicePrefix: 'INV', complete: true,
};

function textOf(instance: any): string {
  return instance.children.map((child: any) => typeof child === 'string' ? child : textOf(child)).join('');
}

beforeEach(() => jest.clearAllMocks());
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });

it('loads and saves the selected salon billing profile through the owner-only contract', async () => {
  (apiFetch as jest.Mock).mockResolvedValueOnce(profile).mockResolvedValueOnce({ ...profile, legalName: 'Updated Synthetic LLC' });
  await act(async () => {
    tree = TestRenderer.create(createElement(OwnerBillingProfileScreen, { route: { params: { salonId: 'salon-1' } } } as never));
  });
  expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/salon-1/billing-profile');
  const name = tree.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === 'Legal business name');
  expect(name).toBeDefined();
  await act(async () => name!.props.onChangeText('Updated Synthetic LLC'));
  const save = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Save billing profile')[0];
  await act(async () => save.props.onPress());
  expect(apiFetch).toHaveBeenLastCalledWith('dashboard/salons/salon-1/billing-profile', expect.objectContaining({
    method: 'PUT',
    body: JSON.stringify({
      legalName: 'Updated Synthetic LLC', billingAddress: 'Synthetic address', contactEmail: '',
      taxEnabled: false, taxLabel: 'GST', taxMode: 'EXCLUSIVE', invoicePrefix: 'INV',
    }),
  }));
  expect(tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ')).toContain('Billing profile saved.');
});

it('requires a tax rate before saving an enabled tax profile', async () => {
  (apiFetch as jest.Mock).mockResolvedValueOnce(profile);
  await act(async () => {
    tree = TestRenderer.create(createElement(OwnerBillingProfileScreen, { route: { params: { salonId: 'salon-1' } } } as never));
  });
  const taxToggle = tree.root.findAll((node: any) => node.props.accessibilityRole === 'switch' && node.props.accessibilityLabel === 'Apply tax to invoices')[0];
  await act(async () => taxToggle.props.onPress());
  const save = tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node) === 'Save billing profile')[0];
  await act(async () => save.props.onPress());
  expect(apiFetch).toHaveBeenCalledTimes(1);
  expect(tree.root.findAll((node: any) => node.type === Text).map(textOf).join(' ')).toContain('Enter the tax rate, or turn tax off.');
});
