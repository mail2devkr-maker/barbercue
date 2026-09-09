import * as Speech from 'expo-speech';
import { Language, SPEECH_LOCALE, voiceAnnouncementsFor } from '@barbercue/shared';

/**
 * Android-specific speech implementation for Expo SDK 57.
 *
 * Expo SDK 57's Android SpeechModule parses options.language with Java's single-argument
 * `Locale(String)` constructor. That constructor does NOT parse BCP-47 tags such as `hi-IN`;
 * it treats the whole string as the language code. Expo then calls isLanguageAvailable() and,
 * when that malformed locale is rejected, silently substitutes Locale.getDefault() before it
 * applies the requested voice id. On devices whose default language is English this can produce
 * exactly the owner-reported failure: Hindi text spoken incorrectly or no audible speech.
 *
 * Metro resolves this `.android.ts` file for Android imports of `./voice-announce`, leaving the
 * existing iOS/web implementation untouched. We still select a real installed Hindi-family voice
 * by identifier, but we pass the bare primary subtag (`hi`) to Expo's Android native layer so
 * Java Locale(String) receives a valid language code. The selected voice retains the India/
 * engine-specific voice identity.
 */

let cachedVoices: Speech.Voice[] | null = null;
let cachedVoicesPromise: Promise<Speech.Voice[]> | null = null;
let cachedVoicesHadHindi = false;

const HINDI_VOICE_WARNING_THROTTLE_MS = 5 * 60_000;
const HINDI_START_WATCHDOG_MS = 8_000;
let lastHindiVoiceMissingAt = 0;

export function __resetVoiceCacheForTests(): void {
  cachedVoices = null;
  cachedVoicesPromise = null;
  cachedVoicesHadHindi = false;
}

export function __resetHindiVoiceWarningThrottleForTests(): void {
  lastHindiVoiceMissingAt = 0;
}

function debugVoiceLog(message: string, meta?: Record<string, unknown>): void {
  if (__DEV__) console.warn(message, meta);
}

function primarySubtagOf(bcp47: string): string {
  return bcp47.split(/[-_]/)[0]?.toLowerCase() ?? '';
}

function isHindiFamily(languageTag: string | undefined): boolean {
  return Boolean(languageTag && primarySubtagOf(languageTag) === 'hi');
}

/** Exported for deterministic regression tests of the SDK-57 Android workaround. */
export function androidSpeechLanguageFor(languageTag: string | undefined, requestedLocale: string): string {
  return primarySubtagOf(languageTag ?? requestedLocale) || primarySubtagOf(requestedLocale) || 'hi';
}

async function getVoices(): Promise<Speech.Voice[]> {
  if (cachedVoices) return cachedVoices;
  if (!cachedVoicesPromise) {
    cachedVoicesPromise = Speech.getAvailableVoicesAsync()
      .then((voices) => {
        cachedVoices = voices;
        cachedVoicesHadHindi = voices.some((voice) => isHindiFamily(voice.language));
        return voices;
      })
      .catch((error: unknown) => {
        debugVoiceLog('[voice] Android getAvailableVoicesAsync failed', { error: String(error) });
        cachedVoicesPromise = null;
        return [];
      });
  }
  return cachedVoicesPromise;
}

function findMatchingVoice(voices: Speech.Voice[], requestedLocale: string): Speech.Voice | null {
  const requestedLower = requestedLocale.toLowerCase();
  const requestedPrimary = primarySubtagOf(requestedLocale);
  const exact = voices.find((voice) => voice.language?.toLowerCase() === requestedLower);
  if (exact) return exact;
  return voices.find((voice) => primarySubtagOf(voice.language ?? '') === requestedPrimary) ?? null;
}

function rankedHindiVoiceCandidates(voices: Speech.Voice[], requestedLocale: string): Speech.Voice[] {
  const requestedLower = requestedLocale.toLowerCase();
  const requestedNormalized = requestedLower.replace(/_/g, '-');

  function rankOf(languageTag: string): number {
    const lower = languageTag.toLowerCase();
    if (lower === requestedLower) return 0;
    if (lower.replace(/_/g, '-') === requestedNormalized) return 1;
    if (lower === 'hi') return 3;
    return 2;
  }

  const seen = new Set<string>();
  return voices
    .filter((voice) => isHindiFamily(voice.language))
    .map((voice) => ({ voice, rank: rankOf(voice.language as string) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ voice }) => voice)
    .filter((voice) => {
      const key = voice.identifier || voice.language;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function hindiRecheckDue(now: number): boolean {
  return now - lastHindiVoiceMissingAt >= HINDI_VOICE_WARNING_THROTTLE_MS;
}

function maybeRefreshStaleNegativeCache(now: number): void {
  if (cachedVoices !== null && !cachedVoicesHadHindi && hindiRecheckDue(now)) {
    cachedVoices = null;
    cachedVoicesPromise = null;
  }
}

function recordHindiVoiceMissing(now: number, callback: (() => void) | undefined): void {
  if (!hindiRecheckDue(now)) return;
  lastHindiVoiceMissingAt = now;
  callback?.();
}

function speakHindi(params: {
  text: string;
  event: string;
  bookingId: string;
  requestedLocale: string;
  onHindiVoiceMissing?: () => void;
}): void {
  const { text, event, bookingId, requestedLocale, onHindiVoiceMissing } = params;
  const now = Date.now();
  maybeRefreshStaleNegativeCache(now);

  void getVoices().then((voices) => {
    const candidates = rankedHindiVoiceCandidates(voices, requestedLocale);
    if (candidates.length === 0) {
      debugVoiceLog('[voice] Hindi requested but no installed Hindi-family voice found on Android', {
        event,
        bookingId,
        requestedLocale,
        availableVoiceLanguages: voices.map((voice) => voice.language),
      });
      recordHindiVoiceMissing(now, onHindiVoiceMissing);
      return;
    }

    let candidateIndex = 0;
    function attemptCandidate(): void {
      const candidate = candidates[candidateIndex];
      const engineLanguage = androidSpeechLanguageFor(candidate.language, requestedLocale);
      let callbackObserved = false;

      // Some Android TTS engines have been observed to return from the native speak call without
      // any start/done/error callback. Do not silently leave the owner believing Hindi speech is
      // healthy: after a generous timeout surface the same actionable warning. The watchdog does
      // not start a second voice (avoids double-speaking if an unusually slow engine starts late).
      const watchdog = setTimeout(() => {
        if (callbackObserved) return;
        debugVoiceLog('[voice] Hindi speech produced no native callback before watchdog timeout', {
          event,
          bookingId,
          voiceIdentifier: candidate.identifier,
          requestedLocale,
          engineLanguage,
        });
        recordHindiVoiceMissing(Date.now(), onHindiVoiceMissing);
      }, HINDI_START_WATCHDOG_MS);

      function observedCallback(): void {
        callbackObserved = true;
        clearTimeout(watchdog);
      }

      debugVoiceLog('[voice] Android Hindi speak attempt', {
        event,
        bookingId,
        voiceIdentifier: candidate.identifier,
        voiceLanguage: candidate.language,
        requestedLocale,
        engineLanguage,
      });

      Speech.speak(text, {
        // Critical SDK-57 workaround: bare `hi`, not `hi-IN`. The explicit voice id below retains
        // the concrete installed Hindi voice while avoiding Locale("hi-IN") in Expo Android.
        language: engineLanguage,
        voice: candidate.identifier,
        onStart: () => {
          observedCallback();
          debugVoiceLog('[voice] Android Hindi onStart', { event, bookingId, voiceIdentifier: candidate.identifier });
        },
        onDone: () => {
          observedCallback();
          debugVoiceLog('[voice] Android Hindi onDone', { event, bookingId, voiceIdentifier: candidate.identifier });
        },
        onStopped: () => {
          observedCallback();
          debugVoiceLog('[voice] Android Hindi onStopped', { event, bookingId, voiceIdentifier: candidate.identifier });
        },
        onError: (error) => {
          observedCallback();
          debugVoiceLog('[voice] Android Hindi voice candidate failed', {
            event,
            bookingId,
            voiceIdentifier: candidate.identifier,
            error: String(error),
          });
          candidateIndex += 1;
          if (candidateIndex < candidates.length) {
            attemptCandidate();
          } else {
            recordHindiVoiceMissing(Date.now(), onHindiVoiceMissing);
          }
        },
      });
    }

    attemptCandidate();
  });
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
  onHindiVoiceMissing?: () => void;
}): void;
export function speakBooking(params: {
  event: 'booking.rescheduled';
  bookingId: string;
  language: Language;
  date: string | null;
  time: string | null;
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
    | {
        event: 'booking.rescheduled';
        bookingId: string;
        language: Language;
        date: string | null;
        time: string | null;
        onHindiVoiceMissing?: () => void;
      }
    | {
        event: 'booking.cancelled';
        bookingId: string;
        language: Language;
        onHindiVoiceMissing?: () => void;
      },
): void {
  const t = voiceAnnouncementsFor(params.language);
  const text =
    params.event === 'booking.created'
      ? t.newBookingReceived(params.serviceName, params.barberName, params.salonName, params.date, params.time)
      : params.event === 'booking.rescheduled'
        ? t.bookingRescheduled(params.date, params.time)
        : t.bookingCancelled();
  const requestedLocale = SPEECH_LOCALE[params.language] ?? SPEECH_LOCALE[Language.EN];

  if (params.language === Language.HI) {
    speakHindi({
      text,
      event: params.event,
      bookingId: params.bookingId,
      requestedLocale,
      onHindiVoiceMissing: params.onHindiVoiceMissing,
    });
    return;
  }

  // Preserve the previously physically-passing English behavior on Android.
  void getVoices().then((voices) => {
    const matchedVoice = findMatchingVoice(voices, requestedLocale);
    const primarySubtag = primarySubtagOf(requestedLocale);
    let retried = false;

    function attempt(languageTag: string): void {
      Speech.speak(text, {
        language: languageTag,
        ...(matchedVoice ? { voice: matchedVoice.identifier } : {}),
        onStart: () => debugVoiceLog('[voice] Android English onStart', { event: params.event, bookingId: params.bookingId }),
        onDone: () => debugVoiceLog('[voice] Android English onDone', { event: params.event, bookingId: params.bookingId }),
        onStopped: () => debugVoiceLog('[voice] Android English onStopped', { event: params.event, bookingId: params.bookingId }),
        onError: (error) => {
          debugVoiceLog('[voice] Android English onError', {
            event: params.event,
            bookingId: params.bookingId,
            languageTag,
            error: String(error),
          });
          if (!retried && primarySubtag && primarySubtag !== languageTag) {
            retried = true;
            attempt(primarySubtag);
          }
        },
      });
    }

    attempt(requestedLocale);
  });
}
