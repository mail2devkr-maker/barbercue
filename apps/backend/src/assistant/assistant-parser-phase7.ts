import { AssistantActionId } from '@barbercue/shared';

/**
 * Batch 12 intents (issue #362): a barber's own day, the owner's cancellation figures, and a
 * customer's credit balance. Read-only. Booking-level cancel phrases ("5 baje wala cancel karo")
 * are not matched here: only questions about counts or reports are.
 *
 * Batch 13: booking sources (where bookings came from) and the automatic staff assignment switch.
 * A question ("auto assign on hai kya") is always the read; only an explicit on/off command is the
 * write, and the write still needs on-screen confirmation.
 */
export type Phase7Intent =
  | { action: typeof AssistantActionId.STAFF_MY_WORK }
  | {
      action: typeof AssistantActionId.CANCELLATION_ANALYTICS;
      range: '7d' | '30d' | '90d';
    }
  | { action: typeof AssistantActionId.MY_CREDITS }
  | {
      action: typeof AssistantActionId.BOOKING_SOURCES;
      range: 'today' | '7d' | '30d';
    }
  | { action: typeof AssistantActionId.AUTO_ASSIGN_VIEW }
  | { action: typeof AssistantActionId.AUTO_ASSIGN_SET; enabled: boolean };

const W = (words: string) => new RegExp(`(?:^|\\s)(?:${words})(?=\\s|$)`, 'u');

const MY = W('mera|meri|mere|my|मेरा|मेरी');
const WORK = W('kaam|work|din|day|duty|काम');
const CANCEL_STATS = W(
  'cancellations|cancellation report|cancel report|kitne cancel|kitni cancel|cancel kitne|cancel kitni|kitne appointment cancel|kitni booking cancel|how many cancel|how many cancelled',
);
// Batch 13: where bookings come from, and the automatic staff assignment switch.
const SOURCES = W(
  'booking sources|booking source|bookings ka source|booking ka source|source wise|kahan se aayi|kahan se aaye|kaha se aayi|kaha se aaye|kahan se aa rahi|kahan se aa rahe|come from|came from|coming from|बुकिंग कहां से|कहां से आई|कहाँ से आई',
);
const BOOKINGS = W(
  'booking|bookings|appointment|appointments|customer|customers|बुकिंग|ग्राहक',
);
const AUTO_ASSIGN = W(
  'auto assign|auto assignment|autoassign|automatic assign|automatic assignment|automatic staff assignment|auto staff|ऑटो असाइन',
);
const QUESTION = W(
  'hai kya|kya hai|kya ye|status|is it|chal raha|chalu hai|on hai|off hai|band hai|kaisa hai|batao',
);
const TURN_ON = W(
  'on karo|on kar do|on kardo|chalu karo|chalu kar do|enable|shuru karo|turn on|switch on|start karo|चालू करो',
);
const TURN_OFF = W(
  'off karo|off kar do|off kardo|band karo|band kar do|bandh karo|disable|turn off|switch off|rok do|बंद करो',
);
const CREDITS = W('credit|credits|wallet|balance|क्रेडिट|वॉलेट');

export function parsePhase7(
  text: string,
  surface: 'shop' | 'customer' | 'admin' | 'employee',
): Phase7Intent | null {
  if (surface === 'customer')
    return CREDITS.test(text) ? { action: AssistantActionId.MY_CREDITS } : null;
  if (surface !== 'shop') return null;
  if (AUTO_ASSIGN.test(text)) {
    // A question about the switch is only a read, even when it contains "on"/"band".
    if (TURN_OFF.test(text) && !W('band hai|off hai').test(text))
      return { action: AssistantActionId.AUTO_ASSIGN_SET, enabled: false };
    if (TURN_ON.test(text) && !QUESTION.test(text))
      return { action: AssistantActionId.AUTO_ASSIGN_SET, enabled: true };
    return { action: AssistantActionId.AUTO_ASSIGN_VIEW };
  }
  if (
    SOURCES.test(text) &&
    (BOOKINGS.test(text) ||
      W('booking sources|booking source|source wise').test(text))
  ) {
    const range = W('aaj|today|आज').test(text)
      ? 'today'
      : W('hafte|hafta|week|7 din|हफ्ते').test(text)
        ? '7d'
        : '30d';
    return { action: AssistantActionId.BOOKING_SOURCES, range };
  }
  if (CANCEL_STATS.test(text)) {
    const range = W('hafte|hafta|week|7 din|हफ्ते').test(text)
      ? '7d'
      : W('3 mahine|teen mahine|90 din|quarter').test(text)
        ? '90d'
        : '30d';
    return { action: AssistantActionId.CANCELLATION_ANALYTICS, range };
  }
  if (MY.test(text) && WORK.test(text))
    return { action: AssistantActionId.STAFF_MY_WORK };
  return null;
}
