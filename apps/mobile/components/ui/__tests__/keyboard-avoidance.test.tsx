/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput } from 'react-native';
import { Screen } from '../Screen';
import { PremiumScreen } from '../Premium';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16 }),
}));

const originalOS = Platform.OS;
beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
});
afterAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
});

type Rendered = ReturnType<typeof TestRenderer.create>;

async function render(component: typeof Screen | typeof PremiumScreen, scroll = true): Promise<Rendered> {
  let tree!: Rendered;
  await act(async () => {
    tree = TestRenderer.create(createElement(component, { scroll, children: createElement(TextInput, { testID: 'typing-field' }) }));
  });
  return tree;
}

describe('Android P0 soft-keyboard protection for shared form screens', () => {
  it.each([
    ['Screen', Screen],
    ['PremiumScreen', PremiumScreen],
  ] as const)('%s keeps input in an Android keyboard-aware scroll container', async (_label, component) => {
    const tree = await render(component);
    expect(tree.root.findAllByType(KeyboardAvoidingView)).toHaveLength(1);
    const scrolls = tree.root.findAllByType(ScrollView);
    expect(scrolls).toHaveLength(1);
    expect(scrolls[0].props.keyboardShouldPersistTaps).toBe('handled');
    expect(tree.root.findAllByType(TextInput)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  it('preserves explicit fixed-layout screens without introducing a nested scroll view', async () => {
    const tree = await render(Screen, false);
    expect(tree.root.findAllByType(KeyboardAvoidingView)).toHaveLength(1);
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
    await act(async () => tree.unmount());
  });
});
