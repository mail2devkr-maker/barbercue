"use client";

import { useEffect, useState } from "react";
import { MAINTENANCE_COPY, MAINTENANCE_RETRY_MS } from "@barbercue/shared";
import { onMaintenance } from "../../lib/maintenance";

/**
 * Full-screen "under maintenance" notice shown while the backend is unreachable (for example during
 * the Neon CU guard's database switch). Polls the API health every 15 s and disappears by itself.
 */
export function MaintenanceOverlay() {
  const [down, setDown] = useState(false);

  useEffect(() => {
    // One failed or timed-out request (a slow admin report, a cold database) is not an outage:
    // confirm with the health check first and only cover the page when the backend really is down.
    let checking = false;
    return onMaintenance(() => {
      if (checking) return;
      checking = true;
      void confirmBackendDown().then((isDown) => {
        checking = false;
        if (isDown) setDown(true);
      });
    });
  }, []);

  useEffect(() => {
    if (!down) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/v1/health", { cache: "no-store" });
        if (res.ok) {
          setDown(false);
          window.location.reload();
        }
      } catch {
        /* still down */
      }
    }, MAINTENANCE_RETRY_MS);
    return () => clearInterval(id);
  }, [down]);

  if (!down) return null;
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-labelledby="fq-maint-title"
      style={{
        position: "fixed", inset: 0, zIndex: 2147483000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, background: "rgba(9,9,12,0.92)", color: "#f7f5f4", textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 460 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden="true">🛠️</div>
        <h2 id="fq-maint-title" style={{ fontSize: 24, margin: "0 0 8px" }}>{MAINTENANCE_COPY.EN.title}</h2>
        <p style={{ margin: "0 0 16px", lineHeight: 1.5 }}>{MAINTENANCE_COPY.EN.body}</p>
        <h2 style={{ fontSize: 20, margin: "0 0 8px" }}>{MAINTENANCE_COPY.HI.title}</h2>
        <p style={{ margin: 0, lineHeight: 1.5 }}>{MAINTENANCE_COPY.HI.body}</p>
      </div>
    </div>
  );
}

async function healthOk(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch("/api/v1/health", { cache: "no-store", signal: ctl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** True only when two health checks, a few seconds apart, both fail. */
export async function confirmBackendDown(): Promise<boolean> {
  if (await healthOk()) return false;
  await new Promise((r) => setTimeout(r, 3000));
  return !(await healthOk());
}
