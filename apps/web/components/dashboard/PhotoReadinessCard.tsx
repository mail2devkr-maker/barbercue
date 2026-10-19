"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { describePhotoReadiness, parsePhotoReadiness, type PhotoReadiness } from "../../lib/photo-readiness";
import styles from "./dashboard.module.css";

/**
 * The new-shop photo requirement for the Photos page: how many of the three photos the server counts, or why the rule
 * does not apply. It re-reads after every change to the photo list. If the server cannot answer (for example it does not
 * have this feature yet) nothing is shown: the page never invents a count.
 */
export function PhotoReadinessCard({ salonId, photoCount }: { salonId: string; photoCount: number }) {
  const [readiness, setReadiness] = useState<PhotoReadiness | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<unknown>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.photoReadiness}`)
      .then((raw) => {
        if (!cancelled) setReadiness(parsePhotoReadiness(raw));
      })
      .catch(() => {
        if (!cancelled) setReadiness(null);
      });
    return () => {
      cancelled = true;
    };
  }, [salonId, photoCount]);

  if (!readiness) return null;
  const view = describePhotoReadiness(readiness);
  return (
    <section aria-label="Photos needed to open your shop" className={`${styles.banner} ${view.tone === "warn" ? styles.bannerWarning : ""}`}>
      <strong>{view.title}</strong>
      {!readiness.grandfathered && (
        <progress value={view.counted} max={view.required} aria-label={`${view.counted} of ${view.required} photos`} style={{ display: "block", width: "100%", marginTop: 8 }} />
      )}
      <p style={{ margin: "8px 0 0" }}>{view.body}</p>
    </section>
  );
}
