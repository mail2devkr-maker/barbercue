import * as Speech from 'expo-speech';
import { Language, SPEECH_LOCALE, voiceAnnouncementsFor } from '@barbercue/shared';

// Build 10 physical-device retest (Hindi TTS blocker): Hindi new-booking spoke ENGLISH, and Hindi
// cancellation produced total SILENCE. A prior pass already ruled out a stale "language" race (see
// OwnerBookingsScreen's own preferredLanguageRef comment) — the persisted/selected app language
// really was Hindi when these announcements fired. The remaining cause was structural: this module
// used to call Speech.speak(text, {language: 'hi-IN'}) with no explicit voice id whenever no
// installed voice matched, trusting Android's TextToSpeech to reject an unsupported language tag
// cleanly. It does not do so reliably — depending on the OEM/engine, it can silently keep using
// whichever voice is currently active (typically English) to read the Hindi text, or fail with no
// error callback at all, which is exactly "spoke English" and "silence" respectively.
//
// Hindi mode never calls Speech.speak without first confirming a real, installed Hindi-family
// voice exists. If none does, it skips speaking entirely and surfaces a throttled, actionable
// warning instead of risking either wrong-language or silent output again. English is untouched —
// its own physical retest already passed, so its "attempt with a language tag, retry once with the
// bare subtag on error" behavior is preserved exactly as it was.
//
// Follow-up hardening (still pre-physical-retest): a single matched Hindi voice that itself fails
// to speak (a real possibility — a device can have more than one Hindi-labelled voice, and not
// every one of them is necessarily functional) used to have nowhere left to go but the same voice
// again. Hindi retries now walk an ORDERED LIST of every genuine Hindi-family candidate on the
// device (never English, never a fabricated one), trying the next only on a genuine engine error,
// bounded by the candidate list's own length. And a device that had NO Hindi voice the last time it
// was checked is no longer trusted forever — the very next Hindi announcement after the same
// warning cooldown re-queries the device, so installing a Hindi voice and reopening the app is
// enough to recover without needing anything cleverer (no AppState listener, no polling).

let cachedVoices: Speech.Voice[] | null = null;
let cachedVoicesPromise: Promise<Speech.Voice[]> | null = null;
// Whether the currently-cached list is known to contain at least one Hindi-family voice. Tracked
// separately from `cachedVoices` so a NEGATIVE result can be treated as provisional (see
// maybeRefreshStaleNegativeCache below) while a POSITIVE one stays cached for the whole session —
// per the "don't repeatedly query when Hindi is already available" requirement.
let cachedVoicesHadHindi = false;

/** Test-only: clears the module-level voice cache so each test controls its own mocked voice list. */
export function __resetVoiceCacheForTests(): void {
  cachedVoices = null;
  cachedVoicesPromise = null;
  cachedVoicesHadHindi = false;
}

// Auth-security-branch privacy fix: these diagnostics carry bookingId, the full spoken booking
// text, and voice identifiers — useful while developing/debugging Hindi TTS, but not something
// production logs should ever contain. __DEV__ is the same RN/Expo global already used elsewhere
// in this app (see lib/api.ts) to distinguish a dev build from a production one.
function debugVoiceLog(message: string, meta?: Record<string, unknown>): void {
  if (__DEV__) {
    console.warn(message, meta);
  }
}

function primarySubtagOf(bcp47: string): string {
  return bcp47.split(/[-_]/)[0]?.toLowerCase() ?? '';
}

function isHindiFamily(languageTag: string | undefined, requestedPrimary: string): boolean {
  if (!languageTag) return false;
  return primarySubtagOf(languageTag) === requestedPrimary;
}

// Voices are a device-level property that doesn't change during a session — fetched once and
// reused, rather than re-querying the native module on every single announcement. The one
// exception (see maybeRefreshStaleNegativeCache) is a previously-empty Hindi result, which is
// revalidated after the warning cooldown rather than trusted for the rest of the app's lifetime.
async function getVoices(): Promise<Speech.Voice[]> {
  if (cachedVoices) return cachedVoices;
  if (!cachedVoicesPromise) {
    cachedVoicesPromise = Speech.getAvailableVoicesAsync()
      .then((voices) => {
        cachedVoices = voices;
        cachedVoicesHadHindi = voices.some((v) => isHindiFamily(v.language, 'hi'));
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

// BCP-47-ish matching for ENGLISH only (unchanged from before this follow-up): an exact match on
// the full tag wins; otherwise any installed voice sharing the same primary subtag is accepted.
function findMatchingVoice(voices: Speech.Voice[], requestedLocale: string): Speech.Voice | null {
  const requestedPrimary = primarySubtagOf(requestedLocale);
  const exact = voices.find((v) => v.language?.toLowerCase() === requestedLocale.toLowerCase());
  if (exact) return exact;
  const familyMatch = voices.find((v) => v.language?.split(/[-_]/)[0]?.toLowerCase() === requestedPrimary);
  return familyMatch ?? null;
}

/**
 * Every genuine Hindi-family voice on the device, ordered best-first:
 *   1. exact match on the requested tag (e.g. "hi-IN")
 *   2. the same tag in a different separator form (e.g. "hi_IN")
 *   3. any other hi-* voice (e.g. "hi-Latn", "hi-Deva-IN")
 *   4. the bare primary subtag alone ("hi")
 * Deduplicated by voice identifier. Never includes anything outside the Hindi family — there is no
 * "fall through to English" tier.
 */
function rankedHindiVoiceCandidates(voices: Speech.Voice[], requestedLocale: string): Speech.Voice[] {
  const requestedPrimary = primarySubtagOf(requestedLocale);
  const requestedLower = requestedLocale.toLowerCase();
  const requestedNormalized = requestedLower.replace(/_/g, '-');

  function rankOf(languageTag: string): number {
    const lower = languageTag.toLowerCase();
    if (lower === requestedLower) return 0;
    if (lower.replace(/_/g, '-') === requestedNormalized) return 1;
    if (lower === requestedPrimary) return 3;
    return 2;
  }

  const seen = new Set<string>();
  return voices
    .filter((v) => isHindiFamily(v.language, requestedPrimary))
    .map((v) => ({ voice: v, rank: rankOf(v.language as string) }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.voice)
    .filter((v) => {
      const key = v.identifier || v.language;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// Shared across every call site/announcement for the lifetime of the app — an owner whose device
// genuinely has no Hindi voice installed would otherwise get this warning on every single booking
// event, which is worse than useless. One cooldown, not a per-booking one. The same clock also
// gates when a previously-empty Hindi voice result is treated as stale enough to re-check (see
// maybeRefreshStaleNegativeCache) — both are really the same "when did we last confirm Hindi is
// missing" event, so one timestamp covers both rather than inventing a second schedule.
const HINDI_VOICE_WARNING_THROTTLE_MS = 5 * 60_000;
let lastHindiVoiceMissingAt = 0;

/** Test-only: resets the warning/recheck throttle so each test controls its own timing. */
export function __resetHindiVoiceWarningThrottleForTests(): void {
  lastHindiVoiceMissingAt = 0;
}

function hindiRecheckDue(now: number): boolean {
  return now - lastHindiVoiceMissingAt >= HINDI_VOICE_WARNING_THROTTLE_MS;
}

// UX trap this closes: (1) Hindi voice missing, (2) FastQue warns, (3) owner installs/enables a
// Hindi TTS voice, (4) returns to FastQue, (5) FastQue keeps trusting the stale "no Hindi voice"
// result for the rest of the session. A cached POSITIVE result is never invalidated (no reason
// to — Hindi doesn't get uninstalled mid-session in practice, and this keeps a working device from
// ever re-querying on every booking). A cached NEGATIVE result is dropped once the same cooldown
// used for the warning has elapsed, so the next eligible Hindi announcement re-queries the device.
function maybeRefreshStaleNegativeCache(now: number): void {
  if (cachedVoices !== null && !cachedVoicesHadHindi && hindiRecheckDue(now)) {
    cachedVoices = null;
    cachedVoicesPromise = null;
  }
}

function recordHindiVoiceMissing(now: number, onHindiVoiceMissing: (() => void) | undefined): void {
  if (!hindiRecheckDue(now)) return;
  lastHindiVoiceMissingAt = now;
  onHindiVoiceMissing?.();
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
  /** Throttled callback — fires when `language` is Hindi but no genuine Hindi-family voice could
   * be used, so the caller can surface an actionable, localized warning (e.g. a dismissable
   * banner). Never called for English, and never more than once per HINDI_VOICE_WARNING_THROTTLE_MS. */
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
  const now = Date.now();

  if (isHindi) maybeRefreshStaleNegativeCache(now);

  void getVoices().then((voices) => {
    if (isHindi) {
      const candidates = rankedHindiVoiceCandidates(voices, requestedLocale);

      // The core Hindi-blocker fix: never knowingly speak Hindi with an unmatched (English/
      // default) voice. Skip entirely rather than call Speech.speak and hope.
      if (candidates.length === 0) {
        debugVoiceLog(
          '[voice] Hindi requested but no installed Hindi-family voice found on this device — skipping speech rather than risking an English/default-voice fallback',
          { event, bookingId, requestedLocale, availableVoiceLanguages: voices.map((v) => v.language) },
        );
        recordHindiVoiceMissing(now, onHindiVoiceMissing);
        return;
      }

      debugVoiceLog('[voice] speaking', {
        event,
        bookingId,
        effectiveLanguage: language,
        text,
        requestedLocale,
        hindiCandidateIdentifiers: candidates.map((v) => v.identifier),
      });

      // Walk the ranked candidate list on genuine engine errors — never the same failed voice
      // twice, never anything outside the Hindi family, bounded by the list's own length.
      let candidateIndex = 0;
      function attemptHindiCandidate() {
        const candidate = candidates[candidateIndex];
        Speech.speak(text, {
          language: candidate.language ?? requestedLocale,
          voice: candidate.identifier,
          onStart: () => debugVoiceLog('[voice] onStart', { event, bookingId, voiceIdentifier: candidate.identifier }),
          onDone: () => debugVoiceLog('[voice] onDone', { event, bookingId, voiceIdentifier: candidate.identifier }),
          onStopped: () => debugVoiceLog('[voice] onStopped', { event, bookingId, voiceIdentifier: candidate.identifier }),
          onError: (error) => {
            debugVoiceLog('[voice] onError for a Hindi voice candidate', {
              event,
              bookingId,
              voiceIdentifier: candidate.identifier,
              candidateIndex,
              candidateCount: candidates.length,
              error: String(error),
            });
            candidateIndex += 1;
            if (candidateIndex < candidates.length) {
              debugVoiceLog('[voice] trying the next genuine Hindi voice candidate', {
                event,
                bookingId,
                nextVoiceIdentifier: candidates[candidateIndex].identifier,
              });
              attemptHindiCandidate();
            } else {
              debugVoiceLog('[voice] every Hindi voice candidate failed — stopping speech rather than falling back', {
                event,
                bookingId,
              });
              recordHindiVoiceMissing(now, onHindiVoiceMissing);
            }
          },
        });
      }
      attemptHindiCandidate();
      return;
    }

    // English path — unchanged from before this follow-up. English's own physical retest already
    // passed with exactly this behavior: speak with the requested locale tag (with a matched voice
    // id when one exists), retry once with the bare primary subtag on a genuine engine error.
    const matchedVoice = findMatchingVoice(voices, requestedLocale);
    debugVoiceLog('[voice] speaking', {
      event,
      bookingId,
      effectiveLanguage: language,
      text,
      requestedLocale,
      matchedVoiceIdentifier: matchedVoice?.identifier ?? null,
      matchedVoiceLanguage: matchedVoice?.language ?? null,
    });
    const primarySubtag = requestedLocale.split(/[-_]/)[0];
    let retried = false;
    function attempt(languageTag: string) {
      Speech.speak(text, {
        language: languageTag,
        ...(matchedVoice ? { voice: matchedVoice.identifier } : {}),
        onStart: () => debugVoiceLog('[voice] onStart', { event, bookingId, languageTag }),
        onDone: () => debugVoiceLog('[voice] onDone', { event, bookingId, languageTag }),
        onStopped: () => debugVoiceLog('[voice] onStopped', { event, bookingId, languageTag }),
        onError: (error) => {
          debugVoiceLog('[voice] onError — TTS engine reported a failure', {
            event,
            bookingId,
            languageTag,
            retried,
            error: String(error),
          });
          if (!retried && primarySubtag && primarySubtag !== languageTag) {
            retried = true;
            debugVoiceLog('[voice] retrying once with the bare primary language subtag', { event, bookingId, primarySubtag });
            attempt(primarySubtag);
          }
        },
      });
    }
    attempt(requestedLocale);
  });
}
