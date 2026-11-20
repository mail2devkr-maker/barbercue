"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkAssignmentSummaryDto, WorkerDashboardDto } from "@barbercue/shared";
import { RequireRole } from "../../../../components/auth/RequireRole";
import { safeNextPath } from "../../../../lib/safe-next-path";
import { ASSIGNMENT_STATUS, errorText, money, PAYOUT_STATUS, when, workGet } from "../../../../lib/work";
import { Badge, Stat, WorkNav } from "../WorkUi";
import { WorkerProfileForm } from "./WorkerProfileForm";
import styles from "../work.module.css";

function AssignmentList({ title, items, empty }: { title: string; items: WorkAssignmentSummaryDto[]; empty: string }) {
  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {items.length === 0 ? (
        <p className={styles.meta}>{empty}</p>
      ) : (
        <div className={styles.list}>
          {items.map((a) => (
            <Link key={a.id} href={`/work/me/assignments/${a.id}`} className={styles.row}>
              <span className={styles.rowMain}>
                <strong>{a.jobTitle}</strong>
                <span className={styles.meta}>
                  {a.employerName} · {a.city} · {when(a.startsAt)}
                </span>
              </span>
              <span className={styles.actions}>
                <strong>{money(a.approvedAmountPaise ?? a.agreedPayPaise)}</strong>
                <Badge tone={ASSIGNMENT_STATUS[a.status].tone}>{ASSIGNMENT_STATUS[a.status].label}</Badge>
                {a.payoutStatus && a.status !== "PAID" && <Badge tone={PAYOUT_STATUS[a.payoutStatus].tone}>{PAYOUT_STATUS[a.payoutStatus].label}</Badge>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function WorkerHome() {
  const router = useRouter();
  const [data, setData] = useState<WorkerDashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    workGet<WorkerDashboardDto>("me/dashboard")
      .then(setData)
      .catch((err) => setError(errorText(err, "Couldn’t load your work.")));
  }, []);
  useEffect(load, [load]);

  if (error) return <p className={styles.error} role="alert">{error}</p>;
  if (!data) return <div className={styles.skeleton} aria-busy="true" />;

  if (!data.profile || editing) {
    return (
      <>
        <div>
          <h1 className={styles.title}>{data.profile ? "Edit your worker profile" : "Start earning with FastQue Work"}</h1>
          <p className={styles.sub}>A short profile so we can show you jobs you’re eligible for. Your phone number is already verified from sign-in.</p>
        </div>
        <WorkerProfileForm
          initial={data.profile}
          onSaved={() => {
            setEditing(false);
            const next = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("next");
            const safe = next ? safeNextPath(next) : null;
            if (safe && safe.startsWith("/work/")) router.push(safe);
            else load();
          }}
        />
      </>
    );
  }

  const p = data.profile;
  const r = data.reliability;
  return (
    <>
      <div className={styles.jobHead}>
        <div>
          <h1 className={styles.title}>Hi {p.fullName.split(" ")[0]}</h1>
          <p className={styles.sub}>
            {p.city} · {p.verificationLevel >= 2 ? "Verified worker" : p.verificationLevel === 1 ? "Phone verified" : "Phone not verified"}
            {!p.payoutUpiVpaMasked && " · Add a UPI ID so we can pay you"}
          </p>
        </div>
        <div className={styles.actions}>
          <Link href="/work" className={styles.btnPrimary}>
            Find work
          </Link>
          <button type="button" className={styles.btn} onClick={() => setEditing(true)}>
            Edit profile
          </button>
        </div>
      </div>

      <div className={styles.stats}>
        <Stat label="Paid out" value={money(data.earnings.paidPaise)} />
        <Stat label="Approved, being paid" value={money(data.earnings.payablePaise)} />
        <Stat label="Accepted, not yet reviewed" value={money(data.earnings.pendingReviewPaise)} />
        <Stat label="Completed jobs" value={r.completed} />
        <Stat label="Reliability" value={r.reliabilityRate === null ? "New" : `${Math.round(r.reliabilityRate * 100)}%`} />
      </div>
      <p className={styles.meta}>
        Reliability = completed jobs ÷ (completed + late cancellations + upheld no-shows). Late cancellations: {r.lateCancellations}. No-shows: {r.noShows}.
      </p>

      <AssignmentList title="Today" items={data.today} empty="Nothing scheduled for today." />
      <AssignmentList title="Upcoming" items={data.upcoming} empty="No upcoming work. Find a job to get started." />
      <AssignmentList title="Waiting for review or in dispute" items={data.awaitingReview} empty="Nothing waiting for review." />

      {data.applications.length > 0 && (
        <section className={styles.card} aria-label="Applications">
          <h2 className={styles.sectionTitle}>Applications</h2>
          <div className={styles.list}>
            {data.applications.map((a) => (
              <Link key={a.id} href={`/work/jobs/${a.jobId}`} className={styles.row}>
                <span>{a.jobTitle}</span>
                <Badge tone={a.status === "OFFERED" ? "green" : a.status === "APPLIED" ? "amber" : "grey"}>{a.status === "OFFERED" ? "Offer — respond now" : a.status.toLowerCase()}</Badge>
              </Link>
            ))}
          </div>
        </section>
      )}

      <AssignmentList title="Completed and past" items={data.completed} empty="Your finished work and payments will appear here." />

      {data.earnings.transactions.length > 0 && (
        <section className={styles.card} aria-label="Earnings history">
          <h2 className={styles.sectionTitle}>Earnings history</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Job</th>
                  <th>Type</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.earnings.transactions.map((t) => (
                  <tr key={t.id}>
                    <td>{when(t.createdAt)}</td>
                    <td>{t.jobTitle ?? "—"}</td>
                    <td>{t.kind === "PAID_OUT" ? "Paid to your UPI" : "Earned (approved)"}</td>
                    <td>{money(Math.abs(t.amountPaise))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

export default function WorkerAreaPage() {
  return (
    <RequireRole redirectTo="/login">
      <main className={styles.page}>
        <WorkNav />
        <WorkerHome />
      </main>
    </RequireRole>
  );
}
