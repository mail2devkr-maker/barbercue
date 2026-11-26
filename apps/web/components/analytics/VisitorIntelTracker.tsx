"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { ViEventType, ViModule } from "@barbercue/shared";
import { VI_CONSENT_EVENT } from "../../lib/visitor-intel/consent";
import { viTrack } from "../../lib/visitor-intel/tracker";
import { visitorIntelEnabled } from "../../lib/dashboard-flags";

/**
 * Automatic first-party events: one page_view per route, visible engagement time per page, and a count of
 * uncaught page errors (no message text, no stack, no user input). Everything is consent-gated inside viTrack.
 */
export function VisitorIntelTracker() {
  return visitorIntelEnabled() ? <VisitorIntelTrackerInner /> : null;
}

function VisitorIntelTrackerInner() {
  const pathname = usePathname();
  const search = useSearchParams();
  const visibleSince = useRef<number | null>(null);
  const engaged = useRef(0);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    const flushEngagement = () => {
      if (visibleSince.current != null) engaged.current += Date.now() - visibleSince.current;
      visibleSince.current = document.visibilityState === "visible" ? Date.now() : null;
      if (engaged.current >= 1000 && lastPath.current) viTrack("engagement", { path: lastPath.current, props: { engagedMs: Math.round(engaged.current) } });
      engaged.current = 0;
    };
    flushEngagement();
    lastPath.current = pathname;
    viTrack("page_view", { path: pathname });
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushEngagement();
      else visibleSince.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pathname, search]);

  useEffect(() => {
    let errors = 0;
    const onError = () => {
      // At most 3 per page so a broken loop cannot flood ingestion.
      if (++errors <= 3) viTrack("page_error", { props: { errorCode: "uncaught" } });
    };
    // When consent is given on this page, record the view that was skipped before it.
    const onConsent = () => {
      if (lastPath.current) viTrack("page_view", { path: lastPath.current });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);
    window.addEventListener(VI_CONSENT_EVENT, onConsent);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onError);
      window.removeEventListener(VI_CONSENT_EVENT, onConsent);
    };
  }, []);

  return null;
}

/** Drop-in for server-rendered pages: fires one event when it mounts (e.g. salon_view on a salon profile). */
export function ViTrackEvent(props: { type: ViEventType; entityType?: string; entityId?: string; salonId?: string; module?: ViModule }) {
  const { type, entityType, entityId, salonId, module } = props;
  useEffect(() => {
    viTrack(type, { entityType, entityId, salonId, module });
  }, [type, entityType, entityId, salonId, module]);
  return null;
}
