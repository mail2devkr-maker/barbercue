// Keep in step with apps/web/lib/voice-conversation.ts (lines up to the browser adapters).
// Copied verbatim so the phone follows the exact same safety rules as the website: the mic is
// closed while a reply is spoken, one request at a time, and writes are never confirmed by voice.
// Only the recognizer and speaker adapters differ (lib/native-voice.ts).

/**
 * Hands-free voice conversation for the FastQue Assistant (issues #368, #371).
 *
 *   off ──start()──▶ listening ──phrase complete──▶ understanding ──reply──▶ replying ──played──▶ listening …
 *                      │  ▲                              │                      │
 *                      │  └──── muted / no speaker ──────┘ (skips replying)     │ interrupt(): stop speaking, listen now
 *                      ├── silence / idle limit ──▶ paused ──resume()──▶ listening
 *                      ├── tab hidden ────────────▶ paused (mic released)
 *                      ├── mic denied / no mic ───▶ error (mic released, conversation over)
 *                      └── end() from ANY state ──▶ off (mic, request and speech all cancelled)
 *
 * Rules that keep it safe (unchanged from #368):
 *  - The microphone is only opened after the user pressed Start (consent is checked by the UI).
 *  - The microphone is CLOSED while a reply is spoken, so the reply cannot be heard as a question.
 *  - One request at a time; every async callback carries a generation number and stale ones are dropped.
 *  - A final phrase is sent once. Writes are never confirmed by voice.
 *  - Browser recognizers stop on their own; the loop restarts them but pauses after repeated silence,
 *    an idle limit, or a restart storm, so a microphone is never left running unseen.
 *
 * First-attempt accuracy (#371):
 *  - The recognizer runs in continuous mode and THIS class decides when a phrase is complete
 *    (a short silence after the last words), so a pause mid-sentence ("bookings ... kholo") no longer
 *    sends half a sentence. The mic is still closed before anything is sent or spoken.
 *  - Up to 5 recognition alternatives are passed to the server, which may use one ONLY for a safe
 *    read or navigation (never a change).
 *  - `ready` turns true only when the browser reports that audio capture started, so the UI says
 *    "Speak now" at the right moment instead of clipping the first words.
 *
 * Spoken replies (#371): the speaker resolves with ok only when audio actually started; a failure
 * is shown (`speechError`) instead of silently moving on, and the mic reopens only after the reply.
 */

import type { SpeakResult } from "./speech-output";
import { SPEAK_FAILURE_TEXT } from "./speech-output";

export type VoiceState = "off" | "listening" | "understanding" | "replying" | "paused" | "error";

export interface VoiceSnapshot {
  state: VoiceState;
  interim: string;
  /** Why the conversation is paused or stopped, in plain words. */
  note: string | null;
  muted: boolean;
  /** The browser reported that the microphone is capturing audio (say "Speak now"). */
  ready: boolean;
  /** The last reply could not be played, and why. Cleared when a reply plays. */
  speechError: string | null;
  /** Milliseconds from start() to audio capture for the last session (diagnostics only). */
  micStartMs: number | null;
}

type Alternative = { transcript: string; confidence?: number };
export interface RecognizerLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { resultIndex?: number; results: ArrayLike<ArrayLike<Alternative> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onaudiostart?: (() => void) | null;
}

export interface SpeakerLike {
  /** Resolves once: ok only if audio actually started playing. */
  speak(text: string, lang: string): Promise<SpeakResult>;
  cancel(): void;
}

export interface Heard {
  text: string;
  /** Other hypotheses from the recognizer, best first, without the top one. */
  alternatives: string[];
  /** The recognizer's confidence in `text` (0..1) when it reports one. */
  confidence: number | null;
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
  send: (heard: Heard) => Promise<TurnOutcome>;
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
  endOfPhraseMs: 900, // silence after the last final words that completes a phrase
  maxAlternatives: 5,
  networkRetries: 2, // a dropped connection reconnects this many times on its own before pausing
  networkRetryMs: 1_500, // first reconnect delay; doubles each retry
} as const;

const FATAL: Record<string, string> = {
  "not-allowed": "Microphone permission is off for this site. Allow it in the browser to talk, or type instead.",
  "service-not-allowed": "This browser does not allow speech recognition here. Type instead.",
  "audio-capture": "No microphone was found, or it was disconnected. You can type instead.",
  "language-not-supported": "This browser cannot recognize the chosen language. Switch language or type.",
};

/** The phrase and its alternatives from a (continuous) result list. */
export function readResults(results: ArrayLike<ArrayLike<Alternative> & { isFinal: boolean }>): {
  final: Heard | null;
  interim: string;
} {
  const finals: Array<ArrayLike<Alternative>> = [];
  let interim = "";
  for (let i = 0; i < results.length; i += 1) {
    if (results[i].isFinal) finals.push(results[i]);
    else interim += results[i][0]?.transcript ?? "";
  }
  if (!finals.length) return { final: null, interim: interim.trim() };
  const tops = finals.map((r) => (r[0]?.transcript ?? "").trim());
  const text = tops.join(" ").replace(/\s+/g, " ").trim();
  const last = finals[finals.length - 1];
  const prefix = tops.slice(0, -1).join(" ");
  const alternatives: string[] = [];
  for (let k = 1; k < last.length; k += 1) {
    const alt = `${prefix} ${(last[k]?.transcript ?? "").trim()}`.replace(/\s+/g, " ").trim();
    if (alt && alt !== text && !alternatives.includes(alt)) alternatives.push(alt);
  }
  const c = last[0]?.confidence;
  return {
    final: text ? { text, alternatives: alternatives.slice(0, 4), confidence: typeof c === "number" && c > 0 ? c : null } : null,
    interim: interim.trim(),
  };
}

export class VoiceConversation {
  private snap: VoiceSnapshot = { state: "off", interim: "", note: null, muted: false, ready: false, speechError: null, micStartMs: null };
  private listeners = new Set<(s: VoiceSnapshot) => void>();
  private gen = 0;
  private rec: RecognizerLike | null = null;
  private heardThisSession = false;
  private silentSessions = 0;
  private lastPhraseAt = 0;
  private restarts: number[] = [];
  private networkRetries = 0;
  private lastFinal = { text: "", at: 0 };
  private timer: unknown = null;
  private phraseTimer: unknown = null;
  private pending: Heard | null = null;
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

  /** Change the recognition language; a listening session restarts in the new language. */
  setLang(lang: string) {
    if (lang === this.lang) return;
    this.lang = lang;
    if (this.snap.state === "listening") this.listen();
  }

  /** User pressed Start (after consent). */
  start(lang = this.lang) {
    this.lang = lang;
    this.silentSessions = 0;
    this.restarts = [];
    this.networkRetries = 0;
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
    this.set({ state: "paused", interim: "", note, ready: false });
  }

  /** End the conversation from any state. Safe to call repeatedly, and on unmount. */
  end(note: string | null = null) {
    this.release();
    this.set({ state: "off", interim: "", note, ready: false });
  }

  // ---------------------------------------------------------------- internals

  private set(patch: Partial<VoiceSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l(this.snap);
  }

  /** Invalidate every pending callback and free the microphone and the speaker. */
  private release() {
    this.gen += 1;
    for (const t of [this.timer, this.phraseTimer]) if (t !== null) this.deps.clearTimer(t);
    this.timer = this.phraseTimer = null;
    this.pending = null;
    const r = this.rec;
    this.rec = null;
    if (r) {
      r.onresult = r.onerror = r.onend = null;
      r.onaudiostart = null;
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
      this.set({ state: "error", interim: "", ready: false, note: "Voice input is not available in this browser. You can type instead." });
      return;
    }
    r.lang = this.lang;
    r.interimResults = true;
    // Continuous: the browser keeps listening through short pauses; this class decides when the
    // phrase is complete. The session is aborted before anything is sent or spoken.
    r.continuous = true;
    r.maxAlternatives = VOICE_LIMITS.maxAlternatives;
    this.heardThisSession = false;
    const startedAt = this.deps.now();
    r.onaudiostart = () => {
      if (g === this.gen) this.set({ ready: true, micStartMs: this.deps.now() - startedAt });
    };
    r.onresult = (event) => {
      if (g !== this.gen) return;
      const { final, interim } = readResults(event.results);
      this.heardThisSession = this.heardThisSession || !!final || !!interim;
      this.set({ interim: [final?.text, interim].filter(Boolean).join(" ") });
      if (this.phraseTimer !== null) this.deps.clearTimer(this.phraseTimer);
      this.phraseTimer = null;
      // Words still being recognized after the final part belong to the same phrase.
      this.pending = final && interim ? { ...final, text: `${final.text} ${interim}`, alternatives: [] } : final;
      if (!final) return;
      // More words may follow; the phrase is complete after a short silence (longer while words are
      // still arriving).
      this.phraseTimer = this.deps.setTimer(
        () => {
          this.phraseTimer = null;
          if (g === this.gen && this.pending) this.phrase(this.pending);
        },
        interim ? VOICE_LIMITS.endOfPhraseMs * 2 : VOICE_LIMITS.endOfPhraseMs,
      );
    };
    r.onerror = (event) => {
      if (g !== this.gen) return;
      const fatal = FATAL[event.error];
      if (fatal) {
        this.release();
        this.set({ state: "error", interim: "", ready: false, note: fatal });
      } else if (event.error === "network") {
        this.release();
        // A brief connection drop should not end the conversation: reconnect on its own a couple of
        // times (with a growing delay, mic closed meanwhile), then pause and ask as before.
        if (this.networkRetries < VOICE_LIMITS.networkRetries) {
          const delay = VOICE_LIMITS.networkRetryMs * 2 ** this.networkRetries;
          this.networkRetries += 1;
          this.set({ state: "paused", interim: "", ready: false, note: "Connection dropped. Reconnecting voice…" });
          this.later(() => this.listen(), delay);
        } else {
          this.set({ state: "paused", interim: "", ready: false, note: "Voice needs an internet connection in this browser. Press Resume to try again, or type." });
        }
      }
      // "no-speech" and "aborted" end the session; onend decides what happens next.
    };
    r.onend = () => {
      if (g !== this.gen || this.snap.state !== "listening") return;
      this.rec = null;
      if (this.pending) {
        this.phrase(this.pending); // the browser ended the session right after the last words
        return;
      }
      if (!this.heardThisSession) this.silentSessions += 1;
      const now = this.deps.now();
      this.restarts = [...this.restarts.filter((t) => now - t < VOICE_LIMITS.restartWindowMs), now];
      if (this.silentSessions >= VOICE_LIMITS.silentRestarts || now - this.lastPhraseAt >= VOICE_LIMITS.idleMs) {
        this.set({ state: "paused", interim: "", ready: false, note: "Paused because it was quiet. Press Resume to continue." });
        return;
      }
      if (this.restarts.length > VOICE_LIMITS.restartBurst) {
        this.set({ state: "paused", interim: "", ready: false, note: "Voice kept stopping in this browser. Press Resume, or type instead." });
        return;
      }
      this.later(() => this.listen(), VOICE_LIMITS.restartDelayMs);
    };
    this.rec = r;
    this.set({ state: "listening", interim: "", note: null, ready: false });
    try {
      r.start();
    } catch {
      this.release();
      this.set({ state: "error", ready: false, note: "The microphone could not start. Press Resume or type instead." });
    }
  }

  private phrase(heard: Heard) {
    const text = heard.text.trim();
    if (!text) return;
    const now = this.deps.now();
    if (text === this.lastFinal.text && now - this.lastFinal.at < VOICE_LIMITS.duplicateWindowMs) return;
    this.lastFinal = { text, at: now };
    this.heardThisSession = true;
    this.silentSessions = 0;
    this.networkRetries = 0;
    this.lastPhraseAt = now;
    // Close the mic before anything is sent or spoken.
    this.release();
    const turn = this.gen;
    this.set({ state: "understanding", interim: "", note: null, ready: false });
    this.sendFn({ ...heard, text })
      .catch(() => ({ say: "Could not reach FastQue. Nothing was changed." }) as TurnOutcome)
      .then((out) => {
        if (turn !== this.gen) return; // stopped, paused or restarted meanwhile
        if (out.end) {
          this.end("The assistant is not available for this account.");
          return;
        }
        void this.reply(out);
      });
  }

  private async reply(out: TurnOutcome) {
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
    let result: SpeakResult;
    try {
      result = await this.deps.speaker.speak(out.say, this.lang);
    } catch {
      result = { ok: false, reason: "engine-error" };
    }
    if (g !== this.gen) return; // interrupted, ended or paused while speaking
    if (result.ok) this.set({ speechError: null });
    else if (result.reason !== "interrupted") this.set({ speechError: SPEAK_FAILURE_TEXT[result.reason ?? "engine-error"] });
    next();
  }
}

