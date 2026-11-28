"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Push-to-talk and read-aloud using only the browser's built-in Web Speech API: no FastQue server,
// no third-party provider, no cost. Where the browser has no recognition (or the microphone is
// refused), `supported` is false or `error` explains it and the user simply types.

export type SpeechLang = "hi-IN" | "en-IN";

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechErrorText(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Microphone permission is off for this site. Allow it in the browser, or type instead.";
  }
  if (code === "no-speech") return "I didn't hear anything. Try again, or type instead.";
  if (code === "audio-capture") return "No microphone was found. You can type instead.";
  if (code === "network") return "Voice needs an internet connection in this browser. You can type instead.";
  return "Voice input stopped. You can type instead.";
}

export function useSpeechInput(lang: SpeechLang, onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<RecognitionLike | null>(null);
  const finalRef = useRef(onFinal);

  useEffect(() => {
    finalRef.current = onFinal;
  }, [onFinal]);
  useEffect(() => {
    setSupported(recognitionCtor() !== null);
    return () => rec.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError("Voice input is not available in this browser. You can type instead.");
      return;
    }
    rec.current?.abort();
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (event) => {
      let text = "";
      let final = false;
      for (let i = 0; i < event.results.length; i += 1) {
        text += event.results[i][0].transcript;
        final = final || event.results[i].isFinal;
      }
      setInterim(text);
      if (final && text.trim()) {
        setInterim("");
        finalRef.current(text.trim());
      }
    };
    r.onerror = (event) => setError(speechErrorText(event.error));
    r.onend = () => setListening(false);
    rec.current = r;
    setError(null);
    setInterim("");
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
      setError(speechErrorText("start"));
    }
  }, [lang]);

  const stop = useCallback(() => rec.current?.stop(), []);
  return { supported, listening, interim, error, start, stop };
}

export function speak(text: string, lang: SpeechLang): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  window.speechSynthesis.speak(u);
  return true;
}
