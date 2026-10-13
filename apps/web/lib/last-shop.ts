/**
 * The last shop an owner/barber worked in, remembered per account in this browser so "Dashboard" and
 * a fresh sign-in can land on the shop they were using instead of a shop list.
 *
 * It is only ever a HINT. It holds two opaque ids (never a token or a role), and every consumer
 * checks it against the list of shops the server says this user may operate (the workplaces
 * endpoint) before using it - so a stale or tampered value can never open a shop the user does not
 * have access to; the page they would land on is authorised by the API regardless.
 */
const KEY = "fastque.owner.lastShop.v1";

interface Stored {
  u: string;
  s: string;
}

export function rememberLastShop(userId: string, salonId: string): void {
  try {
    const value: Stored = { u: userId, s: salonId };
    window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* private mode or blocked storage: the dashboard simply falls back to the shop picker */
  }
}

export function readLastShop(userId: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return parsed.u === userId && typeof parsed.s === "string" && parsed.s.length > 0 ? parsed.s : null;
  } catch {
    return null;
  }
}

export function forgetLastShop(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
