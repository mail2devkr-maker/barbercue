"use client";

import { useEffect, useState } from "react";
import { SPEAK_FAILURE_TEXT, type SpeechOutput, type VoiceInfo } from "../../lib/speech-output";
import type { SpeechLang } from "../../lib/use-speech";
import styles from "./action-assistant.module.css";

const SAMPLE: Record<"hi" | "en", { text: string; lang: string }> = {
  hi: { text: "Namaste, main FastQue Assistant hoon. Kya aap mujhe sun sakte hain?", lang: "hi-IN" },
  en: { text: "Hello, I am the FastQue Assistant. Can you hear me?", lang: "en-IN" },
};

/**
 * Issue #371: recognition language, the reply voice for Hindi and English, and a Test speaker
 * button (a user gesture, so the browser allows sound) that reports whether audio really played.
 */
export function VoiceSettings({ out, lang, onLang }: { out: SpeechOutput; lang: SpeechLang; onLang: (l: SpeechLang) => void }) {
  const [voices, setVoices] = useState<VoiceInfo[]>(() => out.list());
  const [picked, setPicked] = useState<Record<"hi" | "en", string>>({ hi: out.preferredFor("hi") ?? "", en: out.preferredFor("en") ?? "" });
  const [test, setTest] = useState<Record<"hi" | "en", string | null>>({ hi: null, en: null });

  useEffect(() => {
    const off = out.onVoicesChanged(() => setVoices(out.list()));
    void out.whenReady().then(() => setVoices(out.list()));
    return () => {
      off();
    };
  }, [out]);

  async function play(base: "hi" | "en") {
    setTest((t) => ({ ...t, [base]: "Playing…" }));
    const r = await out.speak(SAMPLE[base].text, SAMPLE[base].lang);
    setTest((t) => ({
      ...t,
      [base]: r.ok ? `Played with ${r.voice ?? "the browser's default voice"}. If you heard nothing, check the device volume and that this tab is not muted.` : SPEAK_FAILURE_TEXT[r.reason ?? "engine-error"],
    }));
  }

  const row = (base: "hi" | "en", title: string) => {
    const mine = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
    const used = out.voiceFor(SAMPLE[base].lang);
    return (
      <div className={styles.voiceRow}>
        <label className={styles.voiceLabel}>
          <span>{title} reply voice</span>
          <select
            value={picked[base]}
            onChange={(ev) => {
              const name = ev.target.value;
              setPicked((p) => ({ ...p, [base]: name }));
              out.setPreferred(base, name || null);
            }}
          >
            <option value="">Automatic</option>
            {mine.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
        <p className={styles.voiceStatus}>
          {!out.supported
            ? "This browser cannot speak replies."
            : mine.length
              ? `Using: ${used ? `${used.name} (${used.lang})` : "browser default"}`
              : base === "hi"
                ? "No Hindi voice is installed in this browser. Hindi words cannot be spoken; English text in replies still is."
                : "No English voice found; the browser default is used."}
        </p>
        <button type="button" className={styles.ctl} onClick={() => void play(base)} disabled={!out.supported}>
          Test speaker ({title})
        </button>
        {test[base] && (
          <p className={styles.voiceStatus} role="status">
            {test[base]}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className={styles.voiceSettings}>
      <label className={styles.voiceLabel}>
        <span>I will speak in</span>
        <select value={lang} onChange={(ev) => onLang(ev.target.value as SpeechLang)}>
          <option value="hi-IN">Hindi or Hinglish (हिंदी)</option>
          <option value="en-IN">English, or Hinglish in English words</option>
        </select>
      </label>
      <p className={styles.voiceStatus}>
        Hindi mode writes what you say in Hindi letters; English mode writes Hinglish in English letters. FastQue understands both. If a
        question is often misheard, try the other mode. The browser cannot detect the language by itself.
      </p>
      {row("hi", "Hindi")}
      {row("en", "English")}
    </div>
  );
}
