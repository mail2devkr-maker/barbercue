"use client";

import { useEffect, useRef } from "react";
import type { AssistantResource } from "@barbercue/shared";

// After the server confirms an Action Assistant change, the drawer announces which screens' data
// changed; any open page for that resource reloads from the API (never from the assistant's reply).
const EVENT = "fastque:assistant-changed";

export function announceAssistantChange(resources: AssistantResource[]): void {
  if (typeof window === "undefined" || resources.length === 0) return;
  window.dispatchEvent(new CustomEvent<AssistantResource[]>(EVENT, { detail: resources }));
}

export function useAssistantRefresh(resource: AssistantResource, reload: () => void): void {
  const latest = useRef(reload);
  useEffect(() => {
    latest.current = reload;
  }, [reload]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = (event: Event) => {
      const changed = (event as CustomEvent<AssistantResource[]>).detail ?? [];
      if (changed.includes(resource)) latest.current();
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [resource]);
}
