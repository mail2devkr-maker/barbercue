"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";

interface Props {
  basePath: string;
  activeCount: number;
  totalCount: number;
  onRemoved: (removedCount: number) => Promise<void>;
}

/**
 * Physical reset is forbidden if any service is referenced by booking, queue,
 * or service-session history. Only unreferenced records can be deleted.
 */
export function RemoveAllServicesControl({ basePath, activeCount, totalCount, onRemoved }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  async function removeAll() {
    if (saving || completed || confirmation !== "DELETE ALL" || totalCount === 0) return;
    if (!window.confirm(
      "PERMANENTLY DELETE ALL " + totalCount + " services (including " +
      (totalCount - activeCount) + " turned-off services) in this shop? " +
      "You cannot undo this. If any service is used in booking or visit history, " +
      "the deletion will be blocked without modifying anything. Continue?"
    )) return;
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch<{ deletedCount: number; remainingCount: number }>(
        basePath + "/delete-all",
        { method: "POST", body: JSON.stringify({
          confirmation: "DELETE ALL",
          expectedTotalCount: totalCount,
        }) },
      );
      // The POST already committed: prevent another click even if reloading fails.
      setCompleted(true);
      setConfirmation("");
      setExpanded(false);
      try {
        await onRemoved(result.deletedCount);
      } catch {
        setError("Services were deleted, but the list did not refresh. Reload the page. Do not retry.");
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message :
        "Could not verify service deletion. Refresh before retrying; no retry is automatic.");
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
        Permanently remove all <strong>{totalCount} services</strong> from this shop
        ({activeCount} active, {totalCount - activeCount} turned off) so you can import a fresh
        catalog without existing-name conflicts. This cannot be undone. If any services
        are referenced by past bookings, queues or visit history, the server will block
        the entire deletion to protect those records. No other shop is affected.
      </p>
      {!expanded ? (
        <Button type="button" variant="outline" disabled={totalCount === 0 || saving || completed}
          onClick={() => { setExpanded(true); setError(null); }}>
          Remove All Services ({totalCount})
        </Button>
      ) : (
        <div>
          <p role="alert" style={{ color: "#b45309", fontWeight: 650 }}>
            You are about to permanently delete {totalCount} services, including inactive services.
            Type <strong> DELETE ALL </strong> to confirm. Existing booking history will never be erased.
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
            placeholder="DELETE ALL"
            style={{ padding: 10, border: "1px solid var(--bc-border)", borderRadius: 8,
              background: "var(--bc-surface)", color: "var(--bc-ink)" }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <Button type="button" variant="outline" disabled={saving}
              onClick={() => { setExpanded(false); setConfirmation(""); setError(null); }}>
              Cancel
            </Button>
            <Button type="button" variant="secondary"
              disabled={saving || completed || confirmation !== "DELETE ALL" || totalCount === 0}
              onClick={() => void removeAll()}>
              {saving ? "Removing…" : "Confirm Permanent Delete (" + totalCount + ")"}
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
    </section>
  );
}
