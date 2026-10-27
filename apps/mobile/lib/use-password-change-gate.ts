import { useEffect, useState } from 'react';
import { subscribePasswordChangeRequired } from './password-change-gate';

/**
 * True once the backend has told this session that its account holds an administrator-issued temporary password.
 * Cleared the moment the session ends (sign-out, expiry or a failed refresh), so signing in again with the new password
 * opens the app normally instead of showing a stale notice.
 */
export function usePasswordChangeGate(status: 'loading' | 'authenticated' | 'unauthenticated'): boolean {
  const [mustChange, setMustChange] = useState(false);

  useEffect(() => subscribePasswordChangeRequired(() => setMustChange(true)), []);
  useEffect(() => {
    if (status !== 'authenticated') setMustChange(false);
  }, [status]);

  return mustChange;
}
