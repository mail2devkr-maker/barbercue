"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ASSISTANT_PATHS, type AssistantCapabilitiesDto, type AssistantTurnDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { announceAssistantChange } from "../../lib/assistant-events";
import { speak, useSpeechInput, type SpeechLang } from "../../lib/use-speech";
import { VOICE_NOTICE, readVoiceConsent, saveVoiceConsent, useLocalVoice, type VoiceProvider } from "../../lib/use-local-voice";
import styles from "./action-assistant.module.css";

type Entry =
  | { kind: "user"; id: string; text: string; voice: boolean }
  | { kind: "pending"; id: string; stage: string }
  | { kind: "turn"; id: string; turn: AssistantTurnDto; settled: boolean };

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

// The visible pipeline for one request. Only the server's status moves it forward.
function stagesFor(turn: AssistantTurnDto): Array<{ label: string; state: "done" | "current" | "todo" | "stopped" }> {
  const write = turn.action?.kind === "WRITE";
  const s = turn.status;
  const understood = turn.action !== null;
  const applied = s === "DONE" && write && !!turn.result?.changed?.length;
  const stopped = ["DENIED", "FAILED", "CANCELLED", "UNSUPPORTED", "UNAVAILABLE"].includes(s);
  const list: Array<{ label: string; state: "done" | "current" | "todo" | "stopped" }> = [
    { label: "Heard", state: "done" },
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

const EXAMPLES: Record<"shop" | "customer" | "admin", string[]> = {
  shop: ["Aaj ki queue dikhao", "Haircut ₹200 se ₹150 karo", "Sunday band rakho", "Aaj ke appointments dikhao"],
  customer: ["Meri bookings dikhao", "Kal shaam 5 baje haircut book karo", "Meri queue ka status batao", "Haircut salon dhoondo"],
  admin: ["Platform overview dikhao", "Kitni shops open hain", "Notifications dikhao"],
};

export function ActionAssistant({ salonId, surface = "shop" }: { salonId?: string; surface?: "shop" | "customer" | "admin" }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<SpeechLang>("hi-IN");
  const [readAloud, setReadAloud] = useState(false);
  const [log, setLog] = useState<Entry[]>([]);
  // What this server offers for voice; the private (local) recognizer is preferred when available.
  const [voice, setVoice] = useState<AssistantCapabilitiesDto["voice"] | null>(null);
  // A voice provider is used only after this person has read and accepted its privacy notice.
  const [consentFor, setConsentFor] = useState<VoiceProvider | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [log]);

  // A new shop, screen or account never inherits an open confirmation from the previous one.
  useEffect(() => {
    setLog([]);
  }, [salonId, surface]);

  useEffect(() => {
    if (!open || voice) return;
    apiFetch<AssistantCapabilitiesDto>(`${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.capabilities}`)
      .then((caps) => setVoice(caps.voice))
      .catch(() => setVoice({ browser: true, local: false }));
  }, [open, voice]);

  const settle = useCallback(
    (pendingId: string, turn: AssistantTurnDto) => {
      setLog((l) => l.map((e) => (e.id === pendingId ? { kind: "turn", id: pendingId, turn, settled: false } : e)));
      if (turn.refresh?.length) announceAssistantChange(turn.refresh);
      if (readAloud) speak(turn.message, lang);
    },
    [lang, readAloud],
  );

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

  const send = useCallback(
    async (said: string, voice = false) => {
      const value = said.trim();
      if (!value || busy) return;
      const pendingId = nextId();
      setLog((l) => [...l, { kind: "user", id: nextId(), text: value, voice }, { kind: "pending", id: pendingId, stage: "Understanding…" }]);
      setText("");
      setBusy(true);
      try {
        const turn = await apiFetch<AssistantTurnDto>(`${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.turns}`, {
          method: "POST",
          body: JSON.stringify({ text: value, inputMode: voice ? "voice" : "text", surface, ...(salonId ? { salonId } : {}) }),
        });
        settle(pendingId, turn);
      } catch (err) {
        settle(pendingId, failTurn(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, salonId, settle, surface],
  );

  async function decide(entryId: string, token: string, decision: "confirm" | "cancel") {
    if (busy) return;
    setLog((l) => l.map((e) => (e.id === entryId && e.kind === "turn" ? { ...e, settled: true } : e)));
    const pendingId = nextId();
    setLog((l) => [...l, { kind: "pending", id: pendingId, stage: decision === "confirm" ? "Saving in FastQue…" : "Cancelling…" }]);
    setBusy(true);
    try {
      const turn = await apiFetch<AssistantTurnDto>(`${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.confirmations}`, {
        method: "POST",
        body: JSON.stringify({ token, decision }),
      });
      settle(pendingId, turn);
    } catch (err) {
      settle(pendingId, failTurn(err));
    } finally {
      setBusy(false);
    }
  }

  const speech = useSpeechInput(lang, (heard) => void send(heard, true));
  const local = useLocalVoice(lang === "en-IN" ? "en" : "hi", (heard) => void send(heard, true));
  const provider: VoiceProvider | null = voice?.local ? "local" : speech.supported ? "browser" : null;
  const listening = provider === "local" ? local.recording : speech.listening;
  const voiceError = provider === "local" ? local.error : speech.error;

  function startVoice(chosen: VoiceProvider) {
    if (chosen === "local") void local.start();
    else speech.start();
  }

  function toggleVoice() {
    if (!provider) return;
    if (listening) {
      if (provider === "local") local.stop();
      else speech.stop();
      return;
    }
    // Ask once per provider, before the microphone is ever opened.
    if (!readVoiceConsent().includes(provider)) {
      setConsentFor(provider);
      return;
    }
    startVoice(provider);
  }

  return (
    <>
      <button type="button" className={styles.fab} onClick={() => setOpen(true)} aria-label="Open FastQue Assistant" hidden={open}>
        <span aria-hidden="true">✦</span> Assistant
      </button>
      {open && (
        <aside className={styles.drawer} aria-label="FastQue Assistant" role="complementary">
          <header className={styles.header}>
            <div>
              <strong>FastQue Assistant</strong>
              <p className={styles.sub}>Bol kar ya likh kar batayein · Speak or type</p>
            </div>
            <button type="button" className={styles.close} onClick={() => { speech.stop(); local.stop(); setOpen(false); }} aria-label="Close assistant">×</button>
          </header>

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
                  {e.voice && <span className={styles.voiceTag} role="img" aria-label="spoken"><MicIcon /></span>}
                  {e.text}
                </div>
              ) : e.kind === "pending" ? (
                <div key={e.id} className={styles.pending} role="status">{e.stage}</div>
              ) : (
                <TurnCard key={e.id} entry={e} busy={busy} onDecide={decide} onOption={(t) => void send(t)} />
              ),
            )}
            <div ref={endRef} />
          </div>

          <form className={styles.composer} onSubmit={(ev) => { ev.preventDefault(); void send(text); }}>
            <div className={styles.tools}>
              <label className={styles.lang}>
                <span className={styles.srOnly}>Voice language</span>
                <select value={lang} onChange={(ev) => setLang(ev.target.value as SpeechLang)}>
                  <option value="hi-IN">हिंदी / Hinglish</option>
                  <option value="en-IN">English</option>
                </select>
              </label>
              <label className={styles.toggle}>
                <input type="checkbox" checked={readAloud} onChange={(ev) => setReadAloud(ev.target.checked)} /> Read replies aloud
              </label>
            </div>
            {consentFor && (
              <div className={styles.consent} role="dialog" aria-labelledby="assistant-voice-consent">
                <p id="assistant-voice-consent"><strong>Before you use the microphone</strong></p>
                <p>{VOICE_NOTICE[consentFor]}</p>
                <div className={styles.decide}>
                  <button
                    type="button"
                    className={styles.confirm}
                    onClick={() => {
                      const chosen = consentFor;
                      saveVoiceConsent(chosen);
                      setConsentFor(null);
                      startVoice(chosen);
                    }}
                  >
                    Allow microphone
                  </button>
                  <button type="button" className={styles.cancel} onClick={() => setConsentFor(null)}>Not now</button>
                </div>
              </div>
            )}
            {(listening || local.working) && (
              <p className={styles.listening} role="status">
                {local.working ? "Turning your voice into text…" : "Listening… tap the microphone again to stop."}
              </p>
            )}
            {voiceError && <p className={styles.voiceError} role="alert">{voiceError}</p>}
            <div className={styles.inputRow}>
              <input
                ref={inputRef}
                className={styles.input}
                value={speech.listening ? speech.interim || "Listening…" : text}
                onChange={(ev) => setText(ev.target.value)}
                placeholder="e.g. Massage price 10% badha do"
                aria-label="Message to the assistant"
                maxLength={500}
                disabled={listening || local.working}
              />
              {provider && (
                <button
                  type="button"
                  className={`${styles.mic} ${listening ? styles.micOn : ""}`}
                  onClick={toggleVoice}
                  aria-pressed={listening}
                  aria-label={listening ? "Stop listening" : "Speak"}
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
  onDecide,
  onOption,
}: {
  entry: Extract<Entry, { kind: "turn" }>;
  busy: boolean;
  onDecide: (id: string, token: string, decision: "confirm" | "cancel") => void;
  onOption: (text: string) => void;
}) {
  const { turn } = entry;
  const tone =
    turn.status === "DONE" ? styles.ok : turn.status === "NEEDS_CONFIRMATION" || turn.status === "NEEDS_INPUT" ? styles.ask : styles.stop;
  return (
    <article className={`${styles.card} ${tone}`} data-status={turn.status}>
      <div className={styles.cardHead}>
        <span className={styles.badge}>{entry.settled && turn.status === "NEEDS_CONFIRMATION" ? "Decision sent" : STATUS_LABEL[turn.status]}</span>
        {turn.action && <span className={styles.actionTitle}>{turn.action.title}</span>}
      </div>
      <ol className={styles.stages} aria-label="Progress">
        {stagesFor(turn).map((s) => (
          <li key={s.label} className={styles[`stage_${s.state}`]}>{s.label}</li>
        ))}
      </ol>
      <p className={styles.message}>{turn.message}</p>
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
      {turn.confirmation && !entry.settled && turn.status === "NEEDS_CONFIRMATION" && (
        <div className={styles.decide}>
          <button type="button" className={styles.confirm} disabled={busy} onClick={() => onDecide(entry.id, turn.confirmation!.token, "confirm")}>
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
        {turn.navigateTo && <Link href={turn.navigateTo} className={styles.open}>Open</Link>}
      </footer>
    </article>
  );
}
