"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";

interface Props {
  basePath: string;
  activeCount: number;
  onRemoved: (removedCount: number) => Promise<void>;
}

/**
 * Safety: never hard-delete referenced Service rows. This removes all ACTIVE
 * services from future booking/queue options; older bookings and invoices stay
 * attached to the historical, now-inactive service records.
 */
export function RemoveAllServicesControl({ basePath, activeCount, onRemoved }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  async function removeAll() {
    if (saving || completed || confirmation !== "REMOVE ALL" || activeCount === 0) return;
    if (!window.confirm(
      "Turn off ALL " + activeCount + " active services in this shop? " +
      "New customers will no longer be able to book them. Past bookings and " +
      "service history will be preserved. Continue?"
    )) return;
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch<{ removedCount: number; remainingActive: number }>(
        basePath + "/remove-all",
        { method: "POST", body: JSON.stringify({
          confirmation: "REMOVE ALL",
          expectedActiveCount: activeCount,
        }) },
      );
      // The POST already committed: prevent another click even if reloading fails.
      setCompleted(true);
      setConfirmation("");
      setExpanded(false);
      try {
        await onRemoved(result.removedCount);
      } catch {
        setError("Services were turned off, but the list did not refresh. Reload the page. Do not retry.");
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message :
        "Could not confirm service removal. Refresh the list before trying again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="bulk-remove-services-heading"
      style={{ padding: 16, marginTop: 20, border: "1px solid #b45309", borderRadius: 12 }}>
      <h3 id="bulk-remove-services-heading" style={{ margin: "0 0 8px" }}>
        Remove All Services
      </h3>
      <p style={{ margin: "0 0 12px", lineHeight: 1.6 }}>
        This removes all <strong>{activeCount} active services</strong> from future bookings
        in this shop. Nothing is permanently deleted; past bookings, payments and visit
        history remain intact. You can reactivate services later under Turned-off services.
      </p>
      {!expanded ? (
        <Button type="button" variant="outline" disabled={activeCount === 0 || saving || completed}
          onClick={() => { setExpanded(true); setError(null); }}>
          Remove All Services ({activeCount})
        </Button>
      ) : (
        <div>
          <p role="alert" style={{ color: "#b45309", fontWeight: 650 }}>
            You are about to turn off {activeCount} services for this shop. Type
            <strong> REMOVE ALL </strong> to confirm.
          </p>
          <label htmlFor="confirm-remove-all-services" style={{ display: "block", marginBottom: 8 }}>
            Confirmation phrase
          </label>
          <input
            id="confirm-remove-all-services"
            autoComplete="off"
            spellCheck={false}
            value={confirmation}
            disabled={saving}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="REMOVE ALL"
            style={{ padding: 10, border: "1px solid var(--bc-border)", borderRadius: 8,
              background: "var(--bc-surface)", color: "var(--bc-ink)" }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <Button type="button" variant="outline" disabled={saving}
              onClick={() => { setExpanded(false); setConfirmation(""); setError(null); }}>
              Cancel
            </Button>
            <Button type="button" variant="secondary"
              disabled={saving || completed || confirmation !== "REMOVE ALL" || activeCount === 0}
              onClick={() => void removeAll()}>
              {saving ? "Removing…" : "Confirm Remove All (" + activeCount + ")"}
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
    </section>
  );
}
