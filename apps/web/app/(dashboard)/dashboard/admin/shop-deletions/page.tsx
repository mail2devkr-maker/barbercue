"use client";

import { useCallback, useEffect, useState } from "react";
import { Role } from "@barbercue/shared";
import { useAuth } from "../../../../../lib/auth-context";
import { apiFetch, ApiError } from "../../../../../lib/api";
import { Button } from "../../../../../components/ui/Button";
import { BLOCKER_TEXT } from "../../../../../components/admin/ShopDeletionRequestDialog";
import styles from "../admin.module.css";

interface DeletionRequest {
  id: string;
  salonId: string;
  shopName: string;
  shopPublicId: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt: string;
  requestedByUserId: string;
  requestedByEmail: string | null;
  decidedAt: string | null;
  decidedByEmail: string | null;
  decisionNote: string | null;
}
interface TrashItem {
  id: string;
  name: string;
  publicId: string;
  softDeletedAt: string;
  restoreEligibleUntil: string;
  statusBeforeSoftDelete: string;
  deletedByEmail: string | null;
  remainingMs: number;
  restoreExpired: boolean;
}
type Tab = "PENDING" | "RESOLVED" | "TRASH";
type Action = {
  kind: "approve" | "reject" | "restore";
  id: string;
  label: string;
};

const when = (v: string | null) =>
  v
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(v))
    : "—";
const daysLeft = (ms: number) => Math.max(0, Math.ceil(ms / 86_400_000));

/**
 * Issue #381 — Super Admin: decide Co-Founder deletion requests and restore shops from recovery
 * Trash. Every decision needs a CURRENT authenticator code (each code works once) and the server
 * re-checks the two-person rule, open obligations and the 30-day window.
 */
export default function ShopDeletionsPage() {
  const { user } = useAuth();
  const superAdmin = !!user && user.roles.includes(Role.PLATFORM_ADMIN);
  const [tab, setTab] = useState<Tab>("PENDING");
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "TRASH") {
        setTrash(
          (await apiFetch<{ items: TrashItem[] }>("admin/shop-deletions/trash"))
            .items,
        );
      } else {
        setRequests(
          (
            await apiFetch<{ items: DeletionRequest[] }>(
              `admin/shop-deletions/requests?status=${tab}`,
            )
          ).items,
        );
      }
      setError(null);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not load shop deletions.",
      );
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  function open(next: Action) {
    setAction(next);
    setCode("");
    setNote("");
    setError(null);
    setNotice(null);
  }

  const noteOk = action?.kind !== "reject" || note.trim().length >= 5;
  const canSubmit = !!action && /^\d{6}$/.test(code) && noteOk && !busy;

  async function submit() {
    if (!action || !canSubmit) return;
    setBusy(true);
    setError(null);
    const path =
      action.kind === "restore"
        ? `admin/shop-deletions/trash/${action.id}/restore`
        : `admin/shop-deletions/requests/${action.id}/${action.kind}`;
    const body =
      action.kind === "restore"
        ? { totpCode: code }
        : { totpCode: code, ...(note.trim() ? { note: note.trim() } : {}) };
    try {
      const result = await apiFetch<{
        restoreEligibleUntil?: string;
        status?: string;
      }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setNotice(
        action.kind === "approve"
          ? `${action.label} moved to recovery Trash. It can be restored until ${when(result.restoreEligibleUntil ?? null)}.`
          : action.kind === "reject"
            ? `Request for ${action.label} rejected. The shop is unchanged.`
            : `${action.label} restored (status ${result.status ?? "updated"}).`,
      );
      setAction(null);
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        const blockers = (e.details as { blockers?: string[] } | undefined)
          ?.blockers;
        setError(
          blockers?.length
            ? `${e.message} (${blockers.map((b) => BLOCKER_TEXT[b] ?? b).join("; ")})`
            : e.message,
        );
      } else {
        setError("The action did not complete. Nothing was changed.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (user && !superAdmin) {
    return (
      <main className={styles.page}>
        <p className={styles.error} role="alert">
          Only a Super Admin can decide shop deletions.
        </p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            Two-person control · fresh authenticator code
          </p>
          <h1>Shop deletions</h1>
          <p>
            Co-Founder requests wait here. Approving moves a shop to recovery
            Trash: it is suspended and read-only, nothing is deleted, and a
            Super Admin can restore it for 30 days. You cannot decide a request
            you made yourself.
          </p>
        </div>
      </header>

      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        role="tablist"
        aria-label="Shop deletion views"
      >
        {(["PENDING", "RESOLVED", "TRASH"] as Tab[]).map((t) => (
          <Button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            variant={tab === t ? "primary" : "outline"}
            onClick={() => setTab(t)}
          >
            {t === "PENDING"
              ? "Waiting for decision"
              : t === "RESOLVED"
                ? "Decided"
                : "Recovery Trash"}
          </Button>
        ))}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.success} role="status">
          {notice}
        </p>
      )}

      {action && (
        <section className={styles.section} aria-label="Confirm decision">
          <div className={styles.sectionHeader}>
            <h2>
              {action.kind === "approve"
                ? "Approve deletion of"
                : action.kind === "reject"
                  ? "Reject request for"
                  : "Restore"}{" "}
              {action.label}
            </h2>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              maxWidth: 420,
            }}
          >
            <label htmlFor="sd-code">Current 6-digit authenticator code</label>
            <input
              id="sd-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            {action.kind !== "restore" && (
              <>
                <label htmlFor="sd-note">
                  {action.kind === "reject"
                    ? "Reason for rejecting (required)"
                    : "Note (optional)"}
                </label>
                <textarea
                  id="sd-note"
                  rows={2}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAction(null)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => void submit()}
                disabled={!canSubmit}
              >
                {busy
                  ? "Working…"
                  : action.kind === "approve"
                    ? "Approve and move to Trash"
                    : action.kind === "reject"
                      ? "Reject request"
                      : "Restore shop"}
              </Button>
            </div>
          </div>
        </section>
      )}

      <section className={styles.section}>
        {loading && (
          <p className={styles.loading} role="status">
            Loading…
          </p>
        )}
        {!loading && tab !== "TRASH" && requests.length === 0 && (
          <p className={styles.empty}>No requests here.</p>
        )}
        {!loading && tab === "TRASH" && trash.length === 0 && (
          <p className={styles.empty}>Recovery Trash is empty.</p>
        )}

        {!loading && tab !== "TRASH" && requests.length > 0 && (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Requested</th>
                  <th>Reason</th>
                  <th>{tab === "PENDING" ? "Decide" : "Decision"}</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.shopName}</strong>
                      <small>{r.shopPublicId}</small>
                    </td>
                    <td>
                      {when(r.requestedAt)}
                      <small>{r.requestedByEmail ?? "Co-Founder"}</small>
                    </td>
                    <td style={{ maxWidth: 320 }}>{r.reason}</td>
                    <td>
                      {r.status === "PENDING" ? (
                        r.requestedByUserId === user?.id ? (
                          <span className={styles.readOnlyBadge}>
                            Your request · another Super Admin must decide
                          </span>
                        ) : (
                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              flexWrap: "wrap",
                            }}
                          >
                            <Button
                              type="button"
                              variant="primary"
                              onClick={() =>
                                open({
                                  kind: "approve",
                                  id: r.id,
                                  label: r.shopName,
                                })
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() =>
                                open({
                                  kind: "reject",
                                  id: r.id,
                                  label: r.shopName,
                                })
                              }
                            >
                              Reject
                            </Button>
                          </div>
                        )
                      ) : (
                        <>
                          <span className={styles.status}>{r.status}</span>
                          <small>
                            {when(r.decidedAt)} ·{" "}
                            {r.decidedByEmail ?? "Super Admin"}
                            {r.decisionNote ? ` · ${r.decisionNote}` : ""}
                          </small>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === "TRASH" && trash.length > 0 && (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Shop</th>
                  <th>Moved to Trash</th>
                  <th>Restore window</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {trash.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.name}</strong>
                      <small>
                        {t.publicId} · was {t.statusBeforeSoftDelete}
                      </small>
                    </td>
                    <td>
                      {when(t.softDeletedAt)}
                      <small>{t.deletedByEmail ?? "Super Admin"}</small>
                    </td>
                    <td>
                      {t.restoreExpired
                        ? "Ended (read-only, kept)"
                        : `${daysLeft(t.remainingMs)} days left · until ${when(t.restoreEligibleUntil)}`}
                    </td>
                    <td>
                      {t.restoreExpired ? (
                        <span className={styles.readOnlyBadge}>
                          Restore window ended
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="primary"
                          onClick={() =>
                            open({ kind: "restore", id: t.id, label: t.name })
                          }
                        >
                          Restore
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
