/** Rounds to 5 decimals (about 1 m), the precision a shop pin needs. */
function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

/** Matches a Google Maps copy like "28.61394, 77.20902". */
export const LAT_LNG_PAIR = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/**
 * Parses the optional manual pin. Empty both = no pin. A Google Maps "lat, lng" pasted into the
 * latitude box is split automatically by the input handler, so here both boxes are plain numbers.
 */
export function parseManualPin(latText: string, lngText: string):
  | { kind: "none" }
  | { kind: "ok"; lat: number; lng: number }
  | { kind: "error"; message: string } {
  const a = latText.trim();
  const b = lngText.trim();
  if (!a && !b) return { kind: "none" };
  if (!a || !b) return { kind: "error", message: "Please enter both latitude and longitude, or leave both empty." };
  const num = /^-?\d{1,3}(\.\d+)?$/;
  if (!num.test(a) || !num.test(b)) return { kind: "error", message: "Latitude and longitude must be numbers, for example 28.61394 and 77.20902." };
  const lat = Number(a);
  const lng = Number(b);
  if (lat < -90 || lat > 90) return { kind: "error", message: "Latitude must be between -90 and 90." };
  if (lng < -180 || lng > 180) return { kind: "error", message: "Longitude must be between -180 and 180." };
  if (lat === 0 && lng === 0) return { kind: "error", message: "0, 0 is not a shop location. Please check the numbers." };
  return { kind: "ok", lat: round5(lat), lng: round5(lng) };
}
