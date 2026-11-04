/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { Platform, ScrollView, Text } from 'react-native';
import { Screen } from '../Screen';
import { PremiumScreen } from '../Premium';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

it.each([
  ['standard', Screen],
  ['premium', PremiumScreen],
])('%s scrollable form adjusts for keyboard insets only on iOS', (_name, ScreenComponent) => {
  let tree: ReturnType<typeof TestRenderer.create>;
  act(() => {
    tree = TestRenderer.create(createElement(ScreenComponent, null, createElement(Text, null, 'form')));
  });
  const scroll = tree.root.findByType(ScrollView);
  expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(Platform.OS === 'ios');
  act(() => tree.unmount());
});
