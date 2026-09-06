import * as Speech from 'expo-speech';
import { Language, SPEECH_LOCALE, voiceAnnouncementsFor } from '@barbercue/shared';

// Build 10 physical-device retest (Hindi TTS blocker): Hindi new-booking spoke ENGLISH, and Hindi
// cancellation produced total SILENCE. The prior version of this module already ruled out a stale
// "language" race (see OwnerBookingsScreen's own preferredLanguageRef comment — it reads
// LanguageProvider's synchronously-updated state, not a two-round-trip-stale
// user.preferredLanguage) — the persisted/selected app language really was Hindi when these
// announcements fired. That leaves the TTS engine layer: the previous code, when no installed
// voice matched the requested `hi-IN` locale, still called `Speech.speak(text, {language:
// 'hi-IN'})` with no explicit voice id and just hoped Android's TextToSpeech would do the right
// thing. It does not reliably reject an unsupported language tag — depending on the OEM/engine, it
// can silently keep using whichever voice is currently active (typically English) to read the
// Hindi text, or fail with no error callback at all, which is exactly "spoke English" and
// "silence" respectively. The fix is structural, not another guess: Hindi mode now NEVER calls
// Speech.speak without first confirming a real, installed Hindi-family voice exists. If none does,
// it skips speaking entirely and surfaces a throttled, actionable warning instead of risking either
// wrong-language or silent output again. English is untouched — its own physical retest already
// passed, so its "attempt with a language tag, retry once with the bare subtag on error" behavior
// is preserved exactly as it was.

let cachedVoices: Speech.Voice[] | null = null;
let cachedVoicesPromise: Promise<Speech.Voice[]> | null = null;

/** Test-only: clears the module-level voice cache so each test controls its own mocked voice list. */
export function __resetVoiceCacheForTests(): void {
  cachedVoices = null;
  cachedVoicesPromise = null;
}

// Voices are a device-level property that doesn't change during a session — fetched once and
// reused, rather than re-querying the native module on every single announcement.
async function getVoices(): Promise<Speech.Voice[]> {
  if (cachedVoices) return cachedVoices;
  if (!cachedVoicesPromise) {
    cachedVoicesPromise = Speech.getAvailableVoicesAsync()
      .then((voices) => {
        cachedVoices = voices;
        return voices;
      })
      .catch((err: unknown) => {
        console.warn('[voice] getAvailableVoicesAsync failed — proceeding without an explicit voice id', err);
        cachedVoicesPromise = null;
        return [];
      });
  }
  return cachedVoicesPromise;
}

// BCP-47-ish matching: an exact match on the full tag (e.g. "hi-IN") wins; otherwise any installed
// voice whose language shares the same primary subtag (e.g. "hi", "hi_IN", "hi-Latn-IN" — Android
// voice language strings aren't always formatted identically to the tag we requested) is accepted,
// covering the "hi-IN / hi / hi-*" family the Hindi blocker fix requires.
function findMatchingVoice(voices: Speech.Voice[], requestedLocale: string): Speech.Voice | null {
  const requestedPrimary = requestedLocale.split(/[-_]/)[0]?.toLowerCase();
  const exact = voices.find((v) => v.language?.toLowerCase() === requestedLocale.toLowerCase());
  if (exact) return exact;
  const familyMatch = voices.find((v) => v.language?.split(/[-_]/)[0]?.toLowerCase() === requestedPrimary);
  return familyMatch ?? null;
}

// Shared across every call site/announcement for the lifetime of the app — an owner whose device
// genuinely has no Hindi voice installed would otherwise get this warning on every single booking
// event, which is worse than useless. One cooldown, not a per-booking one.
const HINDI_VOICE_WARNING_THROTTLE_MS = 5 * 60_000;
let lastHindiVoiceWarningAt = 0;

/** Test-only: resets the warning throttle so each test controls its own timing. */
export function __resetHindiVoiceWarningThrottleForTests(): void {
  lastHindiVoiceWarningAt = 0;
}

function notifyHindiVoiceMissing(onHindiVoiceMissing: (() => void) | undefined): void {
  if (!onHindiVoiceMissing) return;
  const now = Date.now();
  if (now - lastHindiVoiceWarningAt < HINDI_VOICE_WARNING_THROTTLE_MS) return;
  lastHindiVoiceWarningAt = now;
  onHindiVoiceMissing();
}

export function speakBooking(params: {
  event: 'booking.created';
  bookingId: string;
  language: Language;
  serviceName: string | null;
  barberName: string | null;
  salonName: string | null;
  date: string | null;
  time: string | null;
  /** Throttled callback — fires when `language` is Hindi but no installed Hindi voice was found,
   * so the caller can surface an actionable, localized warning (e.g. a dismissable banner). Never
   * called for English, and never more than once per HINDI_VOICE_WARNING_THROTTLE_MS. */
  onHindiVoiceMissing?: () => void;
}): void;
export function speakBooking(params: {
  event: 'booking.cancelled';
  bookingId: string;
  language: Language;
  onHindiVoiceMissing?: () => void;
}): void;
export function speakBooking(
  params:
    | {
        event: 'booking.created';
        bookingId: string;
        language: Language;
        serviceName: string | null;
        barberName: string | null;
        salonName: string | null;
        date: string | null;
        time: string | null;
        onHindiVoiceMissing?: () => void;
      }
    | { event: 'booking.cancelled'; bookingId: string; language: Language; onHindiVoiceMissing?: () => void },
): void {
  const { event, bookingId, language, onHindiVoiceMissing } = params;
  const t = voiceAnnouncementsFor(language);
  const text =
    event === 'booking.created'
      ? t.newBookingReceived(params.serviceName, params.barberName, params.salonName, params.date, params.time)
      : t.bookingCancelled();
  // Persisted/selected app language is authoritative here — `language` is whatever the caller's
  // own LanguageProvider-backed state currently holds, never re-derived or guessed from the device.
  const requestedLocale = SPEECH_LOCALE[language] ?? SPEECH_LOCALE[Language.EN];
  const isHindi = language === Language.HI;

  void getVoices().then((voices) => {
    const matchedVoice = findMatchingVoice(voices, requestedLocale);

    // The core Hindi-blocker fix: never knowingly speak Hindi with an unmatched (English/default)
    // voice. Skip entirely rather than call Speech.speak and hope — that hope is exactly what
    // produced the confirmed "spoke English" / "silence" physical failures.
    if (isHindi && !matchedVoice) {
      console.warn(
        '[voice] Hindi requested but no installed Hindi-family voice found on this device — skipping speech rather than risking an English/default-voice fallback',
        { event, bookingId, requestedLocale, availableVoiceLanguages: voices.map((v) => v.language) },
      );
      notifyHindiVoiceMissing(onHindiVoiceMissing);
      return;
    }

    console.warn('[voice] speaking', {
      event,
      bookingId,
      effectiveLanguage: language,
      text,
      requestedLocale,
      matchedVoiceIdentifier: matchedVoice?.identifier ?? null,
      matchedVoiceLanguage: matchedVoice?.language ?? null,
    });

    // Reached only for English (matched or not — English's own physical retest already passed
    // with this exact behavior, unchanged) or for Hindi with a genuine matched voice (the branch
    // above already ruled out the unmatched case). The bare-primary-subtag retry below is bounded
    // to exactly one attempt and, for Hindi, only ever retries using that SAME real matched voice
    // — it can never fabricate a voice or drift to a different language's.
    const primarySubtag = requestedLocale.split(/[-_]/)[0];
    let retried = false;
    function attempt(languageTag: string) {
      Speech.speak(text, {
        language: languageTag,
        ...(matchedVoice ? { voice: matchedVoice.identifier } : {}),
        onStart: () => console.warn('[voice] onStart', { event, bookingId, languageTag }),
        onDone: () => console.warn('[voice] onDone', { event, bookingId, languageTag }),
        onStopped: () => console.warn('[voice] onStopped', { event, bookingId, languageTag }),
        onError: (error) => {
          console.warn('[voice] onError — TTS engine reported a failure', {
            event,
            bookingId,
            languageTag,
            retried,
            error: String(error),
          });
          if (!retried && primarySubtag && primarySubtag !== languageTag) {
            retried = true;
            console.warn('[voice] retrying once with the bare primary language subtag', { event, bookingId, primarySubtag });
            attempt(primarySubtag);
          }
        },
      });
    }
    attempt(requestedLocale);
  });
}
