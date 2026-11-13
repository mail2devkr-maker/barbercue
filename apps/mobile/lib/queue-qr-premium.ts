// Website parity for apps/web/components/dashboard/QueueQrSection.tsx — the premium FastQue
// "Customer Queue QR" stand: gold QR on black, magenta frame, FastQue mark in the centre,
// gold→magenta shop name and the owner's saved address. Keep in step with the website.

export const QR_GOLD = '#FFE15C';
export const QR_MAGENTA = '#F20A83';
export const QR_BG = '#000000';
export const QR_MUTED = '#C9C3C4';
export const QR_TEXT = '#F7F5F4';

/** Same stops as the website's shopNameGradient (0% gold → 52% amber → 72% coral → 100% magenta). */
const NAME_GRADIENT: Array<[number, [number, number, number]]> = [
  [0, [0xff, 0xe1, 0x5c]],
  [0.52, [0xff, 0xc6, 0x5b]],
  [0.72, [0xff, 0x3e, 0x57]],
  [1, [0xf2, 0x0a, 0x83]],
];

/** The website's QR centre image is 46×34 on a 200px QR — the excavated fraction of the code. */
export const QR_CENTER_EXCAVATION = { widthRatio: 46 / 200, heightRatio: 34 / 200 } as const;

function hex(n: number): string {
  return Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
}

/** Colour of the shop-name gradient at position t (0..1), as #rrggbb. */
export function nameGradientColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < NAME_GRADIENT.length; i += 1) {
    const [p1, c1] = NAME_GRADIENT[i]!;
    const [p0, c0] = NAME_GRADIENT[i - 1]!;
    if (x <= p1) {
      const f = p1 === p0 ? 0 : (x - p0) / (p1 - p0);
      return `#${hex(c0[0] + (c1[0] - c0[0]) * f)}${hex(c0[1] + (c1[1] - c0[1]) * f)}${hex(c0[2] + (c1[2] - c0[2]) * f)}`;
    }
  }
  return '#f20a83';
}

/** Per-character colours so React Native can show a horizontal text gradient without a native mask. */
export function gradientCharacters(text: string): Array<{ char: string; color: string }> {
  const chars = Array.from(text);
  const last = Math.max(1, chars.length - 1);
  return chars.map((char, i) => ({ char, color: nameGradientColor(i / last) }));
}

/** Copy of apps/web/lib/queue-qr-print-address.ts — the owner's saved address, never invented. */
export function formatQueueQrPrintAddress(addressLine: string, postalCode: string | null): string {
  const address = addressLine.trim().replace(/\s+/gu, ' ');
  const pin = (postalCode ?? '').trim().replace(/\s+/gu, ' ');
  if (!address) return '';
  return pin && !address.includes(pin) ? `${address}, ${pin}` : address;
}

/** Same file-name rule as the website download (`<shop>-queue-qr-4x6in`). */
export function queueQrFileName(salonName: string): string {
  const slug = salonName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fastque';
  return `${slug}-queue-qr`;
}

/** Only a web link returned by the server is ever encoded (never one built on the phone). */
export function trustedQueueUrl(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}
