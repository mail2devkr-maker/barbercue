"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "../../lib/api";
import { Banner, Btn, Dialog } from "../owner/parts";
import styles from "../dashboard/dashboard.module.css";

export interface ShopDeletionPreview {
  shop: {
    id: string;
    name: string;
    publicId: string;
    status: string;
    inTrash: boolean;
    restoreEligibleUntil: string | null;
  };
  keptRecords: {
    chairs: number;
    services: number;
    staff: number;
    bookings: number;
  };
  blockers: string[];
  pendingRequest: { id: string; requestedAt: string } | null;
  recoveryWindowDays: number;
  consequences: string[];
}

export const BLOCKER_TEXT: Record<string, string> = {
  PENDING_OR_CONFIRMED_BOOKING: "Upcoming or unpaid bookings",
  ACTIVE_QUEUE_ENTRY:
    "Customers waiting, called or in service in the live queue",
  ACTIVE_SERVICE_SESSION: "A service session in progress",
  ACTIVE_MANUAL_CHAIR_OCCUPANCY: "A chair marked occupied",
  PENDING_PAYMENT: "A payment still in progress",
  PENDING_REFUND: "A refund still in progress",
  OUTSTANDING_CUSTOMER_LEDGER: "Customer charges not yet settled",
  OUTSTANDING_PLATFORM_SUBSIDY: "Platform subsidy not yet settled",
};

/**
 * Issue #381 — Co-Founder: request that a shop be moved to recovery Trash. Opening the dialog changes
 * nothing; it shows exactly what would happen. Submitting only QUEUES a request: a different Super
 * Admin must approve it with a fresh authenticator code, and the shop stays restorable for 30 days.
 */
export function ShopDeletionRequestDialog({
  salonId,
  onClose,
  onRequested,
}: {
  salonId: string;
  onClose: () => void;
  onRequested: (shopName: string) => void;
}) {
  const [preview, setPreview] = useState<ShopDeletionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch<ShopDeletionPreview>(`admin/shops/${salonId}/deletion-preview`)
      .then((p) => live && setPreview(p))
      .catch(
        (e) =>
          live &&
          setError(
            e instanceof ApiError
              ? e.message
              : "Could not load this shop. Nothing was changed.",
          ),
      );
    return () => {
      live = false;
    };
  }, [salonId]);

  const norm = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();
  const nameMatches = !!preview && norm(typed) === norm(preview.shop.name);
  const blocked =
    !!preview && (preview.shop.inTrash || !!preview.pendingRequest);
  const canSubmit =
    !!preview &&
    !blocked &&
    nameMatches &&
    reason.trim().length >= 10 &&
    ack &&
    !busy;

  async function submit() {
    if (!canSubmit || !preview) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`admin/shops/${salonId}/deletion-requests`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim(), typedShopName: typed }),
      });
      onRequested(preview.shop.name);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Could not send the request. Nothing was changed.",
      );
      setBusy(false);
    }
  }

  return (
    <Dialog title="Request shop deletion" onClose={onClose}>
      {!preview && !error && (
        <p className={styles.loadingText}>Checking this shop…</p>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      {preview && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0 }}>
            <strong>{preview.shop.name}</strong> · {preview.shop.publicId} ·{" "}
            {preview.shop.status}
          </p>
          {preview.shop.inTrash && (
            <Banner tone="info">This shop is already in recovery Trash.</Banner>
          )}
          {preview.pendingRequest && (
            <Banner tone="info">
              A deletion request for this shop is already waiting for Super
              Admin approval.
            </Banner>
          )}
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {preview.consequences.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p style={{ margin: 0, fontSize: 14 }}>
            Kept: {preview.keptRecords.chairs} chairs ·{" "}
            {preview.keptRecords.services} services ·{" "}
            {preview.keptRecords.staff} staff · {preview.keptRecords.bookings}{" "}
            bookings
          </p>
          {preview.blockers.length > 0 && (
            <Banner tone="warn">
              Approval will be refused until these are resolved:{" "}
              {preview.blockers.map((b) => BLOCKER_TEXT[b] ?? b).join("; ")}.
            </Banner>
          )}
          {!blocked && (
            <>
              <label className={styles.fieldLabel} htmlFor="shop-delete-reason">
                Reason (at least 10 characters, shown to the approving Super
                Admin)
              </label>
              <textarea
                id="shop-delete-reason"
                className={styles.input}
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(ev) => setReason(ev.target.value)}
              />
              <label className={styles.fieldLabel} htmlFor="shop-delete-name">
                Type <strong>{preview.shop.name}</strong> to confirm
              </label>
              <input
                id="shop-delete-name"
                className={styles.input}
                value={typed}
                autoComplete="off"
                onChange={(ev) => setTyped(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") ev.preventDefault();
                }}
              />
              <label
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  fontSize: 14,
                }}
              >
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(ev) => setAck(ev.target.checked)}
                />
                <span>
                  I understand that, if a Super Admin approves,{" "}
                  {preview.shop.name} will be suspended and hidden from
                  customers, and can be restored for{" "}
                  {preview.recoveryWindowDays} days.
                </span>
              </label>
            </>
          )}
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <Btn variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Btn>
            {!blocked && (
              <Btn
                variant="danger"
                onClick={() => void submit()}
                disabled={!canSubmit}
              >
                {busy ? "Sending…" : "Send request for approval"}
              </Btn>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
