import { AssistantActionId } from '@barbercue/shared';

/**
 * Batch 12 intents (issue #362): a barber's own day, the owner's cancellation figures, and a
 * customer's credit balance. Read-only. Booking-level cancel phrases ("5 baje wala cancel karo")
 * are not matched here: only questions about counts or reports are.
 */
export type Phase7Intent =
  | { action: typeof AssistantActionId.STAFF_MY_WORK }
  | {
      action: typeof AssistantActionId.CANCELLATION_ANALYTICS;
      range: '7d' | '30d' | '90d';
    }
  | { action: typeof AssistantActionId.MY_CREDITS };

const W = (words: string) => new RegExp(`(?:^|\\s)(?:${words})(?=\\s|$)`, 'u');

const MY = W('mera|meri|mere|my|मेरा|मेरी');
const WORK = W('kaam|work|din|day|duty|काम');
const CANCEL_STATS = W(
  'cancellations|cancellation report|cancel report|kitne cancel|kitni cancel|cancel kitne|cancel kitni|kitne appointment cancel|kitni booking cancel|how many cancel|how many cancelled',
);
const CREDITS = W('credit|credits|wallet|balance|क्रेडिट|वॉलेट');

export function parsePhase7(
  text: string,
  surface: 'shop' | 'customer' | 'admin' | 'employee',
): Phase7Intent | null {
  if (surface === 'customer')
    return CREDITS.test(text) ? { action: AssistantActionId.MY_CREDITS } : null;
  if (surface !== 'shop') return null;
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
