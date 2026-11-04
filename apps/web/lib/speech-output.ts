/**
 * Spoken replies for the FastQue Assistant (issue #371), using only the browser's built-in
 * speechSynthesis: no FastQue server, no paid provider.
 *
 * Measured in Chromium 152 on Windows (issue #371 comment) before this module existed:
 *  - getVoices() returns 0 voices at first; the list arrives later via `voiceschanged`.
 *  - A machine may have NO Hindi voice. Devanagari text sent to an English voice "starts" and
 *    "ends" within ~30 ms: silence, reported as success.
 *  - The time from speak() to `start` varied from 80 ms to 4.7 s (cold voice). A timeout counted
 *    from speak() therefore cut replies off or moved on without any sound.
 *
 * So this speaker:
 *  - waits for the voice list, picks an installed voice for the language (or says which one it
 *    falls back to), and never sends Devanagari to a non-Hindi voice;
 *  - reports a reply as PLAYED only after `start` fired, and times the end from `start`;
 *  - reports a clear reason when nothing plays (no voice, blocked, never started, engine error);
 *  - speaks long replies in short chunks (Chrome's network voices stop after ~15 s);
 *  - never cancels an utterance unless something is actually speaking or queued.
 */

export type SpeakFailure = "unsupported" | "no-voice-for-text" | "not-allowed" | "no-start" | "engine-error" | "interrupted";

export interface SpeakResult {
  ok: boolean;
  reason?: SpeakFailure;
  /** The voice actually used (name and language), for the UI. */
  voice?: string;
}

export const SPEAK_FAILURE_TEXT: Record<SpeakFailure, string> = {
  unsupported: "This browser cannot speak replies. Replies are shown on screen.",
  "no-voice-for-text": "No Hindi voice is installed in this browser, so this Hindi reply cannot be spoken. Choose an English voice or install a Hindi voice.",
  "not-allowed": "The browser blocked sound. Tap Test speaker once to allow spoken replies.",
  "no-start": "The reply did not start playing. Check that the tab and the device are not muted, then tap Test speaker.",
  "engine-error": "The browser's voice engine failed to play the reply. Tap Test speaker, or choose another voice.",
  interrupted: "Stopped.",
};

export interface VoiceInfo {
  name: string;
  lang: string;
  local: boolean;
}

interface SynthLike {
  getVoices(): SpeechSynthesisVoice[];
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
  resume(): void;
  speaking: boolean;
  pending: boolean;
  addEventListener?(type: "voiceschanged", fn: () => void): void;
  removeEventListener?(type: "voiceschanged", fn: () => void): void;
  onvoiceschanged?: (() => void) | null;
}

export interface SpeechOutputDeps {
  synth: SynthLike | null;
  makeUtterance: (text: string) => SpeechSynthesisUtterance;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  now?: () => number;
}

export const SPEECH_LIMITS = {
  voicesWaitMs: 2_000,
  startTimeoutMs: 7_000, // cold network voices measured at 4.7 s
  chunkChars: 180,
  endGraceMs: 4_000,
  msPerChar: 110,
  watchEveryMs: 1_000, // after the estimate, re-check whether the engine is still speaking
  maxChunkMs: 60_000, // hard cap per chunk, so a stuck engine never blocks the conversation
} as const;

const DEVANAGARI = /[ऀ-ॿ]/;

export function splitForSpeech(text: string, max: number = SPEECH_LIMITS.chunkChars): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?।]+[.!?।]*\s*/g) ?? [clean];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = "";
    }
    if (s.length > max) {
      for (const w of s.split(" ")) {
        if ((cur + " " + w).length > max && cur) {
          out.push(cur.trim());
          cur = "";
        }
        cur += (cur ? " " : "") + w;
      }
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Best installed voice for a language: exact (hi-IN), then same language (hi-*), else none. */
export function pickVoice(voices: VoiceInfo[], lang: string, preferred?: string | null): VoiceInfo | null {
  if (preferred) {
    const p = voices.find((v) => v.name === preferred);
    if (p) return p;
  }
  const base = lang.split("-")[0].toLowerCase();
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  return (
    voices.find((v) => norm(v.lang) === lang.toLowerCase() && !v.local) ??
    voices.find((v) => norm(v.lang) === lang.toLowerCase()) ??
    voices.find((v) => norm(v.lang).split("-")[0] === base) ??
    null
  );
}

export class SpeechOutput {
  private voices: SpeechSynthesisVoice[] = [];
  private ready: Promise<void>;
  private current: { finish: (r: SpeakResult) => void } | null = null;
  private listeners = new Set<() => void>();
  private preferred: Record<string, string | null> = {};

  private readonly now: () => number;

  constructor(private readonly deps: SpeechOutputDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.ready = this.loadVoices();
  }

  get supported(): boolean {
    return !!this.deps.synth;
  }

  /** Installed voices, Hindi and English only, for the voice picker. */
  list(): VoiceInfo[] {
    return this.voices
      .filter((v) => /^(hi|en)/i.test(v.lang))
      .map((v) => ({ name: v.name, lang: v.lang.replace("_", "-"), local: v.localService }));
  }

  onVoicesChanged(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  private loadVoices(): Promise<void> {
    const synth = this.deps.synth;
    if (!synth) return Promise.resolve();
    return new Promise((resolve) => {
      const take = () => {
        let v: SpeechSynthesisVoice[] = [];
        try {
          v = synth.getVoices() ?? [];
        } catch {
          v = [];
        }
        if (v.length) {
          this.voices = v;
          for (const l of this.listeners) l();
        }
        return v.length > 0;
      };
      const onChange = () => {
        take();
        resolve();
      };
      if (synth.addEventListener) synth.addEventListener("voiceschanged", onChange);
      else synth.onvoiceschanged = onChange;
      if (take()) resolve();
      else this.deps.setTimer(() => resolve(), SPEECH_LIMITS.voicesWaitMs);
    });
  }

  /** The voice the user picked for a language ("hi" or "en"); null means automatic. */
  setPreferred(base: "hi" | "en", name: string | null) {
    this.preferred[base] = name;
  }

  preferredFor(lang: string): string | null {
    return this.preferred[lang.split("-")[0].toLowerCase()] ?? null;
  }

  /** Which voice a reply in `lang` would use (the picked one, else the best installed one). */
  voiceFor(lang: string, preferred?: string | null): VoiceInfo | null {
    return pickVoice(this.list(), lang, preferred ?? this.preferredFor(lang));
  }

  /** Stop whatever is playing. Only touches the engine when something is actually queued. */
  cancel() {
    const c = this.current;
    this.current = null;
    c?.finish({ ok: false, reason: "interrupted" });
    const synth = this.deps.synth;
    if (synth && (synth.speaking || synth.pending)) synth.cancel();
  }

  /**
   * Speak `text`. Resolves exactly once: ok only if audio actually STARTED (and then ended or was
   * still playing when its end-watchdog fired).
   */
  async speak(text: string, lang: string, preferred?: string | null): Promise<SpeakResult> {
    const synth = this.deps.synth;
    if (!synth) return { ok: false, reason: "unsupported" };
    await this.ready;
    this.cancel();
    const voice = this.voiceFor(lang, preferred);
    const spoken = voice && /^hi/i.test(voice.lang) ? text : text.replace(/[ऀ-ॿ][ऀ-ॿ\s]*/g, " ");
    if (DEVANAGARI.test(text) && !spoken.replace(/[^A-Za-z0-9]/g, "")) return { ok: false, reason: "no-voice-for-text", voice: voice?.name };
    const chunks = splitForSpeech(spoken);
    if (!chunks.length) return { ok: true, voice: voice?.name };
    const engineVoice = voice ? this.voices.find((v) => v.name === voice.name) : undefined;
    const label = voice ? `${voice.name} (${voice.lang})` : undefined;
    return new Promise<SpeakResult>((resolve) => {
      let done = false;
      let started = false;
      let timer: unknown = null;
      const finish = (r: SpeakResult) => {
        if (done) return;
        done = true;
        if (timer !== null) this.deps.clearTimer(timer);
        if (this.current?.finish === finish) this.current = null;
        resolve({ ...r, voice: label });
      };
      this.current = { finish };
      const keep: SpeechSynthesisUtterance[] = []; // keep references: Chrome drops events of collected utterances
      const play = (i: number) => {
        if (done) return;
        if (i >= chunks.length) return finish({ ok: true });
        const u = this.deps.makeUtterance(chunks[i]);
        keep.push(u);
        u.lang = engineVoice?.lang ?? lang;
        if (engineVoice) u.voice = engineVoice;
        // Each chunk moves on exactly ONCE, whichever comes first: its `end`, or a watchdog that
        // only fires when the engine has really stopped speaking (a slow voice measured 26 s for
        // 180 characters; moving on early queued the next chunk twice).
        let advanced = false;
        const next = () => {
          if (advanced) return;
          advanced = true;
          if (timer !== null) this.deps.clearTimer(timer);
          timer = null;
          play(i + 1);
        };
        let startedAt = 0;
        const watch = () => {
          timer = this.deps.setTimer(() => {
            if (done || advanced) return;
            const playing = synth.speaking || synth.pending;
            if (playing && this.now() - startedAt < SPEECH_LIMITS.maxChunkMs) watch();
            else next();
          }, SPEECH_LIMITS.watchEveryMs);
        };
        u.onstart = () => {
          started = true;
          startedAt = this.now();
          if (timer !== null) this.deps.clearTimer(timer);
          timer = this.deps.setTimer(watch, SPEECH_LIMITS.endGraceMs + chunks[i].length * SPEECH_LIMITS.msPerChar);
        };
        u.onend = () => {
          if (!started) return finish({ ok: false, reason: "no-start" });
          next();
        };
        u.onerror = (e: SpeechSynthesisErrorEvent) => {
          const code = (e as { error?: string }).error ?? "";
          if (code === "interrupted" || code === "canceled") return finish({ ok: false, reason: "interrupted" });
          finish({ ok: false, reason: code === "not-allowed" ? "not-allowed" : "engine-error" });
        };
        if (!started) {
          if (timer !== null) this.deps.clearTimer(timer);
          timer = this.deps.setTimer(() => finish({ ok: false, reason: "no-start" }), SPEECH_LIMITS.startTimeoutMs);
        }
        try {
          synth.resume(); // Chrome can be left paused after a tab switch
          synth.speak(u);
        } catch {
          finish({ ok: false, reason: "engine-error" });
        }
      };
      play(0);
      void keep;
    });
  }
}

export function browserSpeechOutput(): SpeechOutput {
  const has =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.speechSynthesis?.speak === "function" &&
    typeof window.speechSynthesis?.getVoices === "function" &&
    typeof SpeechSynthesisUtterance !== "undefined";
  return new SpeechOutput({
    synth: has ? (window.speechSynthesis as unknown as SynthLike) : null,
    makeUtterance: (t) => new SpeechSynthesisUtterance(t),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
}
