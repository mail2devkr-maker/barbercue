import { readPhotoGps, photoGpsMessage, PHOTO_HEAD_BYTES } from "../photo-gps";
import { jpegWithGps } from "./photo-gps-fixture";

describe("readPhotoGps (owner issue #13)", () => {
  it.each([true, false])("reads degrees/minutes/seconds in both byte orders (little=%s)", (little) => {
    const r = readPhotoGps(jpegWithGps({ little }));
    expect(r.ok).toBe(true);
    expect(r.position.latitude).toBeCloseTo(28 + 36 / 60 + 50.04 / 3600, 6);
    expect(r.position.longitude).toBeCloseTo(77 + 12 / 60 + 32.4 / 3600, 6);
  });
  it("makes south and west negative", () => {
    const r = readPhotoGps(jpegWithGps({ latRef: "S", lngRef: "W" }));
    expect(r.position.latitude).toBeLessThan(0);
    expect(r.position.longitude).toBeLessThan(0);
  });
  it("finds the GPS block when other IFD0 entries come first", () => {
    expect(readPhotoGps(jpegWithGps({ extraIfd0: true })).ok).toBe(true);
  });
  it("says there is no location when the photo has none, or the reference letters are missing/odd", () => {
    expect(readPhotoGps(jpegWithGps({ gps: false }))).toEqual({ ok: false, reason: "no-location" });
    expect(readPhotoGps(jpegWithGps({ latRef: "X" }))).toEqual({ ok: false, reason: "no-location" });
  });
  it("refuses anything that is not a JPEG, including empty and tiny input", () => {
    expect(readPhotoGps(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({ ok: false, reason: "not-jpeg" });
    expect(readPhotoGps(new ArrayBuffer(0))).toEqual({ ok: false, reason: "not-jpeg" });
  });
  it("refuses a block whose TIFF header is wrong", () => {
    const bytes = new Uint8Array(jpegWithGps());
    bytes[14] = 43; // TIFF magic must be 42
    expect(readPhotoGps(bytes.buffer)).toEqual({ ok: false, reason: "unreadable" });
  });
  it("never throws on a truncated or corrupt block", () => {
    const full = new Uint8Array(jpegWithGps());
    for (let cut = 4; cut < full.length; cut += 3) {
      const r = readPhotoGps(full.slice(0, cut).buffer);
      expect(r.ok === true || ["no-location", "unreadable"].includes(r.reason)).toBe(true);
      if (r.ok) expect(Math.abs(r.position.latitude)).toBeLessThanOrEqual(90);
    }
  });
  it("rejects a zero denominator and out-of-range degrees instead of inventing a position", () => {
    expect(readPhotoGps(jpegWithGps({ lat: [[28, 0], [0, 1], [0, 1]] })).ok).toBe(false);
    expect(readPhotoGps(jpegWithGps({ lat: [[95, 1], [0, 1], [0, 1]] }))).toEqual({ ok: false, reason: "unreadable" });
  });
  it("reads only the head of the file and has a message for each failure", () => {
    expect(PHOTO_HEAD_BYTES).toBe(256 * 1024);
    for (const reason of ["not-jpeg", "no-location", "unreadable"]) expect(photoGpsMessage(reason).length).toBeGreaterThan(20);
  });
});
