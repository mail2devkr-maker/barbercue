import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { apiFetch } from '../../../lib/api';
import { AssistantEntry } from '../AssistantEntry';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]),
}));
jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn() }));

const apiFetchMock = apiFetch as jest.Mock;
let tree: ReturnType<typeof TestRenderer.create> | null = null;

async function mount(onPress: jest.Mock) {
  await act(async () => {
    tree = TestRenderer.create(createElement(AssistantEntry, { onPress }));
    await Promise.resolve();
  });
}

function entry() {
  return tree?.root.findAllByProps({ accessibilityLabel: 'Open FastQue Assistant' }) ?? [];
}

describe('AssistantEntry', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    tree = null;
  });

  afterEach(async () => {
    if (tree) await act(async () => tree?.unmount());
    tree = null;
  });

  it('does not render when the authenticated service says the feature is disabled', async () => {
    apiFetchMock.mockResolvedValue({ enabled: false, writes: false });
    await mount(jest.fn());

    expect(apiFetchMock).toHaveBeenCalled();
    expect(entry()).toHaveLength(0);
  });

  it('renders the entry only after the authenticated service enables it', async () => {
    const onPress = jest.fn();
    apiFetchMock.mockResolvedValue({ enabled: true, writes: false });
    await mount(onPress);

    const [button] = entry();
    expect(button).toBeTruthy();
    await act(async () => button.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the access check errors', async () => {
    apiFetchMock.mockRejectedValue(new Error('offline'));
    await mount(jest.fn());

    expect(apiFetchMock).toHaveBeenCalled();
    expect(entry()).toHaveLength(0);
  });
});
