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
 *    returning customer forever.
 *
 * It stores no account data, no tokens and nothing about the shop — only "this device was in the
 * middle of owner registration, since <time>".
 */

export const SHOP_REGISTRATION_RESUME_KEY = 'fastque_pending_shop_registration_v1';
export const RESUME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function markShopRegistrationPending(now: number = Date.now()): Promise<void> {
  try {
    await setItem(SHOP_REGISTRATION_RESUME_KEY, JSON.stringify({ v: 1, since: now }));
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

/** True only for a well-formed, recent flag. Never throws; corrupt storage means "not pending". */
export async function isShopRegistrationPending(now: number = Date.now()): Promise<boolean> {
  try {
    const raw = await getItem(SHOP_REGISTRATION_RESUME_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { v?: unknown; since?: unknown };
    if (parsed.v !== 1 || typeof parsed.since !== 'number' || !Number.isFinite(parsed.since)) return false;
    const age = now - parsed.since;
    return age >= 0 && age <= RESUME_WINDOW_MS;
  } catch {
    return false;
  }
}
