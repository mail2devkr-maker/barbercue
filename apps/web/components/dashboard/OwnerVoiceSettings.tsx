"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Language,
  OWNER_VOICE_STYLES,
  OWNER_VOICE_STYLE_LABELS,
  OWNER_VOICE_TONES,
  OWNER_VOICE_TONE_LABELS,
  type OwnerVoiceStyle,
  type OwnerVoiceTone,
} from "@barbercue/shared";
import { useAuth } from "../../lib/auth-context";
import {
  matchingBrowserVoices,
  ownerVoiceAnnouncements,
  setOwnerVoiceProfile,
  speakOwnerVoice,
  useOwnerVoiceProfile,
} from "../../lib/voice-preference";
import { Button } from "../ui/Button";
import styles from "./dashboard.module.css";

export function OwnerVoiceSettings() {
  const { user } = useAuth();
  const profile = useOwnerVoiceProfile();
  const accountLanguage = user?.preferredLanguage ?? Language.EN;
  const [voiceVersion, setVoiceVersion] = useState(0);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const refresh = () => setVoiceVersion((value) => value + 1);
    refresh();
    window.speechSynthesis.addEventListener?.("voiceschanged", refresh);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", refresh);
  }, []);

  const voices = useMemo(
    () => matchingBrowserVoices(accountLanguage),
    // voiceVersion deliberately retriggers after async browser voice discovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountLanguage, profile.style, voiceVersion],
  );

  function updateStyle(style: OwnerVoiceStyle) {
    setPreviewWarning(null);
    setOwnerVoiceProfile({ ...profile, style, voiceURI: null });
  }

  function updateTone(tone: OwnerVoiceTone) {
    setPreviewWarning(null);
    setOwnerVoiceProfile({ ...profile, tone });
  }

  function preview() {
    setPreviewWarning(null);
    const started = speakOwnerVoice(
      ownerVoiceAnnouncements(accountLanguage).voiceAnnouncementsOn(),
      accountLanguage,
    );
    if (!started) {
      setPreviewWarning(
        "No compatible Hindi voice is installed or exposed by this browser. Install/enable a Hindi text-to-speech voice, then try Preview again.",
      );
    }
  }

  return (
    <section className={styles.dividerSection}>
      <h2 className={styles.sectionHeading}>Booking voice & regional announcements</h2>
      <p style={{ color: "var(--bc-muted)", fontSize: 14, marginBottom: 14 }}>
        Choose what FastQue says and how it sounds on this browser. The app language can stay
        different. Exact installed voices are device-specific, so this preference is stored on this
        device rather than synced to every phone.
      </p>

      <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
        <label>
          <span style={{ display: "block", fontSize: 13, fontWeight: 650, marginBottom: 5 }}>
            Announcement language
          </span>
          <select
            value={profile.style}
            onChange={(event) => updateStyle(event.target.value as OwnerVoiceStyle)}
            className={styles.select}
          >
            {OWNER_VOICE_STYLES.map((style) => (
              <option key={style} value={style}>
                {OWNER_VOICE_STYLE_LABELS[style]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span style={{ display: "block", fontSize: 13, fontWeight: 650, marginBottom: 5 }}>
            Voice tone
          </span>
          <select
            value={profile.tone}
            onChange={(event) => updateTone(event.target.value as OwnerVoiceTone)}
            className={styles.select}
          >
            {OWNER_VOICE_TONES.map((tone) => (
              <option key={tone} value={tone}>
                {OWNER_VOICE_TONE_LABELS[tone]}
              </option>
            ))}
          </select>
          <span style={{ display: "block", marginTop: 5, color: "var(--bc-muted)", fontSize: 12 }}>
            Lighter/deeper changes pitch; actual male/female voice availability depends on the
            browser/operating-system TTS voices installed on this device.
          </span>
        </label>

        <label>
          <span style={{ display: "block", fontSize: 13, fontWeight: 650, marginBottom: 5 }}>
            Installed voice
          </span>
          <select
            value={profile.voiceURI ?? ""}
            onChange={(event) => {
              setPreviewWarning(null);
              setOwnerVoiceProfile({ ...profile, voiceURI: event.target.value || null });
            }}
            className={styles.select}
          >
            <option value="">Automatic best match</option>
            {voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} — {voice.lang}{voice.localService ? " (device)" : ""}
              </option>
            ))}
          </select>
          {voices.length === 0 && (
            <span style={{ display: "block", marginTop: 5, color: "var(--bc-warn)", fontSize: 12 }}>
              No matching installed voice is currently exposed by this browser. FastQue will ask
              the browser for its best system voice.
            </span>
          )}
        </label>

        {previewWarning && (
          <p role="alert" style={{ margin: 0, color: "var(--bc-warn)", fontSize: 12 }}>
            {previewWarning}
          </p>
        )}
        <div>
          <Button type="button" variant="outline" onClick={preview}>
            Preview selected voice
          </Button>
        </div>
      </div>
    </section>
  );
}
