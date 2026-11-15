import { AppState } from 'react-native';
import { setForegroundInterval } from '../foreground-interval';

describe('setForegroundInterval', () => {
  let listener: ((s: string) => void) | null = null;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (s: string) => void) => {
      listener = fn;
      return { remove: () => { listener = null; } };
    }) as never);
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('polls in the foreground, pauses in the background, refreshes at once on return', () => {
    const fn = jest.fn();
    const stop = setForegroundInterval(fn, 1000);
    jest.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(2);
    listener?.('background');
    jest.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(2);
    listener?.('active');
    expect(fn).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(4);
    stop();
    expect(listener).toBeNull();
    jest.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('does not tick when started in the background', () => {
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
    const fn = jest.fn();
    const stop = setForegroundInterval(fn, 1000);
    jest.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
    stop();
  });
});
