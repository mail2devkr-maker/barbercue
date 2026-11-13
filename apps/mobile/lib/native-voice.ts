import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type { RecognizerLike } from './voice-conversation';

// Phone adapter for the shared voice engine (lib/voice-conversation.ts, copied from the website).
// It wraps the phone's built-in speech recognizer (expo-speech-recognition: Android SpeechRecognizer,
// iOS SFSpeechRecognizer) in the same shape as the browser's SpeechRecognition, so the website's
// rules run unchanged. Like the website's "browser" voice provider, speech is turned into text by
// the phone's own speech service; FastQue never records or stores the audio.

type Alternative = { transcript: string; confidence?: number };
type ResultList = Array<Alternative[] & { isFinal: boolean }>;
type Module = Pick<typeof ExpoSpeechRecognitionModule, 'start' | 'stop' | 'abort' | 'addListener'>;

/** Languages offered in the Assistant, matching the website's हिंदी / Hinglish and English choices. */
export const VOICE_LANGS = [
  { id: 'hi-IN', label: 'हिंदी / Hinglish' },
  { id: 'en-IN', label: 'English' },
] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number]['id'];

function toAlternatives(results: Array<{ transcript: string; confidence: number }>): Alternative[] {
  return results.map((r) => ({ transcript: r.transcript ?? '', confidence: typeof r.confidence === 'number' && r.confidence >= 0 ? r.confidence : undefined }));
}

/**
 * A RecognizerLike over the native module. The native module reports one utterance at a time; this
 * keeps the finished utterances of the current session so `results` looks like the browser's
 * continuous result list that readResults() expects.
 */
export function createNativeRecognizer(module: Module = ExpoSpeechRecognitionModule): RecognizerLike {
  let finals: ResultList = [];
  let subscriptions: Array<{ remove(): void }> = [];
  const detach = () => { subscriptions.forEach((s) => s.remove()); subscriptions = []; };

  const recognizer: RecognizerLike = {
    lang: 'hi-IN',
    interimResults: true,
    continuous: true,
    maxAlternatives: 5,
    onresult: null,
    onerror: null,
    onend: null,
    onaudiostart: null,
    start() {
      finals = [];
      detach();
      subscriptions = [
        module.addListener('result', (event) => {
          const alternatives = toAlternatives(event.results ?? []);
          const entry = Object.assign(alternatives, { isFinal: Boolean(event.isFinal) });
          const list: ResultList = event.isFinal ? (finals = [...finals, entry]) : [...finals, entry];
          recognizer.onresult?.({ resultIndex: list.length - 1, results: list });
        }),
        module.addListener('error', (event) => recognizer.onerror?.({ error: String(event.error ?? 'unknown') })),
        module.addListener('audiostart', () => recognizer.onaudiostart?.()),
        module.addListener('end', () => { detach(); recognizer.onend?.(); }),
      ];
      try {
        module.start({
          lang: recognizer.lang,
          interimResults: recognizer.interimResults,
          continuous: recognizer.continuous,
          maxAlternatives: recognizer.maxAlternatives,
          addsPunctuation: false,
        });
      } catch {
        detach();
        recognizer.onerror?.({ error: 'service-not-allowed' });
        recognizer.onend?.();
      }
    },
    stop() { try { module.stop(); } catch { /* already stopped */ } },
    abort() { try { module.abort(); } catch { /* already stopped */ } },
  };
  return recognizer;
}

/** Microphone + speech-recognition permission, asked only after the user tapped a voice button. */
export async function ensureVoicePermission(): Promise<boolean> {
  try {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return result.granted === true;
  } catch {
    return false;
  }
}

export function voiceRecognitionAvailable(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}
