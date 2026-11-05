import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { uiStringsFor } from '@barbercue/shared';
import RoleSelectScreen from '../RoleSelectScreen';

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

const english = uiStringsFor('EN');

describe('RoleSelectScreen employee entry', () => {
  it('offers Employee Login in the signed-out menu and opens its dedicated route', async () => {
    const navigation = { navigate: jest.fn() };
    const ScreenUnderTest = RoleSelectScreen as unknown as React.ComponentType<{ navigation: never }>;
    await render(<ScreenUnderTest navigation={navigation as never} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByText(english.roleEmployee)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: english.roleEmployee }));
    expect(navigation.navigate).toHaveBeenCalledWith('EmployeeLogin');
  }, 15000);
});
