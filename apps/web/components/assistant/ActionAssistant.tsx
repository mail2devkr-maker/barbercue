"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ASSISTANT_PATHS,
  AssistantActionId,
  type AssistantAccessDto,
  type AssistantCapabilitiesDto,
  type AssistantSurface,
  type AssistantTurnDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { announceAssistantChange } from "../../lib/assistant-events";
import { resolveFollowUp, type FollowUpOption } from "../../lib/assistant-followup";
import { useSpeechInput, type SpeechLang } from "../../lib/use-speech";
import { browserSpeechOutput, SPEAK_FAILURE_TEXT, type SpeechOutput } from "../../lib/speech-output";
import { VoiceSettings } from "./VoiceSettings";
import { VoiceCheck } from "./VoiceCheck";
import { VOICE_NOTICE, readVoiceConsent, saveVoiceConsent, useLocalVoice, type VoiceProvider } from "../../lib/use-local-voice";
import {
  VoiceConversation,
  recognizerCtor,
  voiceSupport,
  type Heard,
  type TurnOutcome,
  type VoiceSnapshot,
  type VoiceSupport,
} from "../../lib/voice-conversation";
import styles from "./action-assistant.module.css";

type Entry =
  | { kind: "user"; id: string; text: string; voice: boolean }
  | { kind: "pending"; id: string; stage: string }
  | { kind: "turn"; id: string; turn: AssistantTurnDto; settled: boolean; voice: boolean };

const STATUS_LABEL: Record<AssistantTurnDto["status"], string> = {
  DONE: "Done",
  NEEDS_CONFIRMATION: "Needs your confirmation",
  NEEDS_INPUT: "Need a detail",
  CANCELLED: "Cancelled",
  DENIED: "Not allowed",
  UNAVAILABLE: "Not available yet",
  UNSUPPORTED: "Not understood",
  FAILED: "Not applied",
};

const VOICE_LABEL: Record<VoiceSnapshot["state"], string> = {
  off: "Voice off",
  listening: "Listening…",
  understanding: "Understanding…",
  replying: "Speaking…",
  paused: "Paused",
  error: "Voice stopped",
};

// The visible pipeline for one request. Only the server's status moves it forward. The first step
// says "Speech → text" for voice, so a recognition mistake is not shown as a FastQue misunderstanding.
function stagesFor(turn: AssistantTurnDto, voice: boolean): Array<{ label: string; state: "done" | "current" | "todo" | "stopped" }> {
  const write = turn.action?.kind === "WRITE";
  const s = turn.status;
  const understood = turn.action !== null;
  const applied = s === "DONE" && write && !!turn.result?.changed?.length;
  const stopped = ["DENIED", "FAILED", "CANCELLED", "UNSUPPORTED", "UNAVAILABLE"].includes(s);
  const list: Array<{ label: string; state: "done" | "current" | "todo" | "stopped" }> = [
    { label: voice ? "Speech → text" : "Received", state: "done" },
    { label: "Understood", state: understood ? "done" : stopped ? "stopped" : "current" },
  ];
  if (write) {
    list.push({ label: "Previewed", state: s === "NEEDS_CONFIRMATION" || applied ? "done" : stopped ? "stopped" : "todo" });
    list.push({ label: "Confirmed", state: applied ? "done" : s === "NEEDS_CONFIRMATION" ? "current" : stopped ? "stopped" : "todo" });
    list.push({ label: "Saved by FastQue", state: applied ? "done" : stopped ? "stopped" : "todo" });
  } else {
    list.push({ label: "Answered", state: s === "DONE" ? "done" : stopped ? "stopped" : "current" });
  }
  return list;
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
    </svg>
  );
}

let seq = 0;
const nextId = () => `a${(seq += 1)}`;

const EXAMPLES: Record<AssistantSurface, string[]> = {
  shop: ["What can you do?", "Kitni chairs free hain?", "Aaj queue mein kitne log hain?", "Bookings kholo", "Aaj ki kamai batao"],
  customer: ["What can you do?", "Meri bookings dikhao", "Meri queue ka status batao", "Haircut salon dhoondo"],
  admin: ["What can you do?", "Platform overview dikhao", "Kitni shops open hain"],
  employee: ["What can you do?", "Mera kaam kitna hua", "Overdue follow ups dikhao", "Meri visits dikhao"],
};

/**
 * Only routes the assistant may open on the main screen: a page of THIS shop (the server builds
 * these from a fixed list for the authorized shop), or a known signed-in area for other surfaces.
 * Anything else (another shop, an absolute URL, "//host") is never followed.
 */
export function safeRoute(path: string | undefined, salonId?: string): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//") || /[\s\\]/.test(path)) return null;
  const shop = path.match(/^\/dashboard\/salons\/([^/?#]+)(\/[a-z-]+)?$/);
  if (shop) return salonId && shop[1] === salonId ? path : null;
  if (/^\/(account|employee|search)(\/[a-z-]+)?$/.test(path) || /^\/dashboard\/admin(\/[a-z-]+){0,2}$/.test(path)) return path;
  return null;
}

/** What the voice conversation says back for a turn. Short: the full answer stays on screen. */
export function spokenReply(turn: AssistantTurnDto): string {
  const m = turn.message.replace(/\s+/g, " ").trim();
  return m.length > 320 ? `${m.slice(0, 300)}… The rest is on screen.` : m;
}

/**
 * Release gate (issue #362): the drawer is not rendered at all unless the server says the assistant is
 * switched on for this signed-in user. Any error, a slow answer or a missing field means hidden.
 */
export function ActionAssistant(props: { salonId?: string; surface?: AssistantSurface }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    apiFetch<AssistantAccessDto>(`${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.access}`)
      .then((a) => {
        if (live) setEnabled(a?.enabled === true);
      })
      .catch(() => {
        if (live) setEnabled(false);
      });
    return () => {
      live = false;
    };
  }, []);
  const revoke = useCallback(() => setEnabled(false), []);
  // A new shop, screen or account remounts the drawer: it never inherits a conversation, an open
  // confirmation or a navigation trail from the previous one (unmount ends the conversation).
  return enabled ? <AssistantDrawer key={`${props.salonId ?? ""}:${props.surface ?? "shop"}`} {...props} onRevoked={revoke} /> : null;
}

type RunTurn = (said: string, viaVoice: boolean, heard?: Heard) => Promise<AssistantTurnDto | null>;

/** What the conversation sends for each heard phrase (with the recognizer's alternatives). */
function sendVia(runTurn: RunTurn) {
  return async (heard: Heard): Promise<TurnOutcome> => {
    const turn = await runTurn(heard.text, true, heard);
    if (!turn) return { say: "", end: true };
    return { say: spokenReply(turn), hold: turn.status === "NEEDS_CONFIRMATION" };
  };
}

/** The hands-free conversation, wired to the browser's speech APIs. The turn runner is set later. */
function createConversation(out: SpeechOutput): VoiceConversation {
  return new VoiceConversation({
    createRecognizer: () => {
      const C = recognizerCtor();
      return C ? new C() : null;
    },
    speaker: { speak: (text, lang) => out.speak(text, lang), cancel: () => out.cancel() },
    send: async () => ({ say: "", end: true }),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
  });
}

type Mode = "closed" | "open" | "docked";
type ConsentFor = { provider: VoiceProvider; then: "push" | "conversation" };

function AssistantDrawer({ salonId, surface = "shop", onRevoked }: { salonId?: string; surface?: AssistantSurface; onRevoked: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("closed");
  const open = mode === "open";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<SpeechLang>("hi-IN");
  // Replies to spoken questions are spoken by default (#371); typed questions stay silent.
  const [speakReplies, setSpeakReplies] = useState(true);
  const [pushSpeechError, setPushSpeechError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "settings" | "check">("none");
  const [log, setLog] = useState<Entry[]>([]);
  const [voice, setVoice] = useState<AssistantCapabilitiesDto["voice"] | null>(null);
  const [consentFor, setConsentFor] = useState<ConsentFor | null>(null);
  // The drawer renders only on the client (after the access check), so the browser can be asked directly.
  const [support] = useState<VoiceSupport>(() => voiceSupport());
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const busyRef = useRef(false);
  // Pages the assistant opened in this conversation: "go back" only returns along this trail.
  const trail = useRef<string[]>([]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current && mode === "closed") fabRef.current?.focus();
    wasOpen.current = open;
  }, [open, mode]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [log]);

  useEffect(() => {
    if (mode === "closed" || voice) return;
    apiFetch<AssistantCapabilitiesDto>(`${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.capabilities}`)
      .then((caps) => setVoice(caps.voice))
      .catch(() => setVoice({ browser: true, local: false }));
  }, [mode, voice]);

  // ---- hands-free conversation (browser speech recognition + speech output)
  const [out] = useState(browserSpeechOutput);
  const [conversation] = useState(() => createConversation(out));
  const voiceState = useSyncExternalStore(
    (fn) => conversation.subscribe(fn),
    () => conversation.snapshot,
    () => conversation.snapshot,
  );
  const inConversation = voiceState.state !== "off";

  const failTurn = (err: unknown): AssistantTurnDto => ({
    requestId: "local",
    status: "FAILED",
    action: null,
    message:
      err instanceof ApiError && err.status === 429
        ? "Too many requests. Wait a moment and try again. Nothing was changed."
        : err instanceof ApiError
          ? `${err.message} Nothing was changed.`
          : "Could not reach FastQue. Nothing was changed.",
    completedAt: new Date().toISOString(),
  });

  /** Apply what a turn asks of the MAIN screen (navigation), and return the turn to show. */
  const applyToScreen = useCallback(
    (turn: AssistantTurnDto): AssistantTurnDto => {
      if (turn.status !== "DONE") return turn;
      if (turn.action?.id === AssistantActionId.NAVIGATE_BACK) {
        if (trail.current.length === 0)
          return { ...turn, message: "I haven't opened another page in this conversation, so there is nowhere to go back to." };
        trail.current.pop();
        router.back();
        setMode((m) => (m === "open" ? "docked" : m));
        return turn;
      }
      if (turn.action?.id === AssistantActionId.NAVIGATE) {
        const to = safeRoute(turn.navigateTo, salonId);
        if (!to) return { ...turn, message: "I can't open that page from here.", navigateTo: undefined };
        trail.current.push(to);
        router.push(to);
        // The page opens on the MAIN screen; the assistant shrinks to a small bar beside it.
        setMode((m) => (m === "open" ? "docked" : m));
      }
      return turn;
    },
    [router, salonId],
  );

  // The options of the last unanswered question ("Which staff member?"): a short reply such as
  // "Ramesh" or "doosra" answers it with that option's full command (multi-turn follow-up).
  const openOptions = useRef<FollowUpOption[] | null>(null);

  /** One turn to the server. Shared by typing, push-to-talk and the voice conversation. */
  const runTurn = useCallback(
    async (said: string, viaVoice: boolean, heard?: Heard): Promise<AssistantTurnDto | null> => {
      const value = said.trim();
      if (!value || busyRef.current) return null;
      busyRef.current = true;
      const pendingId = nextId();
      setLog((l) => [...l, { kind: "user", id: nextId(), text: value, voice: viaVoice }, { kind: "pending", id: pendingId, stage: "Understanding…" }]);
      setBusy(true);
      let turn: AssistantTurnDto;
      let revoked = false;
      try {
        turn = await apiFetch<AssistantTurnDto>(`${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.turns}`, {
          method: "POST",
          body: JSON.stringify({
            text: resolveFollowUp(value, openOptions.current) ?? value,
            inputMode: viaVoice ? "voice" : "text",
            surface,
            ...(salonId ? { salonId } : {}),
            ...(heard?.alternatives.length ? { alternatives: heard.alternatives } : {}),
            ...(heard?.confidence != null ? { confidence: heard.confidence } : {}),
          }),
        });
        turn = applyToScreen(turn);
        openOptions.current = turn.status === "NEEDS_INPUT" && turn.options?.length ? turn.options : null;
      } catch (err) {
        openOptions.current = null;
        // 404: the assistant was switched off for this account (cohort removed); 401: signed out.
        revoked = err instanceof ApiError && (err.status === 404 || err.status === 401);
        turn = failTurn(err);
      }
      setLog((l) => l.map((e) => (e.id === pendingId ? { kind: "turn", id: pendingId, turn, settled: false, voice: viaVoice } : e)));
      if (turn.refresh?.length) announceAssistantChange(turn.refresh);
      busyRef.current = false;
      setBusy(false);
      if (revoked) {
        conversation.end("The assistant is not available for this account.");
        onRevoked();
        return null;
      }
      return turn;
    },
    [applyToScreen, conversation, onRevoked, salonId, surface],
  );
  useEffect(() => conversation.setSend(sendVia(runTurn)), [conversation, runTurn]);

  useEffect(() => conversation.setLang(lang), [conversation, lang]);
  // Never leave a microphone running: unmount (sign-out, leaving the shop) releases it.
  useEffect(() => () => conversation.end(), [conversation]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => {
      if (document.visibilityState === "hidden") conversation.pause("Paused while FastQue was in the background. Press Resume to continue.");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [conversation]);

  // ---- push-to-talk (one phrase per tap) and typing: the fallbacks
  const send = useCallback(
    async (said: string, viaVoice = false) => {
      setText("");
      const turn = await runTurn(said, viaVoice);
      // A spoken question gets a spoken answer; a failure to play is shown, never silent.
      if (turn && viaVoice && speakReplies && !inConversation) {
        const r = await out.speak(spokenReply(turn), lang);
        setPushSpeechError(r.ok || r.reason === "interrupted" ? null : SPEAK_FAILURE_TEXT[r.reason ?? "engine-error"]);
      }
    },
    [runTurn, speakReplies, lang, inConversation, out],
  );

  async function decide(entryId: string, token: string, decision: "confirm" | "cancel", acknowledged = false) {
    if (busyRef.current) return;
    busyRef.current = true;
    setLog((l) => l.map((e) => (e.id === entryId && e.kind === "turn" ? { ...e, settled: true } : e)));
    const pendingId = nextId();
    setLog((l) => [...l, { kind: "pending", id: pendingId, stage: decision === "confirm" ? "Saving in FastQue…" : "Cancelling…" }]);
    setBusy(true);
    let turn: AssistantTurnDto;
    try {
      turn = await apiFetch<AssistantTurnDto>(`${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.confirmations}`, {
        method: "POST",
        body: JSON.stringify({ token, decision, ...(acknowledged ? { acknowledged: true } : {}) }),
      });
    } catch (err) {
      turn = failTurn(err);
    }
    // A refusal that did not use up the confirmation (e.g. the acknowledgement was missing) leaves
    // the original preview usable.
    const reusable = turn.status === "NEEDS_CONFIRMATION" && !turn.confirmation;
    setLog((l) =>
      l.map((e) =>
        e.id === pendingId
          ? { kind: "turn", id: pendingId, turn, settled: false, voice: false }
          : reusable && e.id === entryId && e.kind === "turn"
            ? { ...e, settled: false }
            : e,
      ),
    );
    if (turn.refresh?.length) announceAssistantChange(turn.refresh);
    busyRef.current = false;
    setBusy(false);
  }

  const speech = useSpeechInput(lang, (heard) => void send(heard, true));
  const local = useLocalVoice(lang === "en-IN" ? "en" : "hi", (heard) => void send(heard, true));
  const provider: VoiceProvider | null = voice?.local ? "local" : speech.supported ? "browser" : null;
  const listening = provider === "local" ? local.recording : speech.listening;
  const voiceError = provider === "local" ? local.error : speech.error;
  const handsFree = support === "hands-free" || support === "no-speech";

  function startConversation() {
    if (!handsFree) return;
    if (!readVoiceConsent().includes("browser")) {
      setConsentFor({ provider: "browser", then: "conversation" });
      return;
    }
    speech.stop();
    conversation.start(lang);
  }

  function startPush(chosen: VoiceProvider) {
    if (chosen === "local") void local.start();
    else speech.start();
  }

  function toggleVoice() {
    if (!provider || inConversation) return;
    if (listening) {
      if (provider === "local") local.stop();
      else speech.stop();
      return;
    }
    if (!readVoiceConsent().includes(provider)) {
      setConsentFor({ provider, then: "push" });
      return;
    }
    startPush(provider);
  }

  /** Correct a badly recognised phrase: it goes into the box to edit; nothing is sent until Send. */
  function editHeard(said: string) {
    if (inConversation) conversation.pause("Paused while you edit. Press Resume to keep talking.");
    setText(said);
    setMode("open");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function closeAll() {
    conversation.end();
    speech.stop();
    local.stop();
    setConsentFor(null);
    setMode("closed");
  }

  const lastTurn = [...log].reverse().find((e): e is Extract<Entry, { kind: "turn" }> => e.kind === "turn");

  // A reply that could not be played is said plainly, with a way to test the speaker.
  const speechProblem = (msg: string) => (
    <p className={styles.voiceError} role="alert">
      {msg}{" "}
      <button type="button" className={styles.editHeard} onClick={() => setPanel("settings")}>
        Test speaker
      </button>
    </p>
  );

  const conversationControls = (compact: boolean) => (
    <div className={compact ? styles.miniControls : styles.convControls}>
      {voiceState.state === "replying" && (
        <button type="button" className={styles.ctl} onClick={() => conversation.interrupt()}>
          Interrupt
        </button>
      )}
      {(voiceState.state === "paused" || voiceState.state === "error") && (
        <button type="button" className={styles.ctl} onClick={() => conversation.resume()}>
          Resume
        </button>
      )}
      {(voiceState.state === "listening" || voiceState.state === "understanding") && (
        <button type="button" className={styles.ctl} onClick={() => conversation.pause("Paused. Press Resume to keep talking.")}>
          Pause
        </button>
      )}
      <button type="button" className={styles.ctl} aria-pressed={voiceState.muted} onClick={() => conversation.setMuted(!voiceState.muted)}>
        {voiceState.muted ? "Unmute" : "Mute"}
      </button>
      <button type="button" className={`${styles.ctl} ${styles.ctlEnd}`} onClick={() => conversation.end()}>
        End conversation
      </button>
    </div>
  );

  return (
    <>
      {mode === "closed" && (
        <button ref={fabRef} type="button" className={styles.fab} onClick={() => setMode("open")} aria-label="Open FastQue Assistant" aria-expanded={false}>
          <span aria-hidden="true">✦</span> Assistant
        </button>
      )}

      {mode === "docked" && (
        <section className={styles.mini} aria-label="FastQue Assistant (minimized)">
          <div className={styles.miniHead}>
            <span className={`${styles.dot} ${styles[`dot_${voiceState.state}`] ?? ""}`} aria-hidden="true" />
            <strong role="status" aria-live="polite">{inConversation ? VOICE_LABEL[voiceState.state] : "Assistant"}</strong>
            <button type="button" className={styles.ctl} onClick={() => setMode("open")} aria-label="Expand assistant">
              Expand
            </button>
            {!inConversation && (
              <button type="button" className={styles.close} onClick={closeAll} aria-label="Close assistant">×</button>
            )}
          </div>
          <p className={styles.miniText}>
            {voiceState.interim ? `“${voiceState.interim}”` : (voiceState.note ?? lastTurn?.turn.message ?? "Ask me anything about your shop.")}
          </p>
          {inConversation && conversationControls(true)}
        </section>
      )}

      {open && (
        <aside
          className={styles.drawer}
          aria-labelledby="fastque-assistant-title"
          role="complementary"
          onKeyDown={(ev) => {
            if (ev.key !== "Escape") return;
            ev.stopPropagation();
            if (consentFor) setConsentFor(null);
            else setMode(inConversation ? "docked" : "closed");
          }}
        >
          <header className={styles.header}>
            <div>
              <strong id="fastque-assistant-title">FastQue Assistant</strong>
              <p className={styles.sub}>Bol kar ya likh kar batayein · Speak or type</p>
            </div>
            <div className={styles.headBtns}>
              <button type="button" className={styles.close} onClick={() => setMode("docked")} aria-label="Minimize assistant" title="Minimize">–</button>
              <button type="button" className={styles.close} onClick={closeAll} aria-label="Close assistant" title="Close">×</button>
            </div>
          </header>

          <div className={styles.convBar}>
            {inConversation ? (
              <>
                <p className={styles.convState} role="status" aria-live="polite">
                  <span className={`${styles.dot} ${styles[`dot_${voiceState.state}`] ?? ""}`} aria-hidden="true" />
                  {voiceState.state === "listening" ? (voiceState.ready ? "Listening… speak now" : "Starting microphone… wait") : VOICE_LABEL[voiceState.state]}
                  {voiceState.interim && <span className={styles.caption}> “{voiceState.interim}”</span>}
                </p>
                {voiceState.note && <p className={styles.convNote}>{voiceState.note}</p>}
                {voiceState.speechError && speechProblem(voiceState.speechError)}
                {conversationControls(false)}
              </>
            ) : handsFree ? (
              <>
                <button type="button" className={styles.convStart} onClick={startConversation} disabled={busy}>
                  <MicIcon /> Start voice conversation
                </button>
                {voiceState.note && <p className={styles.convNote}>{voiceState.note}</p>}
                {(voiceState.speechError ?? pushSpeechError) && speechProblem((voiceState.speechError ?? pushSpeechError) as string)}
              </>
            ) : (
              <p className={styles.convNote}>
                {support === "push-to-talk"
                  ? "Hands-free conversation is not available in this browser (iPhone and iPad need a tap for each question). Use the microphone button for each question, or type."
                  : "This browser has no speech recognition, so voice conversation is not available here. Type your question."}
              </p>
            )}
            <div className={styles.miniControls}>
              <button type="button" className={styles.ctl} aria-expanded={panel === "settings"} onClick={() => setPanel(panel === "settings" ? "none" : "settings")}>
                Voice settings &amp; speaker test
              </button>
              {handsFree && !inConversation && surface === "shop" && (
                <button type="button" className={styles.ctl} aria-expanded={panel === "check"} onClick={() => setPanel(panel === "check" ? "none" : "check")}>
                  Check voice accuracy
                </button>
              )}
            </div>
            {panel === "settings" && <VoiceSettings out={out} lang={lang} onLang={setLang} />}
            {panel === "check" && !inConversation && surface === "shop" && <VoiceCheck lang={lang} onClose={() => setPanel("none")} />}
          </div>

          <div className={styles.log} aria-live="polite">
            {log.length === 0 && (
              <div className={styles.empty}>
                <p>Try:</p>
                {EXAMPLES[surface].map((ex) => (
                  <button key={ex} type="button" className={styles.chip} onClick={() => void send(ex)}>{ex}</button>
                ))}
              </div>
            )}
            {log.map((e) =>
              e.kind === "user" ? (
                <div key={e.id} className={styles.user}>
                  {e.voice && <span className={styles.voiceTag} role="img" aria-label="spoken, as recognised by the browser"><MicIcon /></span>}
                  <span>{e.text}</span>
                  {e.voice && (
                    <button type="button" className={styles.editHeard} onClick={() => editHeard(e.text)} aria-label={`Not what you said? Edit “${e.text}”`}>
                      Edit
                    </button>
                  )}
                </div>
              ) : e.kind === "pending" ? (
                <div key={e.id} className={styles.pending} role="status">{e.stage}</div>
              ) : (
                <TurnCard
                  key={e.id}
                  entry={e}
                  busy={busy}
                  salonId={salonId}
                  onDecide={decide}
                  onOption={(t) => void send(t)}
                  onOpen={(to) => {
                    trail.current.push(to);
                    setMode("docked");
                  }}
                />
              ),
            )}
            <div ref={endRef} />
          </div>

          <form className={styles.composer} onSubmit={(ev) => { ev.preventDefault(); void send(text); }}>
            <div className={styles.tools}>
              <label className={styles.lang}>
                <span className={styles.toolLabel}>Voice language</span>
                <select value={lang} onChange={(ev) => setLang(ev.target.value as SpeechLang)}>
                  <option value="hi-IN">हिंदी / Hinglish</option>
                  <option value="en-IN">English</option>
                </select>
              </label>
              {!inConversation && (
                <label className={styles.toggle}>
                  <input type="checkbox" checked={speakReplies} onChange={(ev) => setSpeakReplies(ev.target.checked)} /> Speak replies to voice questions
                </label>
              )}
            </div>
            {consentFor && (
              <div className={styles.consent} role="dialog" aria-labelledby="assistant-voice-consent">
                <p id="assistant-voice-consent"><strong>Before you use the microphone</strong></p>
                <p>{VOICE_NOTICE[consentFor.provider]}</p>
                {consentFor.then === "conversation" && (
                  <p>In a voice conversation the microphone opens again after each reply until you press End conversation. FastQue does not record or keep your voice.</p>
                )}
                <div className={styles.decide}>
                  <button
                    type="button"
                    className={styles.confirm}
                    onClick={() => {
                      const c = consentFor;
                      saveVoiceConsent(c.provider);
                      setConsentFor(null);
                      if (c.then === "conversation") {
                        speech.stop();
                        conversation.start(lang);
                      } else startPush(c.provider);
                    }}
                  >
                    Allow microphone
                  </button>
                  <button type="button" className={styles.cancel} onClick={() => setConsentFor(null)}>Not now</button>
                </div>
              </div>
            )}
            {!inConversation && (listening || local.working) && (
              <p className={styles.listening} role="status">
                {local.working ? "Turning your voice into text…" : "Listening… tap the microphone again to stop."}
              </p>
            )}
            {!inConversation && voiceError && <p className={styles.voiceError} role="alert">{voiceError}</p>}
            <div className={styles.inputRow}>
              <input
                ref={inputRef}
                className={styles.input}
                value={speech.listening ? speech.interim || "Listening…" : text}
                onChange={(ev) => setText(ev.target.value)}
                placeholder="e.g. Kitni chairs free hain?"
                aria-label="Message to the assistant"
                maxLength={500}
                disabled={listening || local.working}
              />
              {provider && !inConversation && (
                <button
                  type="button"
                  className={`${styles.mic} ${listening ? styles.micOn : ""}`}
                  onClick={toggleVoice}
                  aria-pressed={listening}
                  aria-label={listening ? "Stop listening" : "Speak one question"}
                  title={provider === "local" ? "Private voice (FastQue server)" : "Browser voice"}
                  disabled={busy || local.working}
                >
                  <MicIcon />
                </button>
              )}
              <button type="submit" className={styles.send} disabled={busy || !text.trim()}>Send</button>
            </div>
          </form>
        </aside>
      )}
    </>
  );
}

function TurnCard({
  entry,
  busy,
  salonId,
  onDecide,
  onOption,
  onOpen,
}: {
  entry: Extract<Entry, { kind: "turn" }>;
  busy: boolean;
  salonId?: string;
  onDecide: (id: string, token: string, decision: "confirm" | "cancel", acknowledged?: boolean) => void;
  onOption: (text: string) => void;
  onOpen: (to: string) => void;
}) {
  const { turn } = entry;
  // Issue #372: a high-risk change needs a deliberate "I understand" before Confirm is enabled.
  const [ack, setAck] = useState(false);
  const highRisk = turn.preview?.risk === "high";
  const tone =
    turn.status === "DONE" ? styles.ok : turn.status === "NEEDS_CONFIRMATION" || turn.status === "NEEDS_INPUT" ? styles.ask : styles.stop;
  // A navigation turn already opened its page; other answers offer to open theirs.
  const openTo = turn.action?.id === AssistantActionId.NAVIGATE ? null : safeRoute(turn.navigateTo, salonId);
  return (
    <article className={`${styles.card} ${tone}`} data-status={turn.status}>
      <div className={styles.cardHead}>
        <span className={styles.badge}>{entry.settled && turn.status === "NEEDS_CONFIRMATION" ? "Decision sent" : STATUS_LABEL[turn.status]}</span>
        {turn.action && <span className={styles.actionTitle}>{turn.action.title}</span>}
      </div>
      <ol className={styles.stages} aria-label="Progress">
        {stagesFor(turn, entry.voice).map((s) => (
          <li key={s.label} className={styles[`stage_${s.state}`]}>{s.label}</li>
        ))}
      </ol>
      {turn.understoodAs && <p className={styles.understoodAs}>Understood as: “{turn.understoodAs}”</p>}
      {turn.preview?.question ? (
        <>
          <p className={styles.question}>{turn.preview.question}</p>
          <p className={styles.message}>{turn.message.replace(turn.preview.question, "").trim()}</p>
        </>
      ) : (
        <p className={styles.message}>{turn.message}</p>
      )}
      {turn.preview && (
        <table className={styles.preview}>
          <thead>
            <tr><th scope="col">What</th><th scope="col">Before</th><th scope="col">After</th></tr>
          </thead>
          <tbody>
            {turn.preview.rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{r.before ?? "—"}</td>
                <td><strong>{r.after ?? "—"}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {turn.preview?.warning && <p className={styles.warning}>{turn.preview.warning}</p>}
      {turn.confirmation && !entry.settled && turn.status === "NEEDS_CONFIRMATION" && highRisk && (
        <label className={styles.ack}>
          <input type="checkbox" checked={ack} onChange={(ev) => setAck(ev.target.checked)} /> Main samajhta/samajhti hoon ki yeh ek bada badlav hai. (I
          understand what this change does.)
        </label>
      )}
      {turn.confirmation && !entry.settled && turn.status === "NEEDS_CONFIRMATION" && (
        <div className={styles.decide}>
          <button
            type="button"
            className={styles.confirm}
            disabled={busy || (highRisk && !ack)}
            onClick={() => onDecide(entry.id, turn.confirmation!.token, "confirm", highRisk ? ack : undefined)}
          >
            Confirm
          </button>
          <button type="button" className={styles.cancel} disabled={busy} onClick={() => onDecide(entry.id, turn.confirmation!.token, "cancel")}>
            Cancel
          </button>
        </div>
      )}
      {turn.options && turn.options.length > 0 && (
        <div className={styles.options}>
          {turn.options.map((o) => (
            <button key={o.text} type="button" className={styles.chip} disabled={busy} onClick={() => onOption(o.text)}>{o.label}</button>
          ))}
        </div>
      )}
      {turn.result?.items && turn.result.items.length > 0 && (
        <ul className={styles.items}>
          {turn.result.items.map((i, n) => (
            <li key={i.id ?? n}><span>{i.title}</span>{i.detail && <small>{i.detail}</small>}</li>
          ))}
        </ul>
      )}
      <footer className={styles.cardFoot}>
        <time dateTime={turn.completedAt}>{new Date(turn.completedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
        {openTo && (
          <Link href={openTo} className={styles.open} onClick={() => onOpen(openTo)}>
            Open page
          </Link>
        )}
      </footer>
    </article>
  );
}
