// Builds a minimal JPEG whose EXIF carries a GPS block. rationals are [num, den] x3.
export function jpegWithGps({ little = true, latRef = "N", lat = [[28, 1], [36, 1], [5004, 100]], lngRef = "E", lng = [[77, 1], [12, 1], [3240, 100]], gps = true, extraIfd0 = false } = {}) {
  const u16 = (v) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v) => (little ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255] : [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const entry = (tag, type, count, value) => [...u16(tag), ...u16(type), ...u32(count), ...value];
  const ifd0Count = extraIfd0 ? 2 : 1;
  const ifd0Len = 2 + ifd0Count * 12 + 4;
  const gpsOffset = 8 + ifd0Len;
  const gpsLen = 2 + 4 * 12 + 4;
  const dataOffset = gpsOffset + gpsLen;
  const rat = (parts) => parts.flatMap(([n, d]) => [...u32(n), ...u32(d)]);
  const ifd0 = [...u16(ifd0Count)];
  if (extraIfd0) ifd0.push(...entry(0x010f, 2, 2, [65, 0, 0, 0]));
  ifd0.push(...entry(0x8825, 4, 1, u32(gps ? gpsOffset : 0)), ...u32(0));
  const gpsIfd = [...u16(4),
    ...entry(1, 2, 2, [latRef.charCodeAt(0), 0, 0, 0]),
    ...entry(2, 5, 3, u32(dataOffset)),
    ...entry(3, 2, 2, [lngRef.charCodeAt(0), 0, 0, 0]),
    ...entry(4, 5, 3, u32(dataOffset + 24)), ...u32(0)];
  const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...ifd0, ...(gps ? [...gpsIfd, ...rat(lat), ...rat(lng)] : [])];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const size = exif.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, size >> 8, size & 255, ...exif, 0xff, 0xda, 0, 2, 0xff, 0xd9]).buffer;
}

