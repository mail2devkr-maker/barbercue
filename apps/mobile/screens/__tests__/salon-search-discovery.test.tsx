/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { Role } from '@barbercue/shared';
import SalonSearchScreen from '../SalonSearchScreen';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

// Discovery upgrade on mobile: the new filters reach the search API, the compared service's own
// price shows on each card, and the heart saves a favorite (rolling back if the server refuses).
jest.mock('../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../lib/auth-context', () => ({ useAuth: jest.fn() }));
jest.mock('../../lib/language-context', () => ({
  useLanguage: () => ({ language: 'EN', t: require('@barbercue/shared').uiStringsFor('EN') }),
}));
jest.mock('expo-location', () => ({}));
jest.mock('../../components/ui', () => {
  const { createElement } = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');
  return {
    EmptyState: ({ title }: any) => createElement(Text, null, title),
    Skeleton: () => null,
    InlineError: ({ message }: any) => createElement(Text, null, message),
    SafeImage: () => null,
    PremiumScreen: ({ children }: any) => createElement(View, null, children),
    PremiumSectionHeader: () => null,
    PremiumTextField: (props: any) => createElement(TextInput, props),
    PremiumButton: ({ title, onPress }: any) => createElement(Pressable, { onPress }, createElement(Text, null, title)),
    FilterSheet: () => null,
    // Every option rendered inline, labelled "<dropdown>: <option>", so a test can pick one.
    FilterDropdown: ({ label, options, onSelect }: any) =>
      createElement(
        View,
        null,
        options.map((option: any) =>
          createElement(
            Pressable,
            { key: option.id, onPress: () => onSelect(option.id) },
            createElement(Text, null, `${label}: ${option.label}`),
          ),
        ),
      ),
  };
});

const mockedApi = apiFetch as jest.Mock;
const mockedAuth = useAuth as jest.Mock;

const salon = {
  id: 's1',
  name: 'Sharp Gents',
  slug: 'sharp',
  citySlug: 'pune',
  countryCode: 'IN',
  currency: 'INR',
  addressLine: 'MG Road',
  coverPhotoUrl: null,
  verified: false,
  ratingAverage: 4.5,
  ratingCount: 3,
  priceMin: 90,
  priceMax: 180,
  distanceKm: null,
  isOpenNow: true,
  isClosedForToday: false,
  salonType: 'GENTS',
  salonTypeConfirmed: true,
  selectedService: { id: 'h', name: 'Classic Haircut', price: 180, durationMinutes: 30 },
};

function textOf(instance: any): string {
  return (instance.children ?? []).map((child: any) => (typeof child === 'string' ? child : textOf(child))).join('');
}

let tree: ReturnType<typeof TestRenderer.create>;
const press = (text: string) => {
  const node = tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && textOf(n) === text)[0];
  if (!node) throw new Error(`No button "${text}"`);
  return act(async () => {
    await node.props.onPress();
  });
};
const searchCalls = () => mockedApi.mock.calls.map((call) => call[0]).filter((path: string) => path.startsWith('salons?'));

async function render() {
  await act(async () => {
    tree = TestRenderer.create(
      createElement(SalonSearchScreen as any, { navigation: { navigate: jest.fn() }, route: { params: {} } }),
    );
  });
}

beforeEach(() => {
  mockedApi.mockReset();
  mockedAuth.mockReturnValue({ user: { id: 'u1', roles: [Role.CUSTOMER] }, status: 'authenticated' });
});

it('sends the new filters and shows the compared service price and salon type', async () => {
  mockedApi.mockImplementation((path: string) =>
    Promise.resolve(path === 'favorites/ids' ? { salonIds: [] } : { items: [salon], nextCursor: null }),
  );
  await render();
  await press('Salon type: Male');
  await press('Compare price: Haircut');
  await press('Sort by: Price');
  await press('Rating: 4★+');
  await press('Open now');
  expect(searchCalls().at(-1)).toBe('salons?salonType=GENTS&popularService=haircut&sort=price&minRating=4&openNow=true');
  const text = textOf(tree.root);
  expect(text).toContain('Classic Haircut · ₹180');
  expect(text).toContain('Male');
});

it('saves a favorite from the heart, rolls back when refused, and searches favorites only', async () => {
  let refuse = false;
  mockedApi.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === 'favorites/ids') return Promise.resolve({ salonIds: [] });
    if (path.startsWith('favorites/')) return refuse ? Promise.reject(new Error('down')) : Promise.resolve({});
    return Promise.resolve({ items: [salon], nextCursor: null });
  });
  await render();
  await press('Salon type: All salons');
  const heart = () => tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && /favorites: Sharp Gents$/.test(n.props.accessibilityLabel ?? ''))[0];
  await act(async () => heart().props.onPress());
  expect(mockedApi).toHaveBeenCalledWith('favorites/s1', { method: 'POST' });
  expect(heart().props.accessibilityState).toEqual({ selected: true });

  await press('♥ Favorites');
  expect(searchCalls().at(-1)).toBe(`salons?ids=s1`);

  refuse = true;
  await act(async () => heart().props.onPress());
  expect(heart().props.accessibilityState).toEqual({ selected: true }); // rolled back
  expect(textOf(tree.root)).toContain('Couldn’t update favorites');
});

it('asks a signed-out visitor to sign in instead of searching favorites', async () => {
  mockedAuth.mockReturnValue({ user: null, status: 'unauthenticated' });
  mockedApi.mockResolvedValue({ items: [], nextCursor: null });
  await render();
  await press('♥ Favorites');
  expect(searchCalls()).toHaveLength(0);
  expect(textOf(tree.root)).toContain('Sign in as a customer to save and see favorite salons.');
});
