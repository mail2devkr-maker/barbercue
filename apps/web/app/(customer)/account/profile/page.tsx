"use client";

import { useEffect, useState } from "react";
import { AUTH_PATHS, Role } from "@barbercue/shared";
import type { AuthSession } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import styles from "./profile.module.css";

const ROLE_LABELS: Record<string, string> = {
  [Role.CUSTOMER]: "Customer",
  [Role.SALON_STAFF]: "Salon Staff",
  [Role.SALON_OWNER]: "Salon Owner",
  [Role.PLATFORM_ADMIN]: "Platform Admin",
};

// New page (previously no customer profile UI existed) built entirely against endpoints that
// already existed and were already used elsewhere: GET auth/me (via useAuth()'s already-loaded
// `user`), GET/DELETE auth/sessions. Only fields that actually exist on MeResponse/AuthSession are
// shown — no fabricated profile data.
export default function ProfilePage() {
  const { user, logout } = useAuth();
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AuthSession[]>(`auth/${AUTH_PATHS.sessions}`)
      .then((result) => {
        if (!cancelled) setSessions(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load your sessions.");
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function revokeSession(id: string) {
    setRevokingId(id);
    setError(null);
    try {
      await apiFetch(`auth/${AUTH_PATHS.sessions}/${id}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign out that session.");
    } finally {
      setRevokingId(null);
    }
  }

  // Deliberately NOT using POST auth/logout-all here: that endpoint revokes every session
  // including the caller's own current one (and clears the refresh cookie) — it's a full
  // "log out everywhere" action, not "sign out my other devices". This calls the same
  // single-session DELETE auth/sessions/:id the per-row button uses, once per non-current
  // session, which is what "sign out of other sessions" actually means.
  async function revokeOtherSessions() {
    const others = sessions.filter((s) => !s.current);
    if (others.length === 0) return;
    setRevokingOthers(true);
    setError(null);
    try {
      await Promise.all(others.map((s) => apiFetch(`auth/${AUTH_PATHS.sessions}/${s.id}`, { method: "DELETE" })));
      setSessions((prev) => prev.filter((s) => s.current));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign out other sessions.");
    } finally {
      setRevokingOthers(false);
    }
  }

  const otherSessionCount = sessions.filter((s) => !s.current).length;

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Account</h1>

      <section className={styles.section}>
        <p className={styles.sectionTitle}>Profile</p>
        <Card>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Email</span>
            <span className={styles.fieldValue}>{user?.email ?? "Not set"}</span>
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Phone</span>
            <span className={styles.fieldValue}>{user?.phone ?? "Not set"}</span>
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Account type</span>
            <span className={styles.fieldValue}>
              {user?.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") ?? "—"}
            </span>
          </div>
        </Card>
      </section>

      <section className={styles.section}>
        <p className={styles.sectionTitle}>Security</p>
        <Card>
          {sessionsLoading && <p className={styles.noteText}>Loading sessions…</p>}
          {!sessionsLoading &&
            sessions.map((session) => (
              <div key={session.id} className={styles.sessionRow}>
                <div>
                  <div className={styles.sessionDevice}>
                    {session.deviceInfo ?? "Unknown device"}
                    {session.current && <span className={styles.currentBadge}>This device</span>}
                  </div>
                  <div className={styles.sessionMeta}>
                    Signed in {new Date(session.createdAt).toLocaleString()}
                  </div>
                </div>
                {!session.current && (
                  <button
                    type="button"
                    className={styles.revokeButton}
                    onClick={() => void revokeSession(session.id)}
                    disabled={revokingId === session.id || revokingOthers}
                  >
                    {revokingId === session.id ? "Signing out…" : "Sign out"}
                  </button>
                )}
              </div>
            ))}
          {error && <p className={styles.errorText}>{error}</p>}
          <div className={styles.actions}>
            {otherSessionCount > 0 && (
              <Button variant="outline" onClick={() => void revokeOtherSessions()} disabled={revokingOthers}>
                {revokingOthers ? "Signing out…" : `Sign out of ${otherSessionCount} other session${otherSessionCount === 1 ? "" : "s"}`}
              </Button>
            )}
            <Button variant="secondary" onClick={() => void logout()}>
              Log out
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
}
