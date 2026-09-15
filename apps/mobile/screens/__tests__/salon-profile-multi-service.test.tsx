/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import SalonProfileScreen from '../SalonProfileScreen';
import { apiFetch } from '../../lib/api';

// Multi-service booking core mission — CASE 13: adding/removing a service on mobile must never
// leave a stale selection behind. Unlike apps/web's single-page BookingFlow (which must actively
// clear an already-chosen slot when the service selection changes), apps/mobile's booking wizard
// is a screen-per-step navigation stack: services are only ever chosen on this screen, strictly
// before StaffSelect/DateSelect/SlotSelect exist at all — so there is no in-memory "stale slot" to
// clear here. The equivalent correctness requirement this test proves instead: whatever combined
// selection is ACTUALLY forwarded to StaffSelect (the screen that re-fetches staff and, downstream,
// availability — see StaffSelectScreen/SlotSelectScreen) always reflects the CURRENT toggled state
// at the moment "Continue" is pressed, never an earlier, now-stale one.
jest.mock('../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../lib/language-context', () => ({
  useLanguage: () => ({ language: 'EN', t: require('@barbercue/shared').uiStringsFor('EN') }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, []),
}));
jest.mock('../../components/PublicSalonStatus', () => ({ PublicSalonStatus: () => null }));
jest.mock('../../components/ui', () => {
  const { createElement } = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    Skeleton: () => null,
    ErrorState: () => null,
    SafeImage: () => null,
    PhotoGalleryViewer: () => null,
    PremiumScreen: ({ children }: any) => createElement(View, null, children),
    PremiumButton: ({ title, onPress, disabled }: any) =>
      createElement(Pressable, { onPress, disabled, accessibilityState: { disabled } }, createElement(Text, null, title)),
  };
});

const salon = {
  id: 'salon1',
  name: 'Test Shop',
  addressLine: '123 Main St',
  coverPhotoUrl: null,
  photos: [],
  verified: false,
  ratingCount: 0,
  ratingAverage: null,
  description: null,
  services: [
    { id: 'haircut', name: 'Haircut', durationMinutes: 30, price: 300 },
    { id: 'beard', name: 'Beard Trim', durationMinutes: 20, price: 150 },
  ],
  team: [],
  operatingHours: [],
  reviews: [],
  currency: 'INR',
  countryCode: 'IN',
  salonTimezone: 'Asia/Kolkata',
};

let tree: ReturnType<typeof TestRenderer.create>;
const navigate = jest.fn();
const props = {
  route: { params: { countryCode: 'IN', citySlug: 'city', salonSlug: 'shop' } },
  navigation: { navigate },
};

function textOf(instance: any): string {
  return instance.children
    .map((child: any) => (typeof child === 'string' ? child : textOf(child)))
    .join('');
}
// Matching by identity on RN's `Pressable` export is unreliable across separately transformed
// modules under jest-expo — matching on the `onPress` prop itself (present only on the pressable
// composite, never propagated onto its rendered host node) is robust regardless of exactly which
// module instance authored it.
function findButtonByText(text: string) {
  return tree.root.findAll((node: any) => typeof node.props.onPress === 'function' && textOf(node).includes(text))[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  (apiFetch as jest.Mock).mockImplementation(async (path: string) => {
    if (path.includes('/status')) return null;
    return salon;
  });
});

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

it('CASE 13: selecting a service then adding a second forwards the FULL combined selection to StaffSelect', async () => {
  await act(async () => {
    tree = TestRenderer.create(createElement(SalonProfileScreen, props as never));
  });

  await act(async () => findButtonByText('Haircut')!.props.onPress());
  await act(async () => findButtonByText('Beard Trim')!.props.onPress());
  await act(async () => findButtonByText('Continue')!.props.onPress());

  expect(navigate).toHaveBeenCalledWith(
    'StaffSelect',
    expect.objectContaining({
      salonId: 'salon1',
      services: [
        { id: 'haircut', name: 'Haircut', price: 300, durationMinutes: 30 },
        { id: 'beard', name: 'Beard Trim', price: 150, durationMinutes: 20 },
      ],
    }),
  );
});

it('CASE 13b: deselecting a previously-added service removes it from what gets forwarded, never leaving it stale', async () => {
  await act(async () => {
    tree = TestRenderer.create(createElement(SalonProfileScreen, props as never));
  });

  await act(async () => findButtonByText('Haircut')!.props.onPress());
  await act(async () => findButtonByText('Beard Trim')!.props.onPress());
  // Deselect Beard Trim by tapping it again.
  await act(async () => findButtonByText('Beard Trim')!.props.onPress());

  await act(async () => findButtonByText('Continue')!.props.onPress());

  const lastCall = navigate.mock.calls.at(-1);
  expect(lastCall[0]).toBe('StaffSelect');
  expect(lastCall[1].services).toEqual([{ id: 'haircut', name: 'Haircut', price: 300, durationMinutes: 30 }]);
});

it('CASE 13c: Continue is disabled with no services selected and becomes enabled once one is chosen', async () => {
  await act(async () => {
    tree = TestRenderer.create(createElement(SalonProfileScreen, props as never));
  });

  expect(findButtonByText('Continue')!.props.disabled).toBe(true);
  await act(async () => findButtonByText('Haircut')!.props.onPress());
  expect(findButtonByText('Continue')!.props.disabled).toBe(false);
  // Deselecting the only selected service must disable Continue again, not leave it stale-enabled.
  await act(async () => findButtonByText('Haircut')!.props.onPress());
  expect(findButtonByText('Continue')!.props.disabled).toBe(true);
});
