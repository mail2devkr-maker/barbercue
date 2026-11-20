/**
 * Reads the GPS position out of a JPEG's EXIF block, in the browser, so an owner can use a photo taken at the shop as the
 * starting point for a location proposal (owner issue #13). The photo and its metadata never leave the device: only the
 * two numbers the owner then chooses to send are sent, through the normal reviewed proposal. This is NOT proof of where
 * the shop is; a photo can be old, edited or taken elsewhere, so a FastQue reviewer still decides.
 */

/** Only the start of the file can hold EXIF; never read a whole large photo into memory for this. */
export const PHOTO_HEAD_BYTES = 256 * 1024;

export type PhotoGps = { latitude: number; longitude: number };
export type PhotoGpsResult = { ok: true; position: PhotoGps } | { ok: false; reason: "not-jpeg" | "no-location" | "unreadable" };

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

export function readPhotoGps(buffer: ArrayBuffer): PhotoGpsResult {
  const view = new DataView(buffer);
  const len = view.byteLength;
  if (len < 4 || view.getUint16(0) !== 0xffd8) return { ok: false, reason: "not-jpeg" };
  try {
    let offset = 2;
    while (offset + 4 <= len) {
      if (view.getUint8(offset) !== 0xff) return { ok: false, reason: "no-location" };
      const marker = view.getUint8(offset + 1);
      if (marker === 0xda || marker === 0xd9) return { ok: false, reason: "no-location" };
      const size = view.getUint16(offset + 2);
      if (size < 2) return { ok: false, reason: "unreadable" };
      if (marker === 0xe1 && offset + 10 <= len && view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0) {
        return fromTiff(view, offset + 10, Math.min(len, offset + 2 + size));
      }
      offset += 2 + size;
    }
    return { ok: false, reason: "no-location" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

function fromTiff(view: DataView, tiff: number, end: number): PhotoGpsResult {
  if (tiff + 8 > end) return { ok: false, reason: "unreadable" };
  const order = view.getUint16(tiff);
  const little = order === 0x4949;
  if (!little && order !== 0x4d4d) return { ok: false, reason: "unreadable" };
  if (view.getUint16(tiff + 2, little) !== 42) return { ok: false, reason: "unreadable" };

  const inside = (pos: number, bytes: number) => pos >= tiff && pos + bytes <= end;
  const entries = (ifd: number) => {
    const at = tiff + ifd;
    if (!inside(at, 2)) throw new Error("range");
    const count = view.getUint16(at, little);
    if (!inside(at + 2, count * 12)) throw new Error("range");
    const found = new Map<number, { type: number; count: number; valueAt: number }>();
    for (let i = 0; i < count; i += 1) {
      const e = at + 2 + i * 12;
      const type = view.getUint16(e + 2, little);
      const n = view.getUint32(e + 4, little);
      const size = (TYPE_SIZE[type] ?? 0) * n;
      const valueAt = size <= 4 ? e + 8 : tiff + view.getUint32(e + 8, little);
      if (!TYPE_SIZE[type] || !inside(valueAt, size)) continue;
      found.set(view.getUint16(e, little), { type, count: n, valueAt });
    }
    return found;
  };

  const ifd0 = entries(view.getUint32(tiff + 4, little));
  const pointer = ifd0.get(0x8825);
  if (!pointer) return { ok: false, reason: "no-location" };
  const gpsOffset = view.getUint32(pointer.valueAt, little);
  if (gpsOffset === 0) return { ok: false, reason: "no-location" };
  const gps = entries(gpsOffset);

  const ref = (tag: number) => {
    const e = gps.get(tag);
    return e && e.type === 2 ? String.fromCharCode(view.getUint8(e.valueAt)) : null;
  };
  const degrees = (tag: number) => {
    const e = gps.get(tag);
    if (!e || e.type !== 5 || e.count !== 3) return null;
    const part = (i: number) => {
      const den = view.getUint32(e.valueAt + i * 8 + 4, little);
      return den === 0 ? NaN : view.getUint32(e.valueAt + i * 8, little) / den;
    };
    const value = part(0) + part(1) / 60 + part(2) / 3600;
    return Number.isFinite(value) ? value : null;
  };

  const latRef = ref(1);
  const lat = degrees(2);
  const lngRef = ref(3);
  const lng = degrees(4);
  if (lat === null || lng === null || (latRef !== "N" && latRef !== "S") || (lngRef !== "E" && lngRef !== "W")) return { ok: false, reason: "no-location" };
  const latitude = (latRef === "S" ? -lat : lat);
  const longitude = (lngRef === "W" ? -lng : lng);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { ok: false, reason: "unreadable" };
  return { ok: true, position: { latitude, longitude } };
}

export function photoGpsMessage(reason: "not-jpeg" | "no-location" | "unreadable"): string {
  if (reason === "not-jpeg") return "Only JPG photos can be read for a location. Type the coordinates or use your device location instead.";
  if (reason === "no-location") return "That photo has no location in it. Many phones and apps remove it. Type the coordinates or use your device location instead.";
  return "FastQue could not read a location from that photo. Type the coordinates instead.";
}
