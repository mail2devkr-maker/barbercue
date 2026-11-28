/**
 * Which shop a signed-in owner or barber lands in (web and Android use this one rule).
 *
 *  - exactly one shop they may operate  -> that shop, straight away (no shop list in between);
 *  - several shops                       -> the shop they used last, but ONLY if the server still lists
 *                                           it for them; otherwise null (show the shop picker);
 *  - no shop yet                         -> null (the app shows the registration / invitation path).
 *
 * `shops` must be the server's own list of shops this user may operate: authorisation is never decided
 * from the remembered id, which is only a hint.
 */
export function chooseShopHome(shops: ReadonlyArray<{ id: string }>, rememberedId: string | null | undefined): string | null {
  if (shops.length === 0) return null;
  if (shops.length === 1) return shops[0].id;
  if (rememberedId && shops.some((shop) => shop.id === rememberedId)) return rememberedId;
  return null;
}
