"use client";

import { useEffect, useState } from "react";
import {
  DASHBOARD_PATHS,
  PERMANENT_DELETION_PATHS,
  type PermanentDeletionKind,
  type PermanentDeletionPreviewDto,
  type PermanentDeletionResultDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Banner, Btn, Dialog } from "../owner/parts";
import styles from "./dashboard.module.css";

const PATH: Record<PermanentDeletionKind, string> = { chair: DASHBOARD_PATHS.chairs, staff: DASHBOARD_PATHS.staff };
const NOUN: Record<PermanentDeletionKind, string> = { chair: "chair", staff: "staff member" };

/**
 * Issue #378: permanent deletion of ONE chair or ONE staff member. Opening the dialog changes
 * nothing: it asks the server for a preview (exact target, shop, effects, and either a single-use
 * confirmation or the reasons deletion is blocked). Confirm Delete stays disabled until the exact
 * name is typed AND the irreversible-action box is ticked; the server checks both again.
 */
export function PermanentDeleteDialog({
  kind,
  salonId,
  targetId,
  onClose,
  onDeleted,
}: {
  kind: PermanentDeletionKind;
  salonId: string;
  targetId: string;
  onClose: () => void;
  onDeleted: (result: PermanentDeletionResultDto) => void;
}) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${PATH[kind]}/${targetId}`;
  const [preview, setPreview] = useState<PermanentDeletionPreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    apiFetch<PermanentDeletionPreviewDto>(`${base}/${PERMANENT_DELETION_PATHS.preview}`, { method: "POST" })
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setError(null);
      })
      .catch((e) => {
        if (live) setError(e instanceof ApiError ? e.message : "Could not check this record. Nothing was deleted.");
      });
    return () => {
      live = false;
    };
  }, [base, round]);

  const matches = !!preview && typed.trim() === preview.confirmName.trim();
  const canConfirm = !!preview?.deletable && !!preview.token && matches && ack && !busy;

  async function confirm() {
    if (!canConfirm || !preview?.token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<PermanentDeletionResultDto>(`${base}/${PERMANENT_DELETION_PATHS.confirm}`, {
        method: "POST",
        body: JSON.stringify({ token: preview.token, typedName: typed, acknowledged: true }),
      });
      onDeleted(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete. Nothing was deleted.");
      setBusy(false);
    }
  }

  function startOver() {
    setPreview(null);
    setTyped("");
    setAck(false);
    setBusy(false);
    setRound((r) => r + 1);
  }

  return (
    <Dialog title={`Delete ${NOUN[kind]} permanently`} onClose={onClose}>
      {!preview && !error && <p className={styles.loadingText}>Checking whether this can be deleted…</p>}
      {error && (
        <>
          <Banner tone="error">{error}</Banner>
          {preview && (
            <p style={{ marginTop: 8 }}>
              <Btn variant="secondary" small onClick={startOver}>
                Check again
              </Btn>
            </p>
          )}
        </>
      )}
      {preview && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0 }}>
            <strong>{preview.target.name}</strong> · {preview.salon.name}
          </p>
          {preview.deletable ? (
            <>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                {preview.effects.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              <Banner tone="warn">This cannot be undone.</Banner>
              <label className={styles.fieldLabel} htmlFor="permanent-delete-name">
                Type <strong>{preview.confirmName}</strong> to confirm
              </label>
              <input
                id="permanent-delete-name"
                className={styles.input}
                value={typed}
                autoComplete="off"
                onChange={(ev) => setTyped(ev.target.value)}
                onKeyDown={(ev) => {
                  // Enter alone never deletes.
                  if (ev.key === "Enter") ev.preventDefault();
                }}
              />
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14 }}>
                <input type="checkbox" checked={ack} onChange={(ev) => setAck(ev.target.checked)} />
                <span>I understand that {preview.target.name} will be deleted permanently and cannot be restored.</span>
              </label>
            </>
          ) : (
            <>
              <Banner tone="info">This {NOUN[kind]} cannot be permanently deleted, so nothing will be deleted:</Banner>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                {preview.blockers.map((b) => (
                  <li key={b.code}>{b.message}</li>
                ))}
              </ul>
              {preview.alternative && <p style={{ margin: 0, fontSize: 14 }}>{preview.alternative}</p>}
            </>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Btn variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Btn>
            {preview.deletable && (
              <Btn variant="danger" onClick={() => void confirm()} disabled={!canConfirm}>
                {busy ? "Deleting…" : "Confirm Delete"}
              </Btn>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
