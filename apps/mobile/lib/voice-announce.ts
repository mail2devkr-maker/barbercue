import * as Speech from 'expo-speech';
import { Language, SPEECH_LOCALE, voiceAnnouncementsFor } from '@barbercue/shared';

// Build 10 physical-device retest: Hindi new-booking voice spoke English, and Hindi cancellation
// voice produced no sound at all. The pre-existing OwnerBookingsScreen call sites passed only
// `{ language: SPEECH_LOCALE[...] }` to Speech.speak — no `onError` callback, so any native TTS
// engine failure (e.g. Android's TextToSpeech returning LANG_MISSING_DATA/LANG_NOT_SUPPORTED
// because no Hindi voice is installed) failed completely silently, with zero trace in logs. That
// made the two failure modes (wrong language vs. total silence) impossible to tell apart from a
// bug report alone. This module centralizes both booking-voice call sites so both get: (1) full
// diagnostic logging of every value in the chain right before speaking, (2) an explicit
// getAvailableVoicesAsync() check so a missing Hindi voice is a loud, findable log line instead of
// silence, and (3) an explicit installed `voice` identifier when one matches the requested
// language — Android's TextToSpeech is documented to resolve a bare BCP-47 `language` string more
// loosely than an exact installed voice id, so passing the id when we can find one is a real
// reliability improvement, not just diagnostics.

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
// voice whose language shares the same primary subtag (e.g. "hi_IN", "hi-IN-x-..." — Android voice
// language strings aren't always formatted identically to the tag we requested) is accepted, since
// a language-family match still lets the engine actually say something in the right language.
function findMatchingVoice(voices: Speech.Voice[], requestedLocale: string): Speech.Voice | null {
  const requestedPrimary = requestedLocale.split(/[-_]/)[0]?.toLowerCase();
  const exact = voices.find((v) => v.language?.toLowerCase() === requestedLocale.toLowerCase());
  if (exact) return exact;
  const familyMatch = voices.find((v) => v.language?.split(/[-_]/)[0]?.toLowerCase() === requestedPrimary);
  return familyMatch ?? null;
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
}): void;
export function speakBooking(params: { event: 'booking.cancelled'; bookingId: string; language: Language }): void;
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
      }
    | { event: 'booking.cancelled'; bookingId: string; language: Language },
): void {
  const { event, bookingId, language } = params;
  const t = voiceAnnouncementsFor(language);
  const text =
    event === 'booking.created'
      ? t.newBookingReceived(params.serviceName, params.barberName, params.salonName, params.date, params.time)
      : t.bookingCancelled();
  const requestedLocale = SPEECH_LOCALE[language] ?? SPEECH_LOCALE[Language.EN];

  void getVoices().then((voices) => {
    const matchedVoice = findMatchingVoice(voices, requestedLocale);
    if (!matchedVoice && language !== Language.EN) {
      console.warn('[voice] no installed voice matches requested locale — speaking with language tag only', {
        event,
        bookingId,
        requestedLocale,
        availableVoiceLanguages: voices.map((v) => v.language),
      });
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

    // Still unresolved without a physical-device retest of this exact build (see this file's own
    // header comment) — two real device symptoms were previously observed: total silence, and the
    // announcement speaking in English despite a Hindi `text`/`requestedLocale`. Neither is
    // reproducible in this environment (no device/simulator access), so this is a reasoned
    // hardening of the failure path, not a claimed fix. Android's TextToSpeech is documented to be
    // inconsistent about resolving a full region-qualified tag ("hi-IN") when a voice is only
    // registered under the bare primary subtag ("hi") — a real, general Android TTS quirk, not a
    // guess specific to this bug. If the primary attempt errors out AND no exact/family voice was
    // matched, retry exactly once with the bare primary subtag before giving up, so a
    // region-tag-only mismatch doesn't present as silence when a plain-language attempt might work.
    const primarySubtag = requestedLocale.split(/[-_]/)[0];
    let retried = false;
    function attempt(languageTag: string, voiceIdentifier: string | undefined) {
      Speech.speak(text, {
        language: languageTag,
        ...(voiceIdentifier ? { voice: voiceIdentifier } : {}),
        onStart: () => console.warn('[voice] onStart', { event, bookingId, languageTag }),
        onDone: () => console.warn('[voice] onDone', { event, bookingId, languageTag }),
        onStopped: () => console.warn('[voice] onStopped', { event, bookingId, languageTag }),
        onError: (error) => {
          console.warn('[voice] onError — TTS engine reported a failure', { event, bookingId, languageTag, retried, error: String(error) });
          if (!retried && !matchedVoice && primarySubtag && primarySubtag !== languageTag) {
            retried = true;
            console.warn('[voice] retrying once with the bare primary language subtag', { event, bookingId, primarySubtag });
            attempt(primarySubtag, undefined);
          }
        },
      });
    }
    attempt(requestedLocale, matchedVoice?.identifier);
  });
}
