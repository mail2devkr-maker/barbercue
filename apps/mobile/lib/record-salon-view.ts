import { useEffect, useRef } from 'react';
import { RECENTLY_VIEWED_PATHS, Role } from '@barbercue/shared';
import { apiFetch } from './api';
import { useAuth } from './auth-context';

/**
 * Website parity: opening a salon records it in the signed-in customer's "Recently viewed"
 * (apps/web recordSalonView). Only a signed-in CUSTOMER can write it (the endpoint is customer-only),
 * and a failed call is ignored: history is a convenience and must never disturb the salon page.
 */
export function shouldRecordSalonView(status: string, roles: readonly string[] | null | undefined): boolean {
  return status === 'authenticated' && Array.isArray(roles) && roles.includes(Role.CUSTOMER);
}

export function recordSalonViewPath(salonId: string): string {
  return `${RECENTLY_VIEWED_PATHS.recentlyViewed}/${salonId}`;
}

/** Records the salon once per screen visit, after its profile has loaded. */
export function useRecordSalonView(salonId: string | undefined): void {
  const { status, user } = useAuth();
  const recorded = useRef<string | null>(null);
  const allowed = shouldRecordSalonView(status, user?.roles);
  useEffect(() => {
    if (!salonId || !allowed || recorded.current === salonId) return;
    recorded.current = salonId;
    void apiFetch(recordSalonViewPath(salonId), { method: 'POST' }).catch(() => undefined);
  }, [salonId, allowed]);
}
