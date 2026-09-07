// Moved to packages/shared/src/locale (Mobile Shop Owner Onboarding mission) so
// RegisterShopScreen (mobile) shares this exact ordering with RegisterSalonForm (web) instead of
// a second, potentially drifting copy. Re-exported here so the existing web import path keeps
// working unchanged.
export { orderCountriesForDisplay } from "@barbercue/shared";
