"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_PATHS, type SalonIntakeDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Banner, Card } from "./parts";
import ui from "./owner.module.css";

const ROWS = [
  { key: "queuePaused", label: "Live queue", on: "Customers can join the live queue.", off: "Closed: customers cannot join. People already waiting keep their place, and you can still add customers yourself." },
  { key: "bookingsPaused", label: "Online booking", on: "Customers can book appointments online.", off: "Closed: no new online bookings. Existing bookings stay, and you can still add in-shop appointments." },
] as const;

/** Stop new queue joins or online bookings while the shop stays open. The server is the source of truth. */
export function IntakeControls({ salonId }: { salonId: string }) {
  const url = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.intake}`;
  const [data, setData] = useState<SalonIntakeDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<SalonIntakeDto>(url)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : "Could not load this setting."));
    return () => {
      alive = false;
    };
  }, [url]);

  async function toggle(key: keyof SalonIntakeDto) {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      setData(await apiFetch<SalonIntakeDto>(url, { method: "PATCH", body: JSON.stringify({ [key]: !data[key] }) }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this setting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Open or close queue and booking" sub="Your shop stays open and visible to customers">
      {error && <Banner tone="error">{error}</Banner>}
      {ROWS.map((r) => {
        const accepting = data ? !data[r.key] : false;
        return (
          <div key={r.key} className={ui.toggleRow}>
            <div>
              <div className={ui.listTitle} style={{ whiteSpace: "normal" }}>
                {r.label}: {data ? (accepting ? "Open" : "Closed") : "…"}
              </div>
              <div className={ui.cardSub}>{data ? (accepting ? r.on : r.off) : "Loading…"}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={accepting}
              aria-label={`${r.label} open for customers`}
              className={`${ui.switch} ${accepting ? ui.switchOn : ""}`}
              disabled={!data || busy}
              onClick={() => void toggle(r.key)}
            />
          </div>
        );
      })}
    </Card>
  );
}
