import { createElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { AppearanceCard } from '../AppearanceCard';
import { ThemeProvider } from '../../lib/theme-mode';
import { Card } from '../ui';

const mockStore: Record<string, string> = {};
jest.mock('../../lib/secure-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    mockStore[k] = v;
  }),
}));
jest.mock('../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN', t: {} }) }));

type Inst = any;
const textOf = (n: Inst): string => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(''));

async function render(): Promise<{ root: Inst }> {
  let r!: { root: Inst };
  await act(async () => {
    r = TestRenderer.create(
      createElement(ThemeProvider, null, createElement(AppearanceCard), createElement(Card, null)),
    );
  });
  return r;
}

const cardBackground = (root: Inst) => {
  const cards = root.findAll((n: Inst) => n.type === 'View' && StyleSheet.flatten(n.props.style)?.borderRadius === 20);
  return StyleSheet.flatten(cards[cards.length - 1].props.style).backgroundColor;
};

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
});

it('offers As designed / Light / Dark / Same as phone, with As designed selected by default', async () => {
  const r = await render();
  const radios = r.root.findAll((n: Inst) => n.props.accessibilityRole === 'radio' && typeof n.props.onPress === 'function');
  expect(radios.map((n: Inst) => n.props.accessibilityLabel)).toEqual(['As designed', 'Light', 'Dark', 'Same as phone']);
  expect(radios[0].props.accessibilityState).toEqual({ checked: true });
  expect(cardBackground(r.root)).toBe('#ffffff');
});

it('switching to Dark saves the choice on the phone and re-colours the app', async () => {
  const r = await render();
  const dark = r.root.findAll((n: Inst) => n.props.accessibilityLabel === 'Dark' && typeof n.props.onPress === 'function')[0];
  await act(async () => dark.props.onPress());
  expect(mockStore.theme_choice_v1).toBe('dark');
  expect(cardBackground(r.root)).toBe('#171314');
});

it('restores the saved choice when the app starts again', async () => {
  mockStore.theme_choice_v1 = 'dark';
  const r = await render();
  const dark = r.root.findAll((n: Inst) => n.props.accessibilityLabel === 'Dark' && typeof n.props.onPress === 'function')[0];
  expect(dark.props.accessibilityState).toEqual({ checked: true });
  expect(textOf(r.root)).toContain('Appearance');
});
