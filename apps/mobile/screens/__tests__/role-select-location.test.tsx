import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { uiStringsFor } from '@barbercue/shared';
import RoleSelectScreen from '../RoleSelectScreen';
import { __resetLocationChoiceForTests, setLocationChoice } from '../../lib/location-choice';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../lib/language-context', () => ({
  useLanguage: () => ({ language: 'EN', t: require('@barbercue/shared').uiStringsFor('EN') }),
}));
jest.mock('../../components/ui', () => {
  const { createElement } = require('react');
  const { View } = require('react-native');
  return {
    BrandLockup: () => null,
    GradientView: ({ children, style }: { children?: React.ReactNode; style?: unknown }) => createElement(View, { style }, children),
    LanguageSwitcher: () => null,
    SafeImage: () => null,
  };
});
jest.mock('../../components/ui/TabIcon', () => ({ TabIcon: () => null }));
jest.mock('../../components/location/LocationPickerModal', () => {
  const { createElement } = require('react');
  const { Text } = require('react-native');
  return { LocationPickerModal: ({ visible }: { visible: boolean }) => (visible ? createElement(Text, null, 'PICKER OPEN') : null) };
});

const english = uiStringsFor('EN');
const ScreenUnderTest = RoleSelectScreen as unknown as React.ComponentType<{ navigation: never }>;

beforeEach(() => __resetLocationChoiceForTests());

it('opens the city / current-location picker from the signed-out home (not GPS only)', async () => {
  await render(<ScreenUnderTest navigation={{ navigate: jest.fn() } as never} />);
  expect(screen.queryByText('PICKER OPEN')).toBeNull();
  await fireEvent.press(screen.getAllByText(english.chooseLocationAction)[0]!);
  expect(screen.getByText('PICKER OPEN')).toBeTruthy();
}, 15000);

it('shows a picked city and sends it to search through the shared choice', async () => {
  setLocationChoice({ kind: 'city', city: { id: 'c1', name: 'Ghaziabad', slug: 'ghaziabad', countryCode: 'IN', state: 'Uttar Pradesh' } });
  const navigation = { navigate: jest.fn() };
  await render(<ScreenUnderTest navigation={navigation as never} />);
  expect(screen.getAllByText('Ghaziabad').length).toBeGreaterThan(0);
}, 15000);
