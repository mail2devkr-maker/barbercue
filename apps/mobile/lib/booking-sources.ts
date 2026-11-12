import type { BookingAttributionSource } from '@barbercue/shared';

/**
 * Owner-facing names for booking sources — identical to apps/web/lib/booking-sources.ts so the app
 * and the website label the same server data the same way. "Not recorded" is never guessed.
 */
const SOURCE_LABEL: Record<BookingAttributionSource, string> = {
  FASTQUE_APP: 'FastQue app',
  FASTQUE_WEB: 'FastQue website',
  WALK_IN: 'Live Queue',
  IN_SHOP: 'In-shop appointment',
  FACEBOOK: 'Facebook campaign',
  INSTAGRAM: 'Instagram campaign',
  CHATGPT: 'ChatGPT campaign',
  OTHER: 'Other campaign',
  UNKNOWN: 'Not recorded',
};

export function sourceLabel(source: string): string {
  return (SOURCE_LABEL as Record<string, string>)[source] ?? source;
}
