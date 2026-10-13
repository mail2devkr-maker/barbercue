// The selection rule itself is shared with the Android app (one rule, tested once): a single shop is
// opened directly, several shops restore the last one only if the server still lists it, otherwise the
// user picks. See packages/shared/src/shop-home.ts.
export { chooseShopHome } from "@barbercue/shared";

export const shopHomePath = (salonId: string): string => `/dashboard/salons/${salonId}`;
