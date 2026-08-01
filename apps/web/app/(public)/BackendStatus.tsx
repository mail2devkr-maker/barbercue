"use client";

import { useEffect, useState } from "react";
import { HEALTH_PATH, type HealthCheckResponse } from "@barbercue/shared";

type Status = "checking" | "healthy" | "offline";

// Phase 1.5 foundation-integration check only — proves web -> backend network calls and the
// shared package's HealthCheckResponse/HEALTH_PATH work end to end. Not a real health dashboard.
export default function BackendStatus() {
  const [status, setStatus] = useState<Status>(() =>
    process.env.NEXT_PUBLIC_API_BASE_URL ? "checking" : "offline",
  );

  useEffect(() => {
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (!baseUrl) return;

    let cancelled = false;

    fetch(`${baseUrl}/${HEALTH_PATH}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HealthCheckResponse>;
      })
      .then((body) => {
        if (!cancelled) setStatus(body.status === "ok" ? "healthy" : "offline");
      })
      .catch(() => {
        if (!cancelled) setStatus("offline");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <p style={{ marginTop: 24, fontFamily: "monospace" }}>
      Backend Status:{" "}
      <strong style={{ color: status === "healthy" ? "#3B6D11" : status === "offline" ? "#E24B4A" : "#888" }}>
        {status === "checking" ? "Checking..." : status === "healthy" ? "Healthy" : "Backend Offline"}
      </strong>
    </p>
  );
}
