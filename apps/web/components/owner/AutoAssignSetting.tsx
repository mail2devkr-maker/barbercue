"use client";

import { useCallback, useEffect, useState } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Banner, Card } from "./parts";
import ui from "./owner.module.css";

/**
 * The owner's Automatic Staff Assignment switch for Shop Settings.
 *
 * The SERVER is the source of truth: the switch shows exactly what `GET .../queue/settings` returns
 * (ON for every new shop) and a change is only reflected after the server has accepted it. Nothing is
 * defaulted or remembered in the browser, so the Live Queue, the dashboard, Shop Settings and the
 * Android app can never disagree.
 */
export function AutoAssignSetting({ salonId }: { salonId: string }) {
  const url = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/queue/settings`;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<{ autoAssignEnabled: boolean }>(url)
      .then((r) => {
        setEnabled(r.autoAssignEnabled);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this setting."));
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle() {
    if (enabled === null || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{ autoAssignEnabled: boolean }>(url, { method: "PATCH", body: JSON.stringify({ autoAssignEnabled: !enabled }) });
      setEnabled(result.autoAssignEnabled);
      setNotice(result.autoAssignEnabled ? "Automatic assignment is on." : "Automatic assignment is off.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this setting.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Automatic staff assignment" sub="Who serves the next customer">
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}
      <div className={ui.toggleRow}>
        <div>
          <div className={ui.listTitle} style={{ whiteSpace: "normal" }}>
            Assign staff automatically
          </div>
          <div className={ui.cardSub}>
            On by default. A customer who is in the shop is assigned a free, qualified barber and a free chair as soon as one is available. Assigning does not start the service: the barber presses Start service. Turn it off to choose a barber and chair yourself.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled === true}
          aria-label="Assign staff automatically"
          aria-busy={enabled === null || saving}
          disabled={enabled === null || saving}
          className={`${ui.switch} ${enabled === true ? ui.switchOn : ""}`}
          onClick={() => void toggle()}
        />
      </div>
    </Card>
  );
}
