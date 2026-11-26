"use client";

import { VI_CONSENT_POLICY_VERSION, VI_CONSENT_STORAGE_KEY, VI_PATHS } from "@barbercue/shared";

/**
 * Cookie / tracking consent (docs/visitor-intelligence/README.md (PRIVACY)). Nothing non-essential is collected until
 * the visitor chooses. The choice is stored in this browser only and sent (with a pseudonymous id, no IP)
 * so FastQue can show it was given. Withdrawing is as easy as giving: "Cookie preferences" in the footer.
 */
export interface ViConsent {
  analytics: boolean;
  marketing: boolean;
  version: string;
  at: string;
}

export const VI_CONSENT_EVENT = "fastque:consent-changed";
export const VI_OPEN_PREFERENCES_EVENT = "fastque:open-cookie-preferences";

export function readConsent(): ViConsent | null {
  try {
    const raw = window.localStorage.getItem(VI_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ViConsent>;
    // A new policy version asks again.
    if (v.version !== VI_CONSENT_POLICY_VERSION || typeof v.analytics !== "boolean") return null;
    return { analytics: v.analytics, marketing: !!v.marketing, version: v.version, at: v.at ?? "" };
  } catch {
    return null;
  }
}

export function saveConsent(analytics: boolean, marketing: boolean, visitorId: string, source: "BANNER" | "PREFERENCES"): ViConsent {
  const value: ViConsent = { analytics, marketing, version: VI_CONSENT_POLICY_VERSION, at: new Date().toISOString() };
  try {
    window.localStorage.setItem(VI_CONSENT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage blocked: the choice still applies to this page view.
  }
  void fetch(`/api/v1/${VI_PATHS.root}/${VI_PATHS.consent}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitorId, analytics: value.analytics, marketing: value.marketing, policyVersion: VI_CONSENT_POLICY_VERSION, source }),
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => undefined);
  window.dispatchEvent(new CustomEvent(VI_CONSENT_EVENT, { detail: value }));
  return value;
}

export function openCookiePreferences(): void {
  window.dispatchEvent(new Event(VI_OPEN_PREFERENCES_EVENT));
}
