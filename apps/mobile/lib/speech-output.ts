import * as Speech from 'expo-speech';

// Spoken replies for the FastQue Assistant on the phone. Same contract as apps/web/lib/speech-output.ts
// (keep the types and reasons in step): a reply counts as PLAYED only when the phone's own
// text-to-speech engine reports that it finished, and a clear reason is given when nothing plays.
// Uses only the device's built-in voice (expo-speech) — no FastQue server and no paid provider.

export type SpeakFailure = 'unsupported' | 'no-voice-for-text' | 'not-allowed' | 'no-start' | 'engine-error' | 'interrupted';

export interface SpeakResult {
  ok: boolean;
  reason?: SpeakFailure;
  /** The voice actually used (name and language), for the UI. */
  voice?: string;
}

export const SPEAK_FAILURE_TEXT: Record<SpeakFailure, string> = {
  unsupported: 'This phone cannot speak replies. Replies are shown on screen.',
  'no-voice-for-text': 'No Hindi voice is installed on this phone, so this Hindi reply cannot be spoken. Install a Hindi voice in the phone’s text-to-speech settings, or choose English.',
  'not-allowed': 'The phone blocked sound. Check the volume, then tap Test speaker.',
  'no-start': 'The reply did not start playing. Check that the phone is not muted, then tap Test speaker.',
  'engine-error': 'The phone’s voice engine failed to play the reply. Tap Test speaker, or choose another language.',
  interrupted: 'Stopped.',
};

/** Devanagari needs a Hindi voice; anything else is spoken with the chosen language. */
export function speechLanguageFor(text: string, lang: string): string {
  return /[ऀ-ॿ]/.test(text) ? 'hi-IN' : lang;
}

/** A start must happen within this time; long replies may then play for as long as they need. */
const START_TIMEOUT_MS = 8_000;
/** A single reply never keeps the conversation waiting longer than this. */
const MAX_REPLY_MS = 120_000;

export interface NativeSpeaker {
  speak(text: string, lang: string): Promise<SpeakResult>;
  cancel(): void;
}

export function createNativeSpeaker(engine: Pick<typeof Speech, 'speak' | 'stop'> = Speech): NativeSpeaker {
  let current: ((result: SpeakResult) => void) | null = null;
  return {
    speak(text, lang) {
      const clean = text.trim();
      if (!clean) return Promise.resolve({ ok: true });
      const language = speechLanguageFor(clean, lang);
      return new Promise<SpeakResult>((resolve) => {
        let settled = false;
        let started = false;
        const finish = (result: SpeakResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(startTimer);
          clearTimeout(maxTimer);
          if (current === finish) current = null;
          resolve(result);
        };
        current = finish;
        // Android does not always report onStart; onDone then still counts as played.
        const startTimer = setTimeout(() => { if (!started) { void engine.stop(); finish({ ok: false, reason: 'no-start' }); } }, START_TIMEOUT_MS);
        const maxTimer = setTimeout(() => { void engine.stop(); finish({ ok: true, voice: language }); }, MAX_REPLY_MS);
        try {
          engine.speak(clean, {
            language,
            onStart: () => { started = true; clearTimeout(startTimer); },
            onDone: () => finish({ ok: true, voice: language }),
            onStopped: () => finish({ ok: false, reason: 'interrupted' }),
            onError: () => finish({ ok: false, reason: language.startsWith('hi') ? 'no-voice-for-text' : 'engine-error' }),
          });
        } catch {
          finish({ ok: false, reason: 'unsupported' });
        }
      });
    },
    cancel() {
      const pending = current;
      current = null;
      void engine.stop();
      pending?.({ ok: false, reason: 'interrupted' });
    },
  };
}
