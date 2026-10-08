"use client";

import { useCallback, useEffect, useState } from "react";
import { Role } from "@barbercue/shared";
import { useAuth } from "../../../../../lib/auth-context";
import { apiFetch, ApiError } from "../../../../../lib/api";
import { Button, LinkButton } from "../../../../../components/ui/Button";
import styles from "../admin.module.css";

type DeletionRequest = {
  id: string;
  salonId: string;
  shopName: string;
  shopPublicId: string;
  requestedByUserId: string;
  requestedByEmail?: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
};
type RequestDetail = DeletionRequest & {
  reason: string;
  decisionNote: string | null;
};
type Page<T> = { items: T[]; nextCursor: string | null };
type TrashShop = {
  id: string;
  name: string;
  publicId: string;
  status: string;
  softDeletedAt: string | null;
  restoreEligibleUntil: string | null;
  deletedByEmail: string | null;
  softDeletedByUserId: string | null;
  softDeletionRequestId: string | null;
  statusBeforeSoftDelete: string | null;
  remainingMs: number;
  restoreExpired: boolean;
};
type AuditEvent = {
  id: string;
  at: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
};
type AuditPage = Page<AuditEvent>;

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : "—";
}
function errText(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "The request failed. Please retry.";
}
function remaining(ms: number) {
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${days}d ${hours}h ${minutes}m`;
}

export default function AdminSecurityPage() {
  const { user } = useAuth();
  const allowed = !!user?.roles.includes(Role.PLATFORM_ADMIN);
  const [pending, setPending] = useState<DeletionRequest[]>([]);
  const [history, setHistory] = useState<DeletionRequest[]>([]);
  const [trash, setTrash] = useState<TrashShop[]>([]);
  const [pendingCursor, setPendingCursor] = useState<string | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [trashCursor, setTrashCursor] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [actorEmail, setActorEmail] = useState("");
  const [action, setAction] = useState("");
  const [activeFilters, setActiveFilters] = useState({
    actorEmail: "",
    action: "",
  });
  const [details, setDetails] = useState<RequestDetail | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [totpCodes, setTotpCodes] = useState<Record<string, string>>({});
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError(null);
    try {
      const auditParams = new URLSearchParams();
      if (activeFilters.actorEmail)
        auditParams.set("actorEmail", activeFilters.actorEmail);
      if (activeFilters.action) auditParams.set("action", activeFilters.action);
      const [pendingPage, historyPage, trashPage, auditPage] =
        await Promise.all([
          apiFetch<Page<DeletionRequest>>(
            "admin/security/deletion-requests?status=PENDING",
          ),
          apiFetch<Page<DeletionRequest>>(
            "admin/security/deletion-requests?status=RESOLVED",
          ),
          apiFetch<Page<TrashShop>>("admin/security/deletion-trash"),
          apiFetch<AuditPage>(`admin/security/audit?${auditParams.toString()}`),
        ]);
      setPending(pendingPage.items);
      setPendingCursor(pendingPage.nextCursor);
      setHistory(historyPage.items);
      setHistoryCursor(historyPage.nextCursor);
      setTrash(trashPage.items);
      setTrashCursor(trashPage.nextCursor);
      setAudit(auditPage.items);
      setAuditCursor(auditPage.nextCursor);
    } catch (loadError) {
      setError(errText(loadError));
    } finally {
      setLoading(false);
    }
  }, [allowed, activeFilters]);

  useEffect(() => {
    if (!allowed) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [allowed, load]);

  async function loadMore<T>(
    endpoint: string,
    cursor: string | null,
    append: (items: T[]) => void,
    updateCursor: (next: string | null) => void,
  ) {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await apiFetch<Page<T>>(
        `${endpoint}${endpoint.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`,
      );
      append(page.items);
      updateCursor(page.nextCursor);
    } catch (loadError) {
      setError(errText(loadError));
    } finally {
      setLoadingMore(false);
    }
  }

  async function openDetails(request: DeletionRequest) {
    setError(null);
    try {
      const detail = await apiFetch<RequestDetail>(
        `admin/security/deletion-requests/${request.id}/detail`,
      );
      setDetails(detail);
    } catch (loadError) {
      setError(errText(loadError));
    }
  }

  async function resolveRequest(request: DeletionRequest, approve: boolean) {
    if (!allowed || workingId) return;
    const code = totpCodes[request.id] ?? "";
    const note = (decisionNotes[request.id] ?? "").trim();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter your current 6-digit Super Admin authenticator code.");
      return;
    }
    if (note.length > 500 || (!approve && note.length < 5)) {
      setError(
        approve
          ? "Decision note cannot exceed 500 characters."
          : "Rejection reason must be 5–500 characters.",
      );
      return;
    }
    const explanation = approve
      ? `Move "${request.shopName}" (${request.shopPublicId}) to recovery Trash? It will be hidden and unavailable. A Super Admin can restore it for 30 full days. No records or assets will be permanently deleted.`
      : `Reject the deletion request for "${request.shopName}"? The shop will remain unchanged.`;
    if (!window.confirm(explanation)) return;

    setWorkingId(request.id);
    setNotice(null);
    setError(null);
    try {
      if (approve) {
        const result = await apiFetch<{
          shopName: string;
          restoreEligibleUntil: string;
        }>(`admin/security/deletion-requests/${request.id}/approve`, {
          method: "POST",
          body: JSON.stringify({ totpCode: code, note }),
        });
        setNotice(
          `"${result.shopName}" moved to Trash. Restore is available until ${fmt(result.restoreEligibleUntil)}.`,
        );
      } else {
        await apiFetch(
          `admin/security/deletion-requests/${request.id}/reject`,
          {
            method: "POST",
            body: JSON.stringify({ totpCode: code, note }),
          },
        );
        setNotice(
          `Request for "${request.shopName}" rejected. The shop remains unchanged.`,
        );
      }
      setTotpCodes((old) => ({ ...old, [request.id]: "" }));
      setDecisionNotes((old) => ({ ...old, [request.id]: "" }));
      setDetails(null);
      await load();
    } catch (mutationError) {
      setError(errText(mutationError));
    } finally {
      setTotpCodes((old) => ({ ...old, [request.id]: "" }));
      setWorkingId(null);
    }
  }

  async function restoreShop(shop: TrashShop) {
    if (!allowed || workingId) return;
    const code = totpCodes[shop.id] ?? "";
    if (!/^\d{6}$/.test(code)) {
      setError("Enter your current 6-digit Super Admin authenticator code.");
      return;
    }
    if (shop.restoreExpired) {
      setError(
        "This restore window expired. The record remains read-only in Trash.",
      );
      return;
    }
    if (
      !window.confirm(
        `Restore "${shop.name}" (${shop.publicId}) before ${fmt(shop.restoreEligibleUntil)}? It will return only to a safe prior status; readiness and verification are checked before it can become active.`,
      )
    )
      return;
    setWorkingId(shop.id);
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<{ name: string; status: string }>(
        `admin/security/deletion-trash/${shop.id}/restore`,
        { method: "POST", body: JSON.stringify({ totpCode: code }) },
      );
      setNotice(`"${result.name}" restored with status ${result.status}.`);
      setTotpCodes((old) => ({ ...old, [shop.id]: "" }));
      await load();
    } catch (mutationError) {
      setError(errText(mutationError));
    } finally {
      setTotpCodes((old) => ({ ...old, [shop.id]: "" }));
      setWorkingId(null);
    }
  }

  if (!user)
    return (
      <main className={styles.page}>
        <p>Checking your admin session…</p>
      </main>
    );
  if (!allowed)
    return (
      <main className={styles.page}>
        <h1>Super Admin only</h1>
        <p>Access denied.</p>
      </main>
    );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Super Admin / Security</p>
          <h1>Security &amp; Audit Control Center</h1>
          <p>
            Review deletion requests, recover shops for 30 days, and inspect
            attributed event history.
          </p>
        </div>
        <div className={styles.headerActions}>
          <LinkButton href="/dashboard/admin" variant="outline">
            Platform operations
          </LinkButton>
          <LinkButton href="/dashboard/admin/access" variant="outline">
            Access control
          </LinkButton>
          <Button
            type="button"
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </header>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.success}>
          {notice}
        </p>
      )}

      <section
        className={styles.section}
        aria-label="Pending deletion approvals"
      >
        <div className={styles.sectionHeader}>
          <div>
            <h2>Deletion approval queue</h2>
            <p>
              Approval moves the shop to Trash. It does not erase records or
              assets.
            </p>
          </div>
          <strong>{pending.length} pending</strong>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Shop</th>
                <th>Requested by</th>
                <th>Submitted</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((req) => (
                <tr key={req.id}>
                  <td>
                    <strong>{req.shopName}</strong>
                    <small>{req.shopPublicId}</small>
                  </td>
                  <td>{req.requestedByEmail ?? req.requestedByUserId}</td>
                  <td>{fmt(req.requestedAt)}</td>
                  <td>
                    <div style={{ display: "grid", gap: 8, minWidth: 240 }}>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void openDetails(req)}
                      >
                        Review request details
                      </Button>
                      <label>
                        Current Super Admin authenticator code
                        <input
                          type="password"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          value={totpCodes[req.id] ?? ""}
                          onChange={(event) =>
                            setTotpCodes((old) => ({
                              ...old,
                              [req.id]: event.target.value
                                .replace(/\D/g, "")
                                .slice(0, 6),
                            }))
                          }
                          placeholder="••••••"
                        />
                      </label>
                      <label>
                        Decision note{" "}
                        <textarea
                          value={decisionNotes[req.id] ?? ""}
                          maxLength={500}
                          rows={2}
                          onChange={(event) =>
                            setDecisionNotes((old) => ({
                              ...old,
                              [req.id]: event.target.value,
                            }))
                          }
                          placeholder="Optional for approval; required for rejection"
                        />
                      </label>
                      <Button
                        type="button"
                        disabled={
                          !!workingId || !details || details.id !== req.id
                        }
                        onClick={() => void resolveRequest(req, true)}
                      >
                        {workingId === req.id
                          ? "Processing…"
                          : "Move to Trash — recoverable for 30 days"}
                      </Button>
                      <Button
                        variant="outline"
                        type="button"
                        disabled={
                          !!workingId || !details || details.id !== req.id
                        }
                        onClick={() => void resolveRequest(req, false)}
                      >
                        Reject with 2FA
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!pending.length && <p>No pending deletion requests.</p>}
        {pendingCursor && (
          <Button
            type="button"
            variant="outline"
            disabled={loadingMore}
            onClick={() =>
              void loadMore<DeletionRequest>(
                "admin/security/deletion-requests?status=PENDING",
                pendingCursor,
                (items) => setPending((old) => [...old, ...items]),
                setPendingCursor,
              )
            }
          >
            Load more requests
          </Button>
        )}
      </section>

      <section className={styles.section} aria-label="Recoverable shop trash">
        <div className={styles.sectionHeader}>
          <div>
            <h2>Shop recovery Trash</h2>
            <p>
              Shops stay quarantined after expiry. There is no automatic purge.
            </p>
          </div>
          <strong>{trash.length} shown</strong>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Shop</th>
                <th>Quarantined</th>
                <th>Actor / prior status</th>
                <th>Restore window</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {trash.map((shop) => (
                <tr key={shop.id}>
                  <td>
                    <strong>{shop.name}</strong>
                    <small>{shop.publicId}</small>
                  </td>
                  <td>{fmt(shop.softDeletedAt)}</td>
                  <td>
                    {shop.deletedByEmail ??
                      shop.softDeletedByUserId ??
                      "Unknown"}
                    <small>
                      Before: {shop.statusBeforeSoftDelete ?? "Unknown"}
                    </small>
                    <small>
                      Request: {shop.softDeletionRequestId ?? "Unavailable"}
                    </small>
                  </td>
                  <td>
                    {shop.restoreExpired ? (
                      <strong>Expired — read-only</strong>
                    ) : (
                      <>
                        <strong>{remaining(shop.remainingMs)}</strong>
                        <small>Until {fmt(shop.restoreEligibleUntil)}</small>
                      </>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "grid", gap: 8, minWidth: 200 }}>
                      <label>
                        Current Super Admin authenticator code
                        <input
                          type="password"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          value={totpCodes[shop.id] ?? ""}
                          disabled={shop.restoreExpired}
                          onChange={(event) =>
                            setTotpCodes((old) => ({
                              ...old,
                              [shop.id]: event.target.value
                                .replace(/\D/g, "")
                                .slice(0, 6),
                            }))
                          }
                          placeholder="••••••"
                        />
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!!workingId || shop.restoreExpired}
                        onClick={() => void restoreShop(shop)}
                      >
                        {workingId === shop.id ? "Restoring…" : "Restore shop"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!trash.length && <p>Trash is empty.</p>}
        {trashCursor && (
          <Button
            type="button"
            variant="outline"
            disabled={loadingMore}
            onClick={() =>
              void loadMore<TrashShop>(
                "admin/security/deletion-trash",
                trashCursor,
                (items) => setTrash((old) => [...old, ...items]),
                setTrashCursor,
              )
            }
          >
            Load older Trash records
          </Button>
        )}
      </section>

      <section className={styles.section} aria-label="Deletion request history">
        <div className={styles.sectionHeader}>
          <div>
            <h2>Deletion request history</h2>
            <p>
              Request reasons and notes are fetched only when a Super Admin
              opens a specific record.
            </p>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Shop</th>
                <th>Requested by</th>
                <th>Status</th>
                <th>Decision time</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {history.map((req) => (
                <tr key={req.id}>
                  <td>
                    {req.shopName}
                    <small>{req.shopPublicId}</small>
                  </td>
                  <td>{req.requestedByEmail ?? req.requestedByUserId}</td>
                  <td>{req.status}</td>
                  <td>{fmt(req.decidedAt)}</td>
                  <td>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void openDetails(req)}
                    >
                      View details
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!history.length && <p>No resolved requests.</p>}
        {historyCursor && (
          <Button
            type="button"
            variant="outline"
            disabled={loadingMore}
            onClick={() =>
              void loadMore<DeletionRequest>(
                "admin/security/deletion-requests?status=RESOLVED",
                historyCursor,
                (items) => setHistory((old) => [...old, ...items]),
                setHistoryCursor,
              )
            }
          >
            Load older decisions
          </Button>
        )}
      </section>

      {details && (
        <section
          aria-labelledby="request-detail-title"
          className={styles.section}
        >
          <div className={styles.sectionHeader}>
            <h2 id="request-detail-title">
              Request details — {details.shopName}
            </h2>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDetails(null)}
            >
              Close
            </Button>
          </div>
          <p>
            <strong>Shop ID:</strong> {details.shopPublicId} ·{" "}
            <strong>Request:</strong> {details.id}
          </p>
          <p>
            <strong>Requested by:</strong>{" "}
            {details.requestedByEmail ?? details.requestedByUserId} ·{" "}
            <strong>Submitted:</strong> {fmt(details.requestedAt)}
          </p>
          <p>
            <strong>Reason:</strong> {details.reason}
          </p>
          {details.decisionNote && (
            <p>
              <strong>Decision note:</strong> {details.decisionNote}
            </p>
          )}
        </section>
      )}

      <section className={styles.section} aria-label="Audit event history">
        <div className={styles.sectionHeader}>
          <div>
            <h2>Activity &amp; change history</h2>
            <p>
              Recorded actions only. Request text, passwords, and authenticator
              secrets are not included.
            </p>
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setActiveFilters({
              actorEmail: actorEmail.trim(),
              action: action.trim().toUpperCase(),
            });
          }}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <label>
            Actor email{" "}
            <input
              type="email"
              value={actorEmail}
              onChange={(event) => setActorEmail(event.target.value)}
              placeholder="admin@example.com"
            />
          </label>
          <label>
            Event action{" "}
            <input
              value={action}
              onChange={(event) => setAction(event.target.value)}
              placeholder="SHOP_SOFT_DELETED"
            />
          </label>
          <Button type="submit" disabled={loading}>
            Filter
          </Button>
        </form>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Record</th>
                <th>Safe change details</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((event) => (
                <tr key={event.id}>
                  <td>{fmt(event.at)}</td>
                  <td>
                    {event.actorEmail ??
                      (event.actorUserId
                        ? `User ${event.actorUserId}`
                        : "System / unattributed")}
                  </td>
                  <td>
                    <strong>{event.action}</strong>
                  </td>
                  <td>
                    {event.entityType}
                    <small>{event.entityId}</small>
                  </td>
                  <td>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                        maxWidth: 370,
                      }}
                    >
                      {JSON.stringify(event.details, null, 2)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <p>Loading…</p>}
        {!loading && !audit.length && (
          <p>No recorded events match these filters.</p>
        )}
        {auditCursor && (
          <Button
            type="button"
            variant="outline"
            disabled={loadingMore}
            onClick={() =>
              void loadMore<AuditEvent>(
                `admin/security/audit?${new URLSearchParams({ ...(activeFilters.actorEmail ? { actorEmail: activeFilters.actorEmail } : {}), ...(activeFilters.action ? { action: activeFilters.action } : {}) }).toString()}`,
                auditCursor,
                (items) => setAudit((old) => [...old, ...items]),
                setAuditCursor,
              )
            }
          >
            Load older events
          </Button>
        )}
      </section>
    </main>
  );
}
