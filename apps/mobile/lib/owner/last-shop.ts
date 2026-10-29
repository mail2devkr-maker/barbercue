import { deleteItem, getItem, setItem } from '../secure-storage';

/**
 * The shop an owner or barber last worked in, remembered per account on this phone so relaunching the
 * app (or signing back in) opens THAT shop's dashboard instead of asking again. It is only a hint: it
 * stores two opaque ids (no token, no role) and the caller always checks it against the shops the
 * server lists for the user (SalonProvider via chooseShopHome) before using it - a stale or tampered
 * value can never select a shop the user cannot operate.
 */
export const LAST_SHOP_KEY = 'fastque_owner_last_shop_v1';

export async function rememberLastShop(userId: string, salonId: string): Promise<void> {
  try {
    await setItem(LAST_SHOP_KEY, JSON.stringify({ v: 1, u: userId, s: salonId }));
  } catch {
    // A convenience only: failing to persist just means the picker is shown next time.
  }
}

/** The remembered shop id for THIS account, or null. Never throws; corrupt storage means "none". */
export async function readLastShop(userId: string): Promise<string | null> {
  try {
    const raw = await getItem(LAST_SHOP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: unknown; u?: unknown; s?: unknown };
    return parsed.v === 1 && parsed.u === userId && typeof parsed.s === 'string' && parsed.s.length > 0 ? parsed.s : null;
  } catch {
    return null;
  }
}

export async function forgetLastShop(): Promise<void> {
  try {
    await deleteItem(LAST_SHOP_KEY);
  } catch {
    // Nothing more to do: a stale entry is ignored for any other account and re-validated for this one.
  }
}
