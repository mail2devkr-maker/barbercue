import { useEffect, useState } from 'react';

/**
 * Phase 15 (Low-Network / Resilience Mode). React Native has no `navigator.onLine` — rather than
 * pull in a new native module (`@react-native-community/netinfo`) just to read an OS-level flag
 * that can itself be true while the backend is unreachable, this tracks the signal that actually
 * matters: whether apiFetch's own requests are succeeding. lib/api.ts reports into this store on
 * every request; nothing here calls fetch or opens a connection itself, so importing this module
 * has no side effects for screens that don't otherwise make network calls.
 */
type Listener = (online: boolean) => void;

let online = true;
const listeners = new Set<Listener>();

function setOnline(next: boolean): void {
  if (online === next) return;
  online = next;
  listeners.forEach((listener) => listener(online));
}

/** Called by lib/api.ts's fetchOrOffline on a network-level failure. */
export function reportNetworkFailure(): void {
  setOnline(false);
}

/** Called by lib/api.ts's fetchOrOffline whenever a request actually reaches the server. */
export function reportNetworkSuccess(): void {
  setOnline(true);
}

export function useOnlineStatus(): boolean {
  const [state, setState] = useState(online);
  useEffect(() => {
    const listener: Listener = (next) => setState(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}
