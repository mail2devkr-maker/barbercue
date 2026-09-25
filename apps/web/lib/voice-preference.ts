"use client";

import { useSyncExternalStore } from "react";
import {
  Language,
  OWNER_VOICE_PITCH,
  speechLocaleForVoiceStyle,
  voiceAnnouncementsForStyle,
  type OwnerVoiceStyle,
  type OwnerVoiceTone,
  type VoiceAnnouncements,
} from "@barbercue/shared";

// Speech itself remains opt-in per page session because browsers require a user gesture before
// reliable audio. The *profile* below persists because language/tone/voice are safe preferences
// and owners should not have to re-select them after every refresh.
let voiceEnabled = false;
const listeners = new Set<() => void>();

export interface OwnerVoiceProfile {
  style: OwnerVoiceStyle;
  tone: OwnerVoiceTone;
  voiceURI: string | null;
}

export const DEFAULT_OWNER_VOICE_PROFILE: OwnerVoiceProfile = {
  style: "ACCOUNT",
  tone: "NATURAL",
  voiceURI: null,
};

const PROFILE_STORAGE_KEY = "fastque-owner-voice-profile-v1";
let profile: OwnerVoiceProfile = DEFAULT_OWNER_VOICE_PROFILE;
let profileHydrated = false;

function isStyle(value: unknown): value is OwnerVoiceStyle {
  return value === "ACCOUNT" || value === "HINDI" || value === "ENGLISH" || value === "HINDI_BIHAR";
}

function isTone(value: unknown): value is OwnerVoiceTone {
  return value === "NATURAL" || value === "LIGHT" || value === "DEEP";
}

function hydrateProfile(): void {
  if (profileHydrated || typeof window === "undefined") return;
  profileHydrated = true;
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<OwnerVoiceProfile>;
    profile = {
      style: isStyle(parsed.style) ? parsed.style : DEFAULT_OWNER_VOICE_PROFILE.style,
      tone: isTone(parsed.tone) ? parsed.tone : DEFAULT_OWNER_VOICE_PROFILE.tone,
      voiceURI: typeof parsed.voiceURI === "string" && parsed.voiceURI ? parsed.voiceURI : null,
    };
  } catch {
    profile = DEFAULT_OWNER_VOICE_PROFILE;
  }
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function getVoiceEnabled(): boolean {
  return voiceEnabled;
}

export function setVoiceEnabled(next: boolean): void {
  if (voiceEnabled === next) return;
  voiceEnabled = next;
  emit();
}

export function getOwnerVoiceProfile(): OwnerVoiceProfile {
  hydrateProfile();
  return profile;
}

export function setOwnerVoiceProfile(next: OwnerVoiceProfile): void {
  hydrateProfile();
  profile = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private/restricted storage: keep the working in-memory preference for this tab.
    }
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVoiceEnabled(): boolean {
  return useSyncExternalStore(subscribe, getVoiceEnabled, () => false);
}

export function useOwnerVoiceProfile(): OwnerVoiceProfile {
  return useSyncExternalStore(subscribe, getOwnerVoiceProfile, () => DEFAULT_OWNER_VOICE_PROFILE);
}

function primarySubtag(locale: string): string {
  return locale.split(/[-_]/)[0]?.toLowerCase() ?? "";
}

export function ownerVoiceLocale(accountLanguage: Language | null | undefined): string {
  const current = getOwnerVoiceProfile();
  return speechLocaleForVoiceStyle(current.style, accountLanguage);
}

export function ownerVoiceAnnouncements(
  accountLanguage: Language | null | undefined,
): VoiceAnnouncements {
  const current = getOwnerVoiceProfile();
  return voiceAnnouncementsForStyle(current.style, accountLanguage);
}

export function matchingBrowserVoices(
  accountLanguage: Language | null | undefined,
): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const locale = ownerVoiceLocale(accountLanguage);
  const primary = primarySubtag(locale);
  return window.speechSynthesis
    .getVoices()
    .filter((voice) => primarySubtag(voice.lang) === primary)
    .sort((left, right) => {
      const leftExact = left.lang.toLowerCase() === locale.toLowerCase() ? 0 : 1;
      const rightExact = right.lang.toLowerCase() === locale.toLowerCase() ? 0 : 1;
      return leftExact - rightExact || left.name.localeCompare(right.name);
    });
}

export function speakOwnerVoice(
  text: string,
  accountLanguage: Language | null | undefined,
): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;

  hydrateProfile();
  const locale = speechLocaleForVoiceStyle(profile.style, accountLanguage);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = locale;
  utterance.pitch = OWNER_VOICE_PITCH[profile.tone];
  utterance.rate = 1;

  const compatibleVoices = matchingBrowserVoices(accountLanguage);
  const selected = profile.voiceURI
    ? compatibleVoices.find((voice) => voice.voiceURI === profile.voiceURI)
    : null;
  const fallback =
    compatibleVoices.find((voice) => voice.lang.toLowerCase() === locale.toLowerCase()) ??
    compatibleVoices[0] ??
    null;
  if (selected ?? fallback) utterance.voice = selected ?? fallback;

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return true;
}
