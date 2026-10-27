/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { notifyPasswordChangeRequired } from '../password-change-gate';
import { usePasswordChangeGate } from '../use-password-change-gate';

type Status = 'loading' | 'authenticated' | 'unauthenticated';

function mount(initial: Status) {
  const seen: boolean[] = [];
  function Probe({ status }: { status: Status }) {
    seen.push(usePasswordChangeGate(status));
    return null;
  }
  let r!: any;
  act(() => { r = TestRenderer.create(createElement(Probe, { status: initial })); });
  return { r, set: (status: Status) => act(() => { r.update(createElement(Probe, { status })); }), last: () => seen[seen.length - 1] };
}

describe('usePasswordChangeGate (session handling for the Android handoff)', () => {
  beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

  it('starts off, turns on when the backend demands a password change, and stays on while signed in', () => {
    const m = mount('authenticated');
    expect(m.last()).toBe(false);
    act(() => notifyPasswordChangeRequired());
    expect(m.last()).toBe(true);
    m.set('authenticated');
    expect(m.last()).toBe(true);
  });

  it('is cleared when the session ends, so signing in again with the new password opens the app', () => {
    const m = mount('authenticated');
    act(() => notifyPasswordChangeRequired());
    expect(m.last()).toBe(true);
    m.set('unauthenticated');
    expect(m.last()).toBe(false);
    m.set('authenticated');
    expect(m.last()).toBe(false);
  });

  it('stops listening after unmount', () => {
    const m = mount('authenticated');
    act(() => m.r.unmount());
    expect(() => act(() => notifyPasswordChangeRequired())).not.toThrow();
  });
});
