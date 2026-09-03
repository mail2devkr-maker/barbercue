// Phase 14 (Localization & Voice Operations), extended for Issue 9 (mobile launch mission) to
// also cover the core customer-journey UI strings (UiStrings/UI_STRINGS/uiStringsFor below) — city,
// service, search, book, join queue, confirm, cancel, waiting/your-turn, sign-in, notifications,
// key errors, retry, open/closed. Deliberately still not a general full-app translation layer:
// everything outside that explicit list (owner/staff surfaces, secondary screens, long-form
// copy) stays English-only, same "real slice, honestly scoped" pattern as every other phase (see
// BARBERCUE_NON_PAYMENT_FEATURE_STATUS.md).
//
// Extensibility contract: adding a language means adding one Language enum value (../enums) plus
// one complete VoiceAnnouncements object, one complete UiStrings object, one SPEECH_LOCALE entry
// and one LANGUAGE_LABELS entry below — TypeScript's Record<Language, ...> makes an incomplete
// addition a compile error, not a silent English fallback for the new language.

import { Language } from '../enums';

export interface VoiceAnnouncements {
  /** Customer: a booked appointment's queue turn is about to come up. */
  turnApproaching(): string;
  /** Customer: the estimated wait shifted enough to be worth a fresh alert. */
  waitTimeChanged(): string;
  /**
   * Owner/staff: a new booking just landed on this salon. `barberName` is the actual assigned
   * barber if one exists yet, else the customer's selected preference, else null when the
   * customer chose "Any staff" and no one has been assigned yet — callers must never invent a
   * name for that null case (see formatVoiceBarberDate below for how `date`/`time` are produced).
   */
  newBookingReceived(
    serviceName: string | null,
    barberName: string | null,
    salonName: string | null,
    date: string | null,
    time: string | null,
  ): string;
  /** Owner/staff: a booking on this salon was just cancelled. */
  bookingCancelled(): string;
  /** Owner/staff: a walk-in just joined the live queue. */
  newCustomerJoined(tokenNumber: number, serviceName: string | null): string;
  /** Spoken once, immediately, when an owner/staff member turns voice announcements on — the only
   * way speechSynthesis/Speech.speak can be confirmed working without waiting for a real event. */
  voiceAnnouncementsOn(): string;
}

const en: VoiceAnnouncements = {
  turnApproaching: () => 'Your turn is almost here.',
  waitTimeChanged: () => 'Your wait time has changed.',
  newBookingReceived: (serviceName, barberName, salonName, date, time) => {
    const service = serviceName ? `New ${serviceName} service booked` : 'New booking received';
    const who = barberName ? ` for ${barberName}` : '';
    const where = salonName ? ` at ${salonName}` : '';
    const when = [date ? `on ${date}` : null, time ? `at ${time}` : null].filter(Boolean).join(' ');
    const whenClause = when ? ` ${when}` : '';
    const sentence = `${service}${who}${where}${whenClause}.`;
    return barberName ? sentence : `${sentence} Barber not assigned yet.`;
  },
  bookingCancelled: () => 'Booking cancelled.',
  newCustomerJoined: (tokenNumber, serviceName) =>
    `New customer joined the queue. Token number ${tokenNumber}${serviceName ? `, ${serviceName}` : ''}.`,
  voiceAnnouncementsOn: () => 'Voice announcements on.',
};

// Hindi, Devanagari script — expo-speech / speechSynthesis both accept UTF-8 text directly, no
// transliteration needed as long as the utterance's `lang`/voice is set to a Hindi locale (see
// SPEECH_LOCALE below), which is the caller's responsibility, not this module's. Proper nouns
// (service/barber/salon names) and the date/time string stay exactly as passed in — they are
// already Latin-script/English data throughout the rest of this product, matching how the
// pre-existing entries below already embed `serviceName`/`tokenNumber` untranslated.
const hi: VoiceAnnouncements = {
  turnApproaching: () => 'आपकी बारी जल्द आने वाली है।',
  waitTimeChanged: () => 'आपके प्रतीक्षा समय में बदलाव हुआ है।',
  newBookingReceived: (serviceName, barberName, salonName, date, time) => {
    const parts = [`नई ${serviceName ?? 'बुकिंग'} सेवा`];
    if (barberName) parts.push(`${barberName} के लिए`);
    if (salonName) parts.push(`${salonName} में`);
    if (date) parts.push(`${date} को`);
    if (time) parts.push(`${time} बजे`);
    parts.push('बुक हुई।');
    const sentence = parts.join(' ');
    return barberName ? sentence : `${sentence} अभी तक बार्बर तय नहीं हुआ है।`;
  },
  bookingCancelled: () => 'बुकिंग रद्द कर दी गई है।',
  newCustomerJoined: (tokenNumber, serviceName) =>
    `कतार में नया ग्राहक जुड़ा। टोकन नंबर ${tokenNumber}${serviceName ? `, ${serviceName}` : ''}।`,
  voiceAnnouncementsOn: () => 'आवाज़ में सूचनाएं चालू हैं।',
};

export const VOICE_ANNOUNCEMENTS: Readonly<Record<Language, VoiceAnnouncements>> = {
  [Language.EN]: en,
  [Language.HI]: hi,
};

/** Never throws on an unrecognised value — falls back to English, matching every other
 * "unknown/unset preference" default in this codebase. */
export function voiceAnnouncementsFor(language: Language | null | undefined): VoiceAnnouncements {
  return (language && VOICE_ANNOUNCEMENTS[language]) || VOICE_ANNOUNCEMENTS[Language.EN];
}

/** BCP-47 tags for Speech.speak()'s `language` option / SpeechSynthesisUtterance.lang — the `-IN`
 * region keeps both English and Hindi announcements in an Indian accent/voice where the platform
 * offers one, matching COUNTRY_LOCALE's existing en-IN convention in ../locale. */
export const SPEECH_LOCALE: Readonly<Record<Language, string>> = {
  [Language.EN]: 'en-IN',
  [Language.HI]: 'hi-IN',
};

/** Shown in the language switcher itself — each language's own name, in its own script. */
export const LANGUAGE_LABELS: Readonly<Record<Language, string>> = {
  [Language.EN]: 'English',
  [Language.HI]: 'हिन्दी',
};

/** "1st" / "2nd" / "3rd" / "4th" ... "11th"-"13th" are always -th regardless of the last digit. */
export function ordinalDay(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/**
 * Voice/push booking announcements must speak the SALON's local date/time, never the listening
 * device's — a booking made from a phone in a different timezone must announce the same wall-
 * clock time an owner physically in that salon would recognize as their own. Pure: takes the IANA
 * zone the caller already resolved (apps/*'s own dashboard/salons/:salonId/timezone lookup),
 * never infers one itself.
 *
 * `date` is "5th September" (ordinal day + full month name, no year — a booking is always for the
 * near future). `time` drops a redundant ":00" ("10 AM") but keeps real minutes ("10:30 AM") —
 * built from Intl.DateTimeFormat parts rather than string-slicing the formatted output, so it
 * can't silently drift for locales/hour-cycles this file doesn't anticipate.
 */
export function formatVoiceDateTime(isoUtc: string, timeZone: string): { date: string; time: string } {
  const when = new Date(isoUtc);
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: 'numeric',
    month: 'long',
  }).formatToParts(when);
  const day = Number(dateParts.find((p) => p.type === 'day')?.value ?? '');
  const month = dateParts.find((p) => p.type === 'month')?.value ?? '';
  const date = Number.isFinite(day) && month ? `${ordinalDay(day)} ${month}` : '';

  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  }).formatToParts(when);
  const hour = timeParts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = timeParts.find((p) => p.type === 'minute')?.value ?? '0';
  const dayPeriod = timeParts.find((p) => p.type === 'dayPeriod')?.value ?? '';
  // Intl's `minute: 'numeric'` still zero-pads ("00", not "0") in this runtime's ICU data — compare
  // the numeric value, not the raw string, so an on-the-hour slot reliably drops the ":00".
  const time = hour ? `${hour}${Number(minute) !== 0 ? `:${minute.padStart(2, '0')}` : ''} ${dayPeriod}`.trim() : '';

  return { date, time };
}

/**
 * Issue 9 (mobile launch mission) — the customer-journey strings a direct, pre-auth-reachable
 * language switcher actually needs. Deliberately a flat, keyed dictionary (not a template/ICU
 * system) — every value here is a short label or a fixed short sentence, never one built from
 * interpolated user data (booking/salon/service names stay in their own source language
 * regardless of UI language, same as the voice announcements above).
 */
export interface UiStrings {
  city: string;
  service: string;
  search: string;
  searchPlaceholder: string;
  nearMe: string;
  book: string;
  joinQueue: string;
  confirm: string;
  cancel: string;
  keepBooking: string;
  waiting: string;
  yourTurn: string;
  called: string;
  inService: string;
  signIn: string;
  signInWithGoogle: string;
  notifications: string;
  noNotifications: string;
  markAllRead: string;
  retry: string;
  open: string;
  closed: string;
  noResults: string;
  loading: string;
  outstandingDue: string;
  freeCancellation: string;
  statusConfirmed: string;
  statusPendingPayment: string;
  statusCancelled: string;
  statusCompleted: string;
  statusNoShow: string;
  genericError: string;
  offline: string;
}

const enUi: UiStrings = {
  city: 'City',
  service: 'Service',
  search: 'Search',
  searchPlaceholder: 'Search shops or services…',
  nearMe: 'Near me',
  book: 'Book an appointment',
  joinQueue: 'Join live queue',
  confirm: 'Confirm booking',
  cancel: 'Cancel booking',
  keepBooking: 'Keep booking',
  waiting: 'Waiting',
  yourTurn: "It's your turn",
  called: "You're being called",
  inService: 'In service',
  signIn: 'Sign in',
  signInWithGoogle: 'Sign in with Google',
  notifications: 'Notifications',
  noNotifications: "You're all caught up",
  markAllRead: 'Mark all read',
  retry: 'Try again',
  open: 'Open now',
  closed: 'Closed',
  noResults: 'No results found',
  loading: 'Loading…',
  outstandingDue: 'Outstanding due',
  freeCancellation: 'Free cancellation',
  statusConfirmed: 'Confirmed',
  statusPendingPayment: 'Payment pending',
  statusCancelled: 'Cancelled',
  statusCompleted: 'Completed',
  statusNoShow: 'No-show',
  genericError: 'Something went wrong. Please try again.',
  offline: "You appear to be offline.",
};

const hiUi: UiStrings = {
  city: 'शहर',
  service: 'सेवा',
  search: 'खोजें',
  searchPlaceholder: 'दुकान या सेवा खोजें…',
  nearMe: 'मेरे पास',
  book: 'अपॉइंटमेंट बुक करें',
  joinQueue: 'लाइव कतार में शामिल हों',
  confirm: 'बुकिंग की पुष्टि करें',
  cancel: 'बुकिंग रद्द करें',
  keepBooking: 'बुकिंग रखें',
  waiting: 'प्रतीक्षा में',
  yourTurn: 'आपकी बारी आ गई है',
  called: 'आपको बुलाया जा रहा है',
  inService: 'सेवा जारी है',
  signIn: 'साइन इन करें',
  signInWithGoogle: 'Google से साइन इन करें',
  notifications: 'सूचनाएं',
  noNotifications: 'आप पूरी तरह अपडेट हैं',
  markAllRead: 'सभी को पढ़ा हुआ चिह्नित करें',
  retry: 'फिर कोशिश करें',
  open: 'अभी खुला है',
  closed: 'बंद है',
  noResults: 'कोई परिणाम नहीं मिला',
  loading: 'लोड हो रहा है…',
  outstandingDue: 'बकाया राशि',
  freeCancellation: 'मुफ़्त रद्दीकरण',
  statusConfirmed: 'पुष्टि हो गई',
  statusPendingPayment: 'भुगतान लंबित',
  statusCancelled: 'रद्द',
  statusCompleted: 'पूर्ण',
  statusNoShow: 'नो-शो',
  genericError: 'कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें।',
  offline: 'लगता है आप ऑफ़लाइन हैं।',
};

export const UI_STRINGS: Readonly<Record<Language, UiStrings>> = {
  [Language.EN]: enUi,
  [Language.HI]: hiUi,
};

/** Never throws on an unrecognised value — same "unknown/unset -> English" default as
 * voiceAnnouncementsFor, so a fresh/anonymous session always renders something correct. */
export function uiStringsFor(language: Language | null | undefined): UiStrings {
  return (language && UI_STRINGS[language]) || UI_STRINGS[Language.EN];
}
