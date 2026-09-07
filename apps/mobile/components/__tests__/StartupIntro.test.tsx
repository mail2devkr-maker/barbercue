/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { INTRO_SAFETY_TIMEOUT_MS } from '../../lib/startup-intro';

// A minimal fake VideoPlayer: captures listeners so the test can fire them directly, exactly the
// events the real expo-video player emits (see StartupIntro.tsx's own listener wiring). VideoView
// renders nothing real — this suite is about the startup-gate contract (completion/error/timeout
// -> onFinish), not native video rendering, which only a physical device can prove.
type Listener = (payload?: unknown) => void;

jest.mock('expo-video', () => {
  const listeners = new Map<string, Set<Listener>>();
  const player = {
    loop: true,
    muted: false,
    play: jest.fn(),
    addListener: (event: string, cb: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return { remove: () => listeners.get(event)?.delete(cb) };
    },
  };
  return {
    useVideoPlayer: (_source: unknown, setup?: (p: typeof player) => void) => {
      setup?.(player);
      return player;
    },
    VideoView: () => null,
    __emit: (event: string, payload?: unknown) => {
      listeners.get(event)?.forEach((cb) => cb(payload));
    },
    __player: player,
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __emit, __player } = require('expo-video') as { __emit: (e: string, p?: unknown) => void; __player: { loop: boolean; muted: boolean; play: jest.Mock } };

import { StartupIntro, StartupIntroErrorBoundary } from '../StartupIntro';

// Every test unmounts its renderer (below) so StartupIntro's own effect cleanup runs — that's
// what actually clears the real (or faked) safety-timeout timer between tests, matching the same
// clearTimeout the component relies on in production to stop that timer once the intro finishes.
// react-test-renderer has no usable published types for React 19 in this repo (see
// types/react-test-renderer.d.ts) — untyped `any` here is that same pre-existing, test-only gap.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let renderer: any = null;

afterEach(() => {
  renderer?.unmount();
  renderer = null;
});

describe('StartupIntro', () => {
  it('never loops and starts muted+playing on mount, matching "play once, no audio requirement"', () => {
    TestRenderer.act(() => {
      renderer = TestRenderer.create(createElement(StartupIntro, { onFinish: jest.fn() }));
    });

    expect(__player.loop).toBe(false);
    expect(__player.muted).toBe(true);
    expect(__player.play).toHaveBeenCalled();
  });

  it('calls onFinish exactly once when the video plays to the end', () => {
    const onFinish = jest.fn();
    TestRenderer.act(() => {
      renderer = TestRenderer.create(createElement(StartupIntro, { onFinish }));
    });

    act(() => {
      __emit('playToEnd');
      __emit('playToEnd'); // a duplicate/late event must never double-release the app
    });

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('calls onFinish when the player reports a playback error', () => {
    const onFinish = jest.fn();
    TestRenderer.act(() => {
      renderer = TestRenderer.create(createElement(StartupIntro, { onFinish }));
    });

    act(() => {
      __emit('statusChange', { status: 'error', error: { message: 'boom' } });
    });

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('does not call onFinish for a non-error status change', () => {
    const onFinish = jest.fn();
    TestRenderer.act(() => {
      renderer = TestRenderer.create(createElement(StartupIntro, { onFinish }));
    });

    act(() => {
      __emit('statusChange', { status: 'readyToPlay' });
    });

    expect(onFinish).not.toHaveBeenCalled();
  });

  it('calls onFinish via the safety timeout if neither completion nor an error ever fires', () => {
    jest.useFakeTimers();
    const onFinish = jest.fn();
    try {
      TestRenderer.act(() => {
        renderer = TestRenderer.create(createElement(StartupIntro, { onFinish }));
      });

      act(() => {
        jest.advanceTimersByTime(INTRO_SAFETY_TIMEOUT_MS - 1);
      });
      expect(onFinish).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(onFinish).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('never calls onFinish twice even if completion fires just before the safety timeout', () => {
    jest.useFakeTimers();
    const onFinish = jest.fn();
    try {
      TestRenderer.act(() => {
        renderer = TestRenderer.create(createElement(StartupIntro, { onFinish }));
      });

      act(() => {
        __emit('playToEnd');
        jest.advanceTimersByTime(INTRO_SAFETY_TIMEOUT_MS + 1000);
      });

      expect(onFinish).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('StartupIntroErrorBoundary', () => {
  function Explode(): never {
    throw new Error('player initialization failed');
  }

  it('releases the app (calls onError) instead of crashing when the intro subtree throws', () => {
    const onError = jest.fn();
    // React logs the caught error to console.error during a test run — expected noise, not a
    // real failure, since the whole point of this test is that the boundary catches it.
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          createElement(StartupIntroErrorBoundary, { onError, children: createElement(Explode) }),
        );
      });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(onError).toHaveBeenCalledTimes(1);
  });
});
