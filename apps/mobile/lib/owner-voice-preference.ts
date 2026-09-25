import { useEffect, useState } from 'react';
import type { OwnerVoiceStyle, OwnerVoiceTone } from '@barbercue/shared';
import { getItem, setItem } from './secure-storage';

export interface MobileOwnerVoiceProfile {
  style: OwnerVoiceStyle;
  tone: OwnerVoiceTone;
  voiceIdentifier: string | null;
}

export const DEFAULT_MOBILE_OWNER_VOICE_PROFILE: MobileOwnerVoiceProfile = {
  style: 'ACCOUNT',
  tone: 'NATURAL',
  voiceIdentifier: null,
};

const STORAGE_KEY = 'fastque_owner_voice_profile_v1';
let cachedProfile: MobileOwnerVoiceProfile = DEFAULT_MOBILE_OWNER_VOICE_PROFILE;
let hydrationPromise: Promise<MobileOwnerVoiceProfile> | null = null;
const listeners = new Set<(profile: MobileOwnerVoiceProfile) => void>();

function isStyle(value: unknown): value is OwnerVoiceStyle {
  return value === 'ACCOUNT' || value === 'HINDI' || value === 'ENGLISH' || value === 'HINDI_BIHAR';
}

function isTone(value: unknown): value is OwnerVoiceTone {
  return value === 'NATURAL' || value === 'LIGHT' || value === 'DEEP';
}

function parse(raw: string | null): MobileOwnerVoiceProfile {
  if (!raw) return DEFAULT_MOBILE_OWNER_VOICE_PROFILE;
  try {
    const value = JSON.parse(raw) as Partial<MobileOwnerVoiceProfile>;
    return {
      style: isStyle(value.style) ? value.style : DEFAULT_MOBILE_OWNER_VOICE_PROFILE.style,
      tone: isTone(value.tone) ? value.tone : DEFAULT_MOBILE_OWNER_VOICE_PROFILE.tone,
      voiceIdentifier:
        typeof value.voiceIdentifier === 'string' && value.voiceIdentifier
          ? value.voiceIdentifier
          : null,
    };
  } catch {
    return DEFAULT_MOBILE_OWNER_VOICE_PROFILE;
  }
}

function publish(profile: MobileOwnerVoiceProfile): void {
  cachedProfile = profile;
  listeners.forEach((listener) => listener(profile));
}

export function getCachedOwnerVoiceProfile(): MobileOwnerVoiceProfile {
  return cachedProfile;
}

export function hydrateOwnerVoiceProfile(): Promise<MobileOwnerVoiceProfile> {
  if (!hydrationPromise) {
    hydrationPromise = getItem(STORAGE_KEY)
      .then((raw) => {
        const profile = parse(raw);
        publish(profile);
        return profile;
      })
      .catch(() => cachedProfile);
  }
  return hydrationPromise;
}

export async function setMobileOwnerVoiceProfile(profile: MobileOwnerVoiceProfile): Promise<void> {
  publish(profile);
  await setItem(STORAGE_KEY, JSON.stringify(profile)).catch(() => {
    // Keep the in-memory preference for this session even if device storage is temporarily unavailable.
  });
}

export function useMobileOwnerVoiceProfile(): MobileOwnerVoiceProfile {
  const [profile, setProfile] = useState<MobileOwnerVoiceProfile>(cachedProfile);

  useEffect(() => {
    const listener = (next: MobileOwnerVoiceProfile) => setProfile(next);
    listeners.add(listener);
    void hydrateOwnerVoiceProfile().then(setProfile);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return profile;
}
