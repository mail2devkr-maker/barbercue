/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { KeyboardAvoidingView, Platform, Text } from 'react-native';
import { FilterSheet } from '../FilterSheet';

it('keeps iOS filter-sheet content above the keyboard while leaving Android sheet layout unchanged', () => {
  let tree: ReturnType<typeof TestRenderer.create>;
  act(() => {
    tree = TestRenderer.create(
      createElement(
        FilterSheet,
        { visible: true, title: 'Price', onClose: jest.fn(), closeLabel: 'Close', children: createElement(Text, null, 'filter form') },
      ),
    );
  });
  const avoidingViews = tree.root.findAllByType(KeyboardAvoidingView);
  expect(avoidingViews).toHaveLength(Platform.OS === 'ios' ? 1 : 0);
  if (Platform.OS === 'ios') expect(avoidingViews[0].props.behavior).toBe('padding');
  act(() => tree.unmount());
});
