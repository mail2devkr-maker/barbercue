import { createElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TabBackButton } from '../TabBackButton';

// Owner report (18 Nov): tab screens had no in-app back button.
let mockNavigation: Record<string, jest.Mock>;
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN', t: {} }) }));

type Inst = any;
function render(): { root: Inst } {
  let r!: { root: Inst };
  act(() => {
    r = TestRenderer.create(createElement(TabBackButton));
  });
  return r;
}

const pressable = (root: Inst) => root.findAll((n: Inst) => typeof n.props.onPress === 'function')[0];

it('goes back to the previous screen when there is one', () => {
  mockNavigation = { canGoBack: jest.fn(() => true), goBack: jest.fn(), getState: jest.fn(), getParent: jest.fn() };
  const r = render();
  expect(pressable(r.root).props.accessibilityLabel).toBe('Back');
  act(() => pressable(r.root).props.onPress());
  expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
});

it('opens the first tab (the Dashboard) when the app was opened straight on this tab', () => {
  const tabs = {
    getState: jest.fn(() => ({ type: 'tab', routeNames: ['HomeTab', 'SearchTab'] })),
    getParent: jest.fn(() => undefined),
    navigate: jest.fn(),
  };
  mockNavigation = {
    canGoBack: jest.fn(() => false),
    goBack: jest.fn(),
    getState: jest.fn(() => ({ type: 'stack', routeNames: ['QueueHome'] })),
    getParent: jest.fn(() => tabs),
  };
  const r = render();
  act(() => pressable(r.root).props.onPress());
  expect(mockNavigation.goBack).not.toHaveBeenCalled();
  expect(tabs.navigate).toHaveBeenCalledWith('HomeTab');
});
