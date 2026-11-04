/**
 * Hands-free voice conversation for the FastQue Assistant (issue #368).
 *
 *   off ──start()──▶ listening ──final words──▶ understanding ──reply──▶ replying ──spoken──▶ listening …
 *                      │  ▲                          │                       │
 *                      │  └──── muted / no TTS ──────┘ (skips replying)      │ interrupt(): stop speaking, listen now
 *                      ├── silence / idle limit ──▶ paused ──resume()──▶ listening
 *                      ├── tab hidden ────────────▶ paused (mic released)
 *                      ├── mic denied / no mic ───▶ error (mic released, conversation over)
 *                      └── end() from ANY state ──▶ off (mic, request and speech all cancelled)
 *
 * Rules that keep it safe:
 *  - The microphone is only ever opened after the user pressed Start (consent is checked by the UI).
 *  - The microphone is CLOSED while a reply is spoken, so the reply cannot be heard as a new question
 *    (no echo loop). Barge-in by voice is therefore not offered; interrupt() is a button.
 *  - One request at a time. Every async callback carries a generation number; anything from an older
 *    generation (a late recognizer result, a reply that arrives after Stop) is ignored.
 *  - A final phrase is sent once: duplicates within a short window are dropped.
 *  - Writes are never confirmed by voice: a reply that needs confirmation pauses the conversation
 *    so the user decides on screen.
 *  - Browser recognizers stop on their own (Chrome ends a session after silence or ~60 s); the loop
 *    restarts them, but gives up into `paused` after repeated silence, an idle limit, or a restart
 *    storm, so a microphone is never left running unseen.
 */

export type VoiceState = "off" | "listening" | "understanding" | "replying" | "paused" | "error";

export interface VoiceSnapshot {
  state: VoiceState;
  interim: string;
  /** Why the conversation is paused or stopped, in plain words. */
  note: string | null;
  muted: boolean;
}

export interface RecognizerLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { resultIndex?: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export interface SpeakerLike {
  /** Speak; call onDone exactly once when finished, failed or cancelled. Return false if it cannot speak. */
  speak(text: string, lang: string, onDone: () => void): boolean;
  cancel(): void;
}

export interface TurnOutcome {
  /** What to say back. */
  say: string;
  /** True when the user must decide on screen (a confirmation): the conversation pauses. */
  hold?: boolean;
  /** True when the assistant is no longer available for this user: the conversation ends. */
  end?: boolean;
}

export interface VoiceDeps {
  createRecognizer: () => RecognizerLike | null;
  speaker: SpeakerLike | null;
  send: (text: string) => Promise<TurnOutcome>;
  /** Called with each final phrase before it is sent (the UI shows it as a transcript). */
  onHeard?: (text: string) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  now: () => number;
}

export const VOICE_LIMITS = {
  silentRestarts: 3, // recognizer sessions in a row that heard nothing -> pause
  idleMs: 90_000, // no phrase for this long -> pause
  restartBurst: 8, // more restarts than this within restartWindowMs -> pause (broken recognizer)
  restartWindowMs: 20_000,
  restartDelayMs: 250,
  afterSpeechDelayMs: 450, // let the speaker go quiet before the mic opens again
  duplicateWindowMs: 2_000,
} as const;

const FATAL: Record<string, string> = {
  "not-allowed": "Microphone permission is off for this site. Allow it in the browser to talk, or type instead.",
  "service-not-allowed": "This browser does not allow speech recognition here. Type instead.",
  "audio-capture": "No microphone was found. You can type instead.",
  "language-not-supported": "This browser cannot recognize the chosen language. Switch language or type.",
};

export class VoiceConversation {
  private snap: VoiceSnapshot = { state: "off", interim: "", note: null, muted: false };
  private listeners = new Set<(s: VoiceSnapshot) => void>();
  private gen = 0;
  private rec: RecognizerLike | null = null;
  private heardThisSession = false;
  private silentSessions = 0;
  private lastPhraseAt = 0;
  private restarts: number[] = [];
  private lastFinal = { text: "", at: 0 };
  private timer: unknown = null;
  private lang = "hi-IN";
  private sendFn: VoiceDeps["send"];

  constructor(private readonly deps: VoiceDeps) {
    this.sendFn = deps.send;
  }

  /** Point the conversation at the latest turn runner (the UI calls this after each render). */
  setSend(send: VoiceDeps["send"]) {
    this.sendFn = send;
  }

  get snapshot(): VoiceSnapshot {
    return this.snap;
  }

  subscribe(fn: (s: VoiceSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setLang(lang: string) {
    this.lang = lang;
  }

  /** User pressed Start (after consent). */
  start(lang = this.lang) {
    this.lang = lang;
    this.silentSessions = 0;
    this.restarts = [];
    this.lastPhraseAt = this.deps.now();
    this.listen();
  }

  /** User pressed Resume after a pause. */
  resume() {
    if (this.snap.state === "paused" || this.snap.state === "error") this.start();
  }

  /** Stop speaking the current reply and listen right away. */
  interrupt() {
    if (this.snap.state !== "replying") return;
    this.deps.speaker?.cancel();
    this.listen();
  }

  setMuted(muted: boolean) {
    this.set({ muted });
    if (muted && this.snap.state === "replying") this.interrupt();
  }

  /** Pause without ending (tab hidden, focus moved to a confirmation...). Releases the mic. */
  pause(note: string) {
    if (this.snap.state === "off" || this.snap.state === "error") return;
    this.release();
    this.set({ state: "paused", interim: "", note });
  }

  /** End the conversation from any state. Safe to call repeatedly, and on unmount. */
  end(note: string | null = null) {
    this.release();
    this.set({ state: "off", interim: "", note });
  }

  // ---------------------------------------------------------------- internals

  private set(patch: Partial<VoiceSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l(this.snap);
  }

  /** Invalidate every pending callback and free the microphone and the speaker. */
  private release() {
    this.gen += 1;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    const r = this.rec;
    this.rec = null;
    if (r) {
      r.onresult = r.onerror = r.onend = null;
      try {
        r.abort();
      } catch {
        /* already stopped */
      }
    }
    this.deps.speaker?.cancel();
  }

  private later(fn: () => void, ms: number) {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    const g = this.gen;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      if (g === this.gen) fn();
    }, ms);
  }

  private listen() {
    this.release();
    const g = this.gen;
    const r = this.deps.createRecognizer();
    if (!r) {
      this.set({ state: "error", interim: "", note: "Voice input is not available in this browser. You can type instead." });
      return;
    }
    r.lang = this.lang;
    r.interimResults = true;
    r.continuous = false; // one phrase per session: the reply is spoken with the mic closed
    r.maxAlternatives = 1;
    this.heardThisSession = false;
    r.onresult = (event) => {
      if (g !== this.gen) return;
      let text = "";
      let final = false;
      for (let i = 0; i < event.results.length; i += 1) {
        text += event.results[i][0].transcript;
        final = final || event.results[i].isFinal;
      }
      if (!final) {
        this.set({ interim: text });
        return;
      }
      this.phrase(text.trim());
    };
    r.onerror = (event) => {
      if (g !== this.gen) return;
      const fatal = FATAL[event.error];
      if (fatal) {
        this.release();
        this.set({ state: "error", interim: "", note: fatal });
      } else if (event.error === "network") {
        this.release();
        this.set({ state: "paused", interim: "", note: "Voice needs an internet connection in this browser. Press Resume to try again, or type." });
      }
      // "no-speech" and "aborted" end the session; onend decides what happens next.
    };
    r.onend = () => {
      if (g !== this.gen || this.snap.state !== "listening") return;
      this.rec = null;
      if (!this.heardThisSession) this.silentSessions += 1;
      const now = this.deps.now();
      this.restarts = [...this.restarts.filter((t) => now - t < VOICE_LIMITS.restartWindowMs), now];
      if (this.silentSessions >= VOICE_LIMITS.silentRestarts || now - this.lastPhraseAt >= VOICE_LIMITS.idleMs) {
        this.set({ state: "paused", interim: "", note: "Paused because it was quiet. Press Resume to continue." });
        return;
      }
      if (this.restarts.length > VOICE_LIMITS.restartBurst) {
        this.set({ state: "paused", interim: "", note: "Voice kept stopping in this browser. Press Resume, or type instead." });
        return;
      }
      this.later(() => this.listen(), VOICE_LIMITS.restartDelayMs);
    };
    this.rec = r;
    this.set({ state: "listening", interim: "", note: null });
    try {
      r.start();
    } catch {
      this.release();
      this.set({ state: "error", note: "The microphone could not start. Press Resume or type instead." });
    }
  }

  private phrase(text: string) {
    if (!text) return;
    const now = this.deps.now();
    if (text === this.lastFinal.text && now - this.lastFinal.at < VOICE_LIMITS.duplicateWindowMs) return;
    this.lastFinal = { text, at: now };
    this.heardThisSession = true;
    this.silentSessions = 0;
    this.lastPhraseAt = now;
    // Close the mic before anything is sent or spoken.
    this.release();
    const turn = this.gen;
    this.set({ state: "understanding", interim: "", note: null });
    this.deps.onHeard?.(text);
    this
      .sendFn(text)
      .catch(() => ({ say: "Could not reach FastQue. Nothing was changed." }) as TurnOutcome)
      .then((out) => {
        if (turn !== this.gen) return; // stopped, paused or restarted meanwhile
        if (out.end) {
          this.end("The assistant is not available for this account.");
          return;
        }
        this.reply(out);
      });
  }

  private reply(out: TurnOutcome) {
    const next = () =>
      out.hold
        ? this.pause("Waiting for your decision on screen. Press Resume to keep talking.")
        : this.later(() => this.listen(), VOICE_LIMITS.afterSpeechDelayMs);
    if (this.snap.muted || !this.deps.speaker || !out.say) {
      next();
      return;
    }
    const g = this.gen;
    this.set({ state: "replying" });
    let done = false;
    const finished = () => {
      if (done || g !== this.gen) return;
      done = true;
      next();
    };
    // Some browsers never fire `end` (autoplay rules, a missing voice): a watchdog moves on.
    this.later(finished, Math.min(30_000, 4_000 + out.say.length * 90));
    const ok = this.deps.speaker.speak(out.say, this.lang, finished);
    if (!ok) finished();
  }
}

// ---------------------------------------------------------------- browser adapters

type Ctor = new () => RecognizerLike;

export function recognizerCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * What this browser can do:
 *   hands-free  recognition + speech output, and the platform restarts recognition without a tap
 *   no-speech   recognition only: hands-free works, replies are shown but not spoken
 *   push-to-talk iOS/iPadOS Safari (and in-app web views): recognition needs a tap for every phrase
 *   none        no recognition at all (Firefox): type, or use the private FastQue voice if offered
 */
export type VoiceSupport = "hands-free" | "no-speech" | "push-to-talk" | "none";

export function voiceSupport(): VoiceSupport {
  if (typeof window === "undefined" || !recognizerCtor()) return "none";
  const ua = window.navigator?.userAgent ?? "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && (window.navigator?.maxTouchPoints ?? 0) > 1);
  if (ios) return "push-to-talk";
  return "speechSynthesis" in window ? "hands-free" : "no-speech";
}

export const browserSpeaker: SpeakerLike = {
  speak(text, lang, onDone) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.onend = () => onDone();
      u.onerror = () => onDone();
      window.speechSynthesis.speak(u);
      return true;
    } catch {
      return false;
    }
  },
  cancel() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  },
};
