"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ASSISTANT_LIMITS, ASSISTANT_PATHS, type AssistantTranscriptionDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "./api";

// Private voice input (issue #362): record a short clip in the browser and send it once to FastQue,
// which forwards it to a self-hosted Whisper server. Used only when the server reports
// `voice.local`. The clip is kept in memory for one request; nothing is stored on this device.

export type VoiceProvider = "browser" | "local";

const CONSENT_KEY = "fastque.assistant.voiceConsent.v1";

/** Per-viewer convenience only: which voice provider this person already agreed to. */
export function readVoiceConsent(): VoiceProvider[] {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is VoiceProvider => p === "browser" || p === "local") : [];
  } catch {
    return [];
  }
}

export function saveVoiceConsent(provider: VoiceProvider): void {
  try {
    const next = Array.from(new Set([...readVoiceConsent(), provider]));
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the notice simply shows again next time */
  }
}

export const VOICE_NOTICE: Record<VoiceProvider, string> = {
  browser:
    "Voice uses your browser's speech service to turn speech into text. In Chrome and most Android browsers your audio is sent to Google for this. FastQue does not record or keep your audio. You can always type instead.",
  local:
    "Voice is turned into text on FastQue's own private server. The recording is used once and never stored. You can always type instead.",
};

export function useLocalVoice(lang: "hi" | "en", onFinal: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalRef = useRef(onFinal);

  useEffect(() => {
    finalRef.current = onFinal;
  }, [onFinal]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const upload = useCallback(
    async (blob: Blob) => {
      setWorking(true);
      try {
        const form = new FormData();
        form.append("audio", blob, "speech");
        const result = await apiFetch<AssistantTranscriptionDto>(
          `${ASSISTANT_PATHS.assistant}/${ASSISTANT_PATHS.transcriptions}?lang=${lang}`,
          { method: "POST", body: form },
        );
        if (result.text.trim()) finalRef.current(result.text.trim());
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Private voice recognition is not responding. Please type instead.");
      } finally {
        setWorking(false);
      }
    },
    [lang],
  );

  const start = useCallback(async () => {
    setError(null);
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Recording is not available in this browser. You can type instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        chunks.current = [];
        if (blob.size > ASSISTANT_LIMITS.maxAudioBytes) setError("That recording is too long. Keep it under 30 seconds.");
        else if (blob.size) void upload(blob);
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
      timer.current = setTimeout(() => rec.state === "recording" && rec.stop(), ASSISTANT_LIMITS.maxAudioSeconds * 1000);
    } catch {
      setError("Microphone permission is off for this site. Allow it in the browser, or type instead.");
    }
  }, [upload]);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  return { recording, working, error, start, stop };
}
