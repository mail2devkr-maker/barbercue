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
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
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
type AuditPage = { items: AuditEvent[]; nextCursor: string | null };

function fmt(iso: string) {
  return new Date(iso).toLocaleString();
}
function errText(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "The request failed. Please retry.";
}

export default function AdminSecurityPage() {
  const { user } = useAuth();
  const allowed = !!user?.roles.includes(Role.PLATFORM_ADMIN);
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [actorEmail, setActorEmail] = useState("");
  const [action, setAction] = useState("");
  const [activeFilters, setActiveFilters] = useState({
    actorEmail: "",
    action: "",
  });
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [totpCodes, setTotpCodes] = useState<Record<string, string>>({});
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (append = false, cursor?: string) => {
      if (!allowed) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (activeFilters.actorEmail)
          params.set("actorEmail", activeFilters.actorEmail);
        if (activeFilters.action) params.set("action", activeFilters.action);
        if (append && cursor) params.set("cursor", cursor);
        const [latestRequests, page] = await Promise.all([
          apiFetch<DeletionRequest[]>("admin/security/deletion-requests"),
          apiFetch<AuditPage>(`admin/security/audit?${params.toString()}`),
        ]);
        setRequests(latestRequests);
        setAudit((current) =>
          append ? [...current, ...page.items] : page.items,
        );
        setNextCursor(page.nextCursor);
      } catch (error) {
        setError(errText(error));
      } finally {
        setLoading(false);
      }
    },
    [allowed, activeFilters],
  );

  useEffect(() => {
    if (!allowed) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [allowed, load]);

  async function resolveRequest(request: DeletionRequest, approve: boolean) {
    if (!allowed || workingId) return;
    let body: { totpCode?: string; note: string };
    const note = (decisionNotes[request.id] ?? "").trim();
    if (approve) {
      const code = totpCodes[request.id] ?? "";
      if (!/^\d{6}$/.test(code)) {
        setError("Enter your current 6-digit Super Admin authenticator code.");
        return;
      }
      if (note.length > 500) {
        setError("Decision note cannot exceed 500 characters.");
        return;
      }
      if (
        !window.confirm(
          `Permanently delete "${request.shopName}" (${request.shopPublicId})? The shop can NOT be restored from this portal. Confirm only after reviewing the request.`,
        )
      )
        return;
      body = { totpCode: code, note };
    } else {
      if (note.length < 5 || note.length > 500) {
        setError("Enter a rejection reason between 5 and 500 characters.");
        return;
      }
      body = { note };
    }

    setWorkingId(request.id);
    setNotice(null);
    setError(null);
    try {
      await apiFetch(
        `admin/security/deletion-requests/${request.id}/${approve ? "approve" : "reject"}`,
        { method: "POST", body: JSON.stringify(body) },
      );
      setNotice(
        approve
          ? `Request approved; "${request.shopName}" deleted only after fresh safety checks.`
          : `Deletion request rejected. Shop remains unchanged.`,
      );
      setTotpCodes((prev) => {
        const next = { ...prev };
        delete next[request.id];
        return next;
      });
      setDecisionNotes((prev) => {
        const next = { ...prev };
        delete next[request.id];
        return next;
      });
      await load();
    } catch (error) {
      setError(errText(error));
    } finally {
      // Do not retain one-time codes even when an approval fails.
      setTotpCodes((prev) => {
        const next = { ...prev };
        delete next[request.id];
        return next;
      });
      setWorkingId(null);
    }
  }

  if (!user)
    return (
      <main className={styles.page}>
        <p>Checking your admin session…</p>
      </main>
    );
  if (!allowed) {
    return (
      <main className={styles.page}>
        <h1>Super Admin only</h1>
        <p>Access denied.</p>
      </main>
    );
  }
  const pending = requests.filter((r) => r.status === "PENDING");
  const history = requests.filter((r) => r.status !== "PENDING");

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Super Admin / Security</p>
          <h1>Security &amp; Audit Control Center</h1>
          <p>
            Human approval for deletion, user attribution, and event history.
            Only the Super Admin may approve.
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
              Pending requests do not change a shop. Active shops with
              bookings/staff cannot be hard-deleted.
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
                <th>Reason</th>
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
                  <td style={{ maxWidth: 310, overflowWrap: "anywhere" }}>
                    {req.reason}
                  </td>
                  <td>{fmt(req.requestedAt)}</td>
                  <td>
                    <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
                      <label>
                        Decision note / rejection reason
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
                          placeholder="Required for rejection"
                        />
                      </label>
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
                      <Button
                        type="button"
                        disabled={!!workingId}
                        onClick={() => void resolveRequest(req, true)}
                      >
                        {workingId === req.id
                          ? "Processing…"
                          : "Approve with 2FA"}
                      </Button>
                      <Button
                        variant="outline"
                        type="button"
                        disabled={!!workingId}
                        onClick={() => void resolveRequest(req, false)}
                      >
                        Reject
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!pending.length && <p>No pending deletion requests.</p>}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Deletion decision history</h2>
          <span>Latest {history.length}</span>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Shop</th>
                <th>Requested by</th>
                <th>Decision</th>
                <th>Decision time</th>
                <th>Reason</th>
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
                  <td>{req.decidedAt ? fmt(req.decidedAt) : "—"}</td>
                  <td>{req.decisionNote ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-label="Audit event history">
        <div className={styles.sectionHeader}>
          <div>
            <h2>Activity &amp; change history</h2>
            <p>
              Recorded actions only. Passwords and authenticator secrets are
              never exposed.
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
              onChange={(e) => setActorEmail(e.target.value)}
              placeholder="cofounder@gmail.com"
            />
          </label>
          <label>
            Event action{" "}
            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="EMPLOYEE_UPDATED"
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
        {nextCursor && (
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => void load(true, nextCursor)}
          >
            Load older events
          </Button>
        )}
      </section>
    </main>
  );
}
