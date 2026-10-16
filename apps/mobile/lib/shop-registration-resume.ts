import { deleteItem, getItem, setItem } from './secure-storage';

/**
 * A brand-new owner who has created their email/password account but not yet registered a shop must
 * not be stranded on the customer Home screen if the app is closed in between. The in-memory
 * "pending destination" (customer-navigation-intent) dies with the process, so this persists one
 * small flag instead:
 *
 *  - set right after the owner account is created (OwnerRegisterScreen),
 *  - cleared the moment the shop exists (RegisterShopScreen) or the user signs out,
 *  - ignored once older than RESUME_WINDOW_MS, so an abandoned attempt cannot keep redirecting a
 *    returning customer forever,
 *  - bound to the account that started it (opaque user id, when known): a different account signing
 *    in later is never sent into someone else's half-done registration, and
 *  - verified against the server on resume (resolveShopRegistrationResume): an account that already
 *    owns a shop (for example registered on the website) clears the marker instead of being
 *    redirected on every cold start.
 *
 * It stores no tokens, no personal data and nothing about the shop — only "this device was in the
 * middle of owner registration, since <time>, for account <opaque id>".
 */

export const SHOP_REGISTRATION_RESUME_KEY = 'fastque_pending_shop_registration_v1';
export const RESUME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function markShopRegistrationPending(now: number = Date.now(), userId?: string): Promise<void> {
  try {
    await setItem(
      SHOP_REGISTRATION_RESUME_KEY,
      JSON.stringify(userId ? { v: 1, since: now, userId } : { v: 1, since: now }),
    );
  } catch {
    // Resume is a convenience; failing to persist must never block account creation.
  }
}

export async function clearShopRegistrationPending(): Promise<void> {
  try {
    await deleteItem(SHOP_REGISTRATION_RESUME_KEY);
  } catch {
    // Nothing more to do: a stale flag simply expires.
  }
}

interface PendingMarker {
  since: number;
  userId: string | null;
}

async function readMarker(now: number): Promise<PendingMarker | null> {
  try {
    const raw = await getItem(SHOP_REGISTRATION_RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: unknown; since?: unknown; userId?: unknown };
    if (parsed.v !== 1 || typeof parsed.since !== 'number' || !Number.isFinite(parsed.since)) return null;
    const age = now - parsed.since;
    if (age < 0 || age > RESUME_WINDOW_MS) return null;
    return { since: parsed.since, userId: typeof parsed.userId === 'string' && parsed.userId ? parsed.userId : null };
  } catch {
    return null;
  }
}

/** True only for a well-formed, recent flag. Never throws; corrupt storage means "not pending". */
export async function isShopRegistrationPending(now: number = Date.now()): Promise<boolean> {
  return (await readMarker(now)) !== null;
}

/**
 * Decides, on a cold start with no in-memory intent, whether the signed-in account should be put
 * back on Register Shop. True only when ALL of these hold:
 *  - a recent marker exists,
 *  - it was written for this same account (or by a build that did not record one),
 *  - the server does not list a shop this account owns.
 * An account that already owns a shop has the marker cleared (it can never be stale again). If the
 * shop list cannot be read (offline, server error) the marker is kept and the resume proceeds, so an
 * unfinished onboarding is never lost to a network hiccup; it still expires after RESUME_WINDOW_MS.
 * Never throws.
 */
export async function resolveShopRegistrationResume(options: {
  userId: string;
  fetchWorkplaces: () => Promise<ReadonlyArray<{ isOwner: boolean }>>;
  now?: number;
}): Promise<boolean> {
  try {
    const marker = await readMarker(options.now ?? Date.now());
    if (!marker) return false;
    if (marker.userId && marker.userId !== options.userId) {
      await clearShopRegistrationPending();
      return false;
    }
    let workplaces: ReadonlyArray<{ isOwner: boolean }>;
    try {
      workplaces = await options.fetchWorkplaces();
    } catch {
      return true;
    }
    if (workplaces.some((workplace) => workplace.isOwner)) {
      await clearShopRegistrationPending();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
