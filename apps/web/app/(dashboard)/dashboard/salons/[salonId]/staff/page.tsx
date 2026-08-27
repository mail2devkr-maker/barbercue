"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS, StaffMemberStatus } from "@barbercue/shared";
import type { SalonStaffDto, StaffInviteResultDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { Button } from "../../../../../../components/ui/Button";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

// Barber roster (Phase 11) — replaces the previous placeholder. Adding a barber creates (or
// links) their login account and issues an invitation link; the barber sets their own password
// and then signs in at /staff/login. The owner never handles a password.
export default function DashboardStaffPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = use(params);
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.staff}`;

  const [staff, setStaff] = useState<SalonStaffDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Populated only outside production, where the backend returns the invitation link because no
  // email provider is wired yet (ConsoleEmailSender just logs it). In production this stays null
  // and the barber receives the link by email.
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SalonStaffDto[]>(base)
      .then((list) => {
        if (!cancelled) setStaff(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load staff.");
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setInviteUrl(null);
    setSubmitting(true);
    try {
      const result = await apiFetch<StaffInviteResultDto>(base, {
        method: "POST",
        body: JSON.stringify({ displayName: displayName.trim(), email: email.trim() }),
      });
      setStaff((prev) => [...(prev ?? []), result.staff]);
      setInviteUrl(result.inviteUrl ?? null);
      setNotice(`Invitation sent to ${result.staff.email ?? "their email"}.`);
      setDisplayName("");
      setEmail("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add that barber.");
    } finally {
      setSubmitting(false);
    }
  }

  async function resendInvite(member: SalonStaffDto) {
    setError(null);
    setNotice(null);
    setInviteUrl(null);
    try {
      const result = await apiFetch<StaffInviteResultDto>(
        `${base}/${member.id}/${DASHBOARD_PATHS.resendInvite}`,
        { method: "POST" },
      );
      setInviteUrl(result.inviteUrl ?? null);
      setNotice(`New invitation sent to ${member.email ?? "their email"}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resend that invitation.");
    }
  }

  async function toggleActive(member: SalonStaffDto) {
    setError(null);
    setNotice(null);
    const next =
      member.status === StaffMemberStatus.ACTIVE
        ? StaffMemberStatus.INACTIVE
        : StaffMemberStatus.ACTIVE;
    try {
      const updated = await apiFetch<SalonStaffDto>(`${base}/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      setStaff((prev) => (prev ?? []).map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update that barber.");
    }
  }

  return (
    <main className={styles.page}>
      <Link href={`/dashboard/salons/${salonId}/settings`} className={styles.backLink}>
        ← Back to shop setup
      </Link>
      <h1 className={styles.pageTitle}>Barbers</h1>
      <p className={styles.pageSubtitle}>
        Add a barber and they&apos;ll get an emailed link to set their own password, then sign in
        at <code>/staff/login</code> to run the queue. You never see or set their password. Only
        barbers who are working count toward how many customers you can serve.
      </p>

      {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
      {notice && <p className={`${styles.banner} ${styles.bannerNotice}`}>{notice}</p>}

      {inviteUrl && (
        <div className={`${styles.banner} ${styles.bannerWarning}`}>
          <strong style={{ fontSize: 14 }}>Invitation link</strong>
          <p style={{ fontSize: 13, margin: "4px 0 8px" }}>
            No email provider is connected yet, so send this to the barber yourself. It expires in
            7 days and can only be used once.
          </p>
          <code style={{ fontSize: 12, wordBreak: "break-all" }}>{inviteUrl}</code>
        </div>
      )}

      <form onSubmit={handleCreate} className={styles.form}>
        <div style={{ flex: "1 1 180px" }} className={styles.fieldWrap}>
          <label className={styles.fieldLabel} htmlFor="staff-name">Barber&apos;s name</label>
          <input
            id="staff-name"
            placeholder="Marcus"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={120}
            autoComplete="off"
            className={styles.input}
          />
        </div>
        <div style={{ flex: "1 1 220px" }} className={styles.fieldWrap}>
          <label className={styles.fieldLabel} htmlFor="staff-email">Their email</label>
          <input
            id="staff-email"
            type="email"
            inputMode="email"
            placeholder="marcus@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="off"
            className={styles.input}
          />
        </div>
        <Button type="submit" variant="secondary" fullWidth disabled={submitting}>
          {submitting ? "Sending invitation…" : "Add barber"}
        </Button>
      </form>

      {staff === null && <p className={styles.loadingText}>Loading…</p>}
      {staff?.length === 0 && <p className={styles.emptyState}>No barbers yet. Add your first one above.</p>}
      {staff && staff.length > 0 && (
        <ul className={styles.rowList}>
          {staff.map((m) => (
            <li key={m.id} className={styles.row}>
              <div style={{ minWidth: 0 }}>
                <span className={styles.rowTitle} style={{ opacity: m.status === StaffMemberStatus.ACTIVE ? 1 : 0.55 }}>
                  {m.displayName}
                </span>
                <div className={styles.rowMeta} style={{ wordBreak: "break-word" }}>
                  {m.email}
                  {m.status !== StaffMemberStatus.ACTIVE && " · not working"}
                  {!m.hasPassword && " · hasn't set their password yet"}
                </div>
              </div>
              <div className={styles.rowActions}>
                {!m.hasPassword && (
                  <Button type="button" variant="outline" onClick={() => void resendInvite(m)}>
                    Resend invitation
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => void toggleActive(m)}>
                  {m.status === StaffMemberStatus.ACTIVE ? "Mark not working" : "Mark working"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
