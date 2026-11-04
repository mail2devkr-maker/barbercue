/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
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

it.each([
  ['standard', Screen],
  ['premium', PremiumScreen],
])('%s fixed form avoids the keyboard on iOS without changing Android layout', (_name, ScreenComponent) => {
  let tree: ReturnType<typeof TestRenderer.create>;
  act(() => {
    tree = TestRenderer.create(createElement(ScreenComponent, { scroll: false, children: createElement(Text, null, 'fixed form') }));
  });
  const avoidingViews = tree.root.findAllByType(KeyboardAvoidingView);
  expect(avoidingViews).toHaveLength(Platform.OS === 'ios' ? 1 : 0);
  if (Platform.OS === 'ios') expect(avoidingViews[0].props.behavior).toBe('padding');
  act(() => tree.unmount());
});
