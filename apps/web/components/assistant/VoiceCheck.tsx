"use client";

import { useEffect, useRef, useState } from "react";
import { ASSISTANT_PATHS, VOICE_CHECK_PHRASES, type AssistantInterpretationDto } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { readResults, recognizerCtor, VOICE_LIMITS, type RecognizerLike } from "../../lib/voice-conversation";
import type { SpeechLang } from "../../lib/use-speech";
import styles from "./action-assistant.module.css";

export interface CheckRow {
  id: string;
  say: string;
  heard: string;
  alternatives: number;
  /** The top transcript alone was understood as the expected action. */
  topOk: boolean;
  /** Understood after alternatives were considered (what the Assistant now does). */
  ok: boolean;
  usedAlternative: boolean;
  micStartMs: number | null;
}

/** First-try summary; counts only, safe to copy into an issue. */
export function summarize(rows: CheckRow[], lang: string): string {
  const n = rows.length;
  const ok = rows.filter((r) => r.ok).length;
  const top = rows.filter((r) => r.topOk).length;
  const mic = rows.map((r) => r.micStartMs).filter((x): x is number => x !== null);
  return [
    `FastQue voice check (${lang}): understood on the FIRST try ${ok}/${n}`,
    `top transcript only (before #371): ${top}/${n}; helped by an alternative: ${rows.filter((r) => r.usedAlternative).length}`,
    mic.length ? `microphone start: median ${mic.sort((a, b) => a - b)[Math.floor(mic.length / 2)]} ms` : "",
    `missed: ${rows.filter((r) => !r.ok).map((r) => r.id).join(", ") || "none"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Issue #371: measure first-attempt recognition on THIS browser and microphone. The owner says each
 * phrase once; the browser's transcript and alternatives are sent to the dry-run interpretation
 * endpoint (nothing runs, nothing is stored or logged). Results stay on this screen.
 */
export function VoiceCheck({ lang, onClose }: { lang: SpeechLang; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rows, setRows] = useState<CheckRow[]>([]);
  const [state, setState] = useState<"idle" | "starting" | "listening" | "checking">("idle");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<RecognizerLike | null>(null);
  const phrase = VOICE_CHECK_PHRASES[i];
  const done = i >= VOICE_CHECK_PHRASES.length;

  useEffect(() => () => rec.current?.abort(), []);

  async function record(heard: string, alternatives: string[], micStartMs: number | null) {
    setState("checking");
    try {
      const r = await apiFetch<AssistantInterpretationDto>(`${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.interpretations}`, {
        method: "POST",
        body: JSON.stringify({ text: heard, alternatives, surface: "shop" }),
      });
      setRows((x) => [
        ...x,
        {
          id: phrase.id,
          say: phrase.say,
          heard,
          alternatives: alternatives.length,
          topOk: r.topAction === phrase.expect,
          ok: r.action === phrase.expect,
          usedAlternative: r.usedAlternative,
          micStartMs,
        },
      ]);
      setI((n) => n + 1);
    } catch {
      setError("Could not check this phrase. Try again.");
    }
    setState("idle");
  }

  function listen() {
    const C = recognizerCtor();
    if (!C) {
      setError("This browser has no speech recognition.");
      return;
    }
    setError(null);
    const r = new C();
    rec.current = r;
    r.lang = lang;
    r.interimResults = false;
    r.continuous = false; // one phrase, first attempt only
    r.maxAlternatives = VOICE_LIMITS.maxAlternatives;
    const t0 = Date.now();
    let mic: number | null = null;
    let got = false;
    r.onaudiostart = () => {
      mic = Date.now() - t0;
      setState("listening");
    };
    r.onresult = (ev) => {
      const { final } = readResults(ev.results);
      if (!final || got) return;
      got = true;
      r.abort();
      void record(final.text, final.alternatives, mic);
    };
    r.onerror = (ev) => {
      if (ev.error === "no-speech") setError("Nothing was heard. Press Speak and say the phrase.");
      else if (ev.error !== "aborted") setError(`Voice stopped (${ev.error}).`);
    };
    r.onend = () => {
      if (!got) setState("idle");
    };
    setState("starting");
    try {
      r.start();
    } catch {
      setState("idle");
      setError("The microphone could not start.");
    }
  }

  return (
    <section className={styles.voiceCheck} aria-label="Voice accuracy check">
      <div className={styles.miniHead}>
        <strong>Voice accuracy check</strong>
        <button type="button" className={styles.ctl} onClick={onClose}>
          Close
        </button>
      </div>
      {!done ? (
        <>
          <p className={styles.voiceStatus}>
            Phrase {i + 1} of {VOICE_CHECK_PHRASES.length}. Press Speak, wait for “Speak now”, then say it once, naturally.
          </p>
          <p className={styles.checkPhrase}>“{phrase.say}”</p>
          <p className={styles.voiceStatus} role="status">
            {state === "starting" ? "Starting microphone…" : state === "listening" ? "Speak now" : state === "checking" ? "Checking…" : ""}
          </p>
          <div className={styles.miniControls}>
            <button type="button" className={styles.convStart} onClick={listen} disabled={state !== "idle"}>
              Speak
            </button>
            <button
              type="button"
              className={styles.ctl}
              disabled={state !== "idle"}
              onClick={() => {
                setRows((x) => [...x, { id: phrase.id, say: phrase.say, heard: "(skipped)", alternatives: 0, topOk: false, ok: false, usedAlternative: false, micStartMs: null }]);
                setI((n) => n + 1);
              }}
            >
              Skip
            </button>
          </div>
          {error && (
            <p className={styles.voiceError} role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <pre className={styles.checkSummary}>{summarize(rows, lang)}</pre>
      )}
      {rows.length > 0 && (
        <ul className={styles.items}>
          {rows.map((r) => (
            <li key={r.id}>
              <span>
                {r.ok ? "✓" : "✗"} {r.say}
              </span>
              <small>
                heard: {r.heard}
                {r.usedAlternative ? " (alternative used)" : ""}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
