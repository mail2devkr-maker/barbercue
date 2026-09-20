"use client";

import { useSyncExternalStore } from "react";

// The owner/staff "Voice announcements" preference, lifted out of the two dashboard components
// that each used to keep their own private copy of it (DashboardQueueView's "Voice announcements"
// toggle and OwnerBookingsView's "Booking alerts: Sound" toggle) so a single switch is honoured by
// every voice consumer — including ArrivalAlertOverlay, which is mounted on pages that have no
// toggle of their own. Deliberately the same lifetime the two private copies had: in memory, default
// OFF, reset on a full page load (speech needs a user gesture anyway).
let voiceEnabled = false;
const listeners = new Set<() => void>();

export function getVoiceEnabled(): boolean {
  return voiceEnabled;
}

export function setVoiceEnabled(next: boolean): void {
  if (voiceEnabled === next) return;
  voiceEnabled = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVoiceEnabled(): boolean {
  return useSyncExternalStore(subscribe, getVoiceEnabled, () => false);
}
