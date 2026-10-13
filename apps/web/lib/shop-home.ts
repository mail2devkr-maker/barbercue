/**
 * Which shop's dashboard home an owner/barber lands on after signing in or pressing "Dashboard".
 *
 *  - exactly one shop they may operate  -> that shop, straight away (no shop list in between);
 *  - several shops                       -> the shop they used last, but ONLY if the server still lists
 *                                           it for them; otherwise null (show the shop picker);
 *  - no shop yet                         -> null (the page shows the registration / invitation path).
 *
 * `shops` must be the server's own list of shops this user may operate: authorisation is never
 * decided from the remembered id.
 */
export function chooseShopHome(shops: ReadonlyArray<{ id: string }>, rememberedId: string | null): string | null {
  if (shops.length === 0) return null;
  if (shops.length === 1) return shops[0].id;
  if (rememberedId && shops.some((shop) => shop.id === rememberedId)) return rememberedId;
  return null;
}

export const shopHomePath = (salonId: string): string => `/dashboard/salons/${salonId}`;
