"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS, StaffMemberStatus } from "@barbercue/shared";
import type { SalonStaffDto, StaffInviteResultDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";

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
    <main style={{ padding: "2rem 1.25rem 3rem", maxWidth: 720, margin: "0 auto" }}>
      <Link href={`/dashboard/salons/${salonId}/settings`} style={{ fontSize: 14 }}>
        ← Back to shop setup
      </Link>
      <h1 style={{ marginTop: 12 }}>Barbers</h1>
      <p style={{ color: "#6B6357" }}>
        Add a barber and they&apos;ll get an emailed link to set their own password, then sign in
        at <code>/staff/login</code> to run the queue. You never see or set their password. Only
        barbers who are working count toward how many customers you can serve.
      </p>

      {error && <p style={errorStyle}>{error}</p>}
      {notice && <p style={noticeStyle}>{notice}</p>}

      {inviteUrl && (
        <div style={{ background: "#FFF8E7", border: "1px solid #E7D9B0", borderRadius: 10, padding: "12px 16px", margin: "16px 0" }}>
          <strong style={{ fontSize: 14 }}>Invitation link</strong>
          <p style={{ fontSize: 13, color: "#6B6357", margin: "4px 0 8px" }}>
            No email provider is connected yet, so send this to the barber yourself. It expires in
            7 days and can only be used once.
          </p>
          <code style={{ fontSize: 12, wordBreak: "break-all" }}>{inviteUrl}</code>
        </div>
      )}

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", margin: "20px 0 24px" }}>
        <div style={{ flex: "1 1 180px" }}>
          <label style={labelStyle} htmlFor="staff-name">Barber&apos;s name</label>
          <input
            id="staff-name"
            placeholder="Marcus"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={120}
            autoComplete="off"
            style={inputStyle}
          />
        </div>
        <div style={{ flex: "1 1 220px" }}>
          <label style={labelStyle} htmlFor="staff-email">Their email</label>
          <input
            id="staff-email"
            type="email"
            inputMode="email"
            placeholder="marcus@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="off"
            style={inputStyle}
          />
        </div>
        <button type="submit" disabled={submitting} style={{ ...buttonStyle, flex: "1 1 100%" }}>
          {submitting ? "Sending invitation…" : "Add barber"}
        </button>
      </form>

      {staff === null && <p>Loading…</p>}
      {staff?.length === 0 && <p style={{ color: "#6B6357" }}>No barbers yet. Add your first one above.</p>}
      {staff && staff.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {staff.map((m) => (
            <li key={m.id} style={rowStyle}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ opacity: m.status === StaffMemberStatus.ACTIVE ? 1 : 0.55 }}>
                  {m.displayName}
                </strong>
                <div style={{ fontSize: 13, color: "#6B6357", wordBreak: "break-word" }}>
                  {m.email}
                  {m.status !== StaffMemberStatus.ACTIVE && " · not working"}
                  {!m.hasPassword && " · hasn't set their password yet"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {!m.hasPassword && (
                  <button type="button" onClick={() => void resendInvite(m)} style={secondaryButtonStyle}>
                    Resend invitation
                  </button>
                )}
                <button type="button" onClick={() => void toggleActive(m)} style={secondaryButtonStyle}>
                  {m.status === StaffMemberStatus.ACTIVE ? "Mark not working" : "Mark working"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 8,
  border: "1px solid #E7E0D3",
  // 16px minimum: anything smaller makes iOS Safari zoom the page on focus.
  fontSize: 16,
  boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 5,
  fontWeight: 600,
  fontSize: 13,
};
const buttonStyle: React.CSSProperties = {
  padding: "12px 20px",
  minHeight: 46,
  background: "#1C1A17",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 15,
  cursor: "pointer",
};
const secondaryButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  minHeight: 42,
  background: "#fff",
  border: "1px solid #E7E0D3",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 14,
};
const rowStyle: React.CSSProperties = {
  border: "1px solid #E5DFD1",
  borderRadius: 10,
  padding: "12px 16px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};
const errorStyle: React.CSSProperties = {
  background: "#FBEAEA",
  color: "#B0413E",
  padding: "10px 14px",
  borderRadius: 8,
};
const noticeStyle: React.CSSProperties = {
  background: "#EAF6EC",
  color: "#2E7D32",
  padding: "10px 14px",
  borderRadius: 8,
};
