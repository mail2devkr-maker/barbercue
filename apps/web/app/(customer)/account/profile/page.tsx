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
      <header className={styles.hero}>
        <p className={styles.eyebrow}>PROFILE & SECURITY</p>
        <h1 className={styles.pageTitle}>Your account, kept simple.</h1>
        <p className={styles.pageSubtitle}>
          Review the contact details connected to BarberCue and manage where your account is signed in.
        </p>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Account details</h2>
          <p>These details come from your current authenticated BarberCue account.</p>
        </div>
        <Card className={styles.profileCard}>
          <dl>
            <div className={styles.fieldRow}>
              <dt className={styles.fieldLabel}>Email</dt>
              <dd className={styles.fieldValue}>{user?.email ?? "Not set"}</dd>
            </div>
            <div className={styles.fieldRow}>
              <dt className={styles.fieldLabel}>Phone</dt>
              <dd className={styles.fieldValue}>{user?.phone ?? "Not set"}</dd>
            </div>
            <div className={styles.fieldRow}>
              <dt className={styles.fieldLabel}>Account type</dt>
              <dd className={styles.fieldValue}>
                {user?.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") ?? "—"}
              </dd>
            </div>
          </dl>
        </Card>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Signed-in devices</h2>
          <p>Review active sessions and sign out devices you no longer recognise or use.</p>
        </div>
        <Card className={styles.securityCard}>
          {sessionsLoading && (
            <div className={styles.sessionLoading} role="status">
              <span aria-hidden="true" />
              <p>Loading your signed-in devices…</p>
            </div>
          )}
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
          {!sessionsLoading && sessions.length === 0 && !error && (
            <p className={styles.noteText}>No active sessions were returned for this account.</p>
          )}
          {error && <p className={styles.errorText} role="alert">{error}</p>}
          <div className={styles.actions}>
            {otherSessionCount > 0 && (
              <Button variant="outline" onClick={() => void revokeOtherSessions()} disabled={revokingOthers}>
                {revokingOthers ? "Signing out…" : `Sign out of ${otherSessionCount} other session${otherSessionCount === 1 ? "" : "s"}`}
              </Button>
            )}
            <Button variant="secondary" onClick={() => void logout()}>
              Log out of this device
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
}
