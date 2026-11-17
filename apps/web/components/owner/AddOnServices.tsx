"use client";

import { useState } from "react";
import { DASHBOARD_PATHS, MAX_QUEUE_ADD_ONS } from "@barbercue/shared";
import type { QueueEntryDetailDto, ServiceOptionDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { Btn } from "./parts";
import ui from "./owner.module.css";

/**
 * Live-visit add-on mission (17 Nov 2026). The customer asks for one more service at the shop (beard,
 * head massage...): the owner or barber adds it to the live visit. The server then lengthens this
 * visit, recomputes everyone's wait, keeps the barber reserved for it and bills it on the invoice.
 * Only services that are not already part of the visit are offered.
 */
export function AddOnServices({
  entry,
  services,
  disabled,
  onChanged,
}: {
  entry: QueueEntryDetailDto;
  services: ServiceOptionDto[];
  disabled?: boolean;
  onChanged: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addOns = entry.addOns ?? [];
  const taken = new Set<string>([...(entry.serviceId ? [entry.serviceId] : []), ...addOns.map((a) => a.serviceId)]);
  // An appointment's own services are not listed on the entry; the server refuses them (409) and the
  // message below explains it, so nothing is silently double-billed.
  const choices = services.filter((s) => !taken.has(s.id));
  const atLimit = addOns.length >= MAX_QUEUE_ADD_ONS;
  const path = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.queueEntries}/${entry.id}/${DASHBOARD_PATHS.addOns}`;

  async function add() {
    if (!serviceId || busy) return;
    const chosen = services.find((s) => s.id === serviceId);
    setBusy(true);
    setError(null);
    try {
      await apiFetch(path, {
        method: "POST",
        headers: { "Idempotency-Key": newIdempotencyKey() },
        body: JSON.stringify({ serviceId }),
      });
      setOpen(false);
      setServiceId("");
      onChanged(`${chosen?.name ?? "Service"} added. Waiting times are updated.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add this service.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(addOnServiceId: string, name: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${path}/${addOnServiceId}`, { method: "DELETE" });
      onChanged(`${name} removed. Waiting times are updated.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove this service.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={ui.addOns} data-testid={`add-ons-${entry.id}`}>
      {addOns.length > 0 && (
        <div className={ui.addOnList} aria-label="Services added at the shop">
          {addOns.map((a) => (
            <span key={a.serviceId} className={ui.addOnChip}>
              + {a.name} · {a.durationMinutes} min
              <button
                type="button"
                className={ui.addOnRemove}
                aria-label={`Remove ${a.name}`}
                disabled={disabled || busy}
                onClick={() => void remove(a.serviceId, a.name)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {open ? (
        <div className={ui.addOnForm}>
          <select
            aria-label="Service to add"
            className={ui.select}
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            disabled={busy}
          >
            <option value="">Choose a service…</option>
            {choices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.durationMinutes ? ` · ${s.durationMinutes} min` : ""}
                {typeof s.price === "number" ? ` · ₹${s.price}` : ""}
              </option>
            ))}
          </select>
          <Btn small variant="primary" disabled={!serviceId || busy} onClick={() => void add()}>
            {busy ? "Adding…" : "Add"}
          </Btn>
          <Btn small variant="quiet" disabled={busy} onClick={() => { setOpen(false); setServiceId(""); setError(null); }}>
            Close
          </Btn>
        </div>
      ) : (
        <Btn small icon="plus" disabled={disabled || busy || atLimit || choices.length === 0} onClick={() => setOpen(true)}>
          Add service
        </Btn>
      )}
      {error && (
        <div className={ui.entryReason} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** "Haircut + Beard Trim" — the visit's own service(s) followed by anything added at the shop. */
export function visitServiceLabel(entry: QueueEntryDetailDto): string | null {
  const base = entry.serviceName;
  const added = (entry.addOns ?? []).map((a) => a.name);
  if (!base && added.length === 0) return null;
  return [base, ...added].filter(Boolean).join(" + ");
}
