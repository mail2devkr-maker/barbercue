import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AssistantFab } from '../AssistantFab';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn() }));
let mockRoute: string | undefined = 'OwnerDashboard';
const mockListeners: Array<() => void> = [];
jest.mock('../../../navigation/navigation-ref', () => ({
  navigationRef: {
    isReady: () => true,
    getCurrentRoute: () => (mockRoute ? { name: mockRoute } : undefined),
    addListener: (_: string, fn: () => void) => { mockListeners.push(fn); return () => undefined; },
  },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 }) }));
jest.mock('../../ui/GradientView', () => {
  const { View } = require('react-native');
  return { GradientView: View };
});
const fetchMock = apiFetch as jest.Mock;

beforeEach(() => { fetchMock.mockReset(); mockRoute = 'OwnerDashboard'; mockListeners.length = 0; });

it('shows a floating launcher on main screens when the server enables the assistant', async () => {
  fetchMock.mockResolvedValue({ enabled: true });
  const onOpen = jest.fn();
  await render(<AssistantFab onOpen={onOpen} />);
  await fireEvent.press(await screen.findByLabelText('Open FastQue Assistant'));
  expect(fetchMock).toHaveBeenCalledWith('assistant/access');
  expect(onOpen).toHaveBeenCalled();
});

it('stays hidden when the rollout is off for this user (fail closed)', async () => {
  fetchMock.mockResolvedValue({ enabled: false });
  await render(<AssistantFab onOpen={jest.fn()} />);
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByTestId('assistant-fab')).toBeNull();
});

it('stays hidden when the access check fails', async () => {
  fetchMock.mockRejectedValue(new Error('offline'));
  await render(<AssistantFab onOpen={jest.fn()} />);
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByTestId('assistant-fab')).toBeNull();
});

it('hides itself on the Assistant screen', async () => {
  fetchMock.mockResolvedValue({ enabled: true });
  mockRoute = 'Assistant';
  await render(<AssistantFab onOpen={jest.fn()} />);
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByTestId('assistant-fab')).toBeNull();
});
