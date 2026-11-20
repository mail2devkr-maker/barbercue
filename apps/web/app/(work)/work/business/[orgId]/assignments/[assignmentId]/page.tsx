"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { WORK_DISPUTE_REASON_LABELS, type WorkAssignmentDetailDto } from "@barbercue/shared";
import { RequireRole } from "../../../../../../../components/auth/RequireRole";
import { ASSIGNMENT_STATUS, errorText, money, PAYOUT_STATUS, timeRange, when, workGet, workSend } from "../../../../../../../lib/work";
import { Badge, EvidenceThumb, WorkNav } from "../../../../WorkUi";
import styles from "../../../../work.module.css";

function Review() {
  const { orgId, assignmentId } = useParams<{ orgId: string; assignmentId: string }>();
  const [a, setA] = useState<WorkAssignmentDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [disputeText, setDisputeText] = useState("");
  // Wall clock kept in state (render must stay pure); ticks so the no-show action unlocks on time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(() => {
    workGet<WorkAssignmentDetailDto>(`assignments/${assignmentId}`)
      .then(setA)
      .catch((err) => setError(errorText(err, "Assignment not found.")));
  }, [assignmentId]);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      setNote("");
      load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!a) return error ? <p className={styles.error} role="alert">{error}</p> : <div className={styles.skeleton} aria-busy="true" />;
  const org = `orgs/${orgId}/assignments/${a.id}`;
  const st = ASSIGNMENT_STATUS[a.status];
  const startedPlus30 = now > new Date(a.startsAt).getTime() + 30 * 60_000;

  return (
    <>
      <Link href={`/work/business/${orgId}/jobs/${a.jobId}`} className={styles.meta}>
        ← {a.jobTitle}
      </Link>
      <div className={styles.jobHead}>
        <div className={styles.rowMain}>
          <h1 className={styles.title}>
            #{a.slotNumber} {a.worker.fullName}
          </h1>
          <span className={styles.meta}>
            {a.worker.verificationLevel >= 2 ? "Verified worker" : "Phone verified"} · {a.worker.completedAssignments} completed jobs · {timeRange(a.startsAt, a.endsAt)}
          </span>
        </div>
        <span className={styles.actions}>
          <Badge tone={st.tone}>{st.label}</Badge>
          {a.payoutStatus && <Badge tone={PAYOUT_STATUS[a.payoutStatus].tone}>{PAYOUT_STATUS[a.payoutStatus].label}</Badge>}
        </span>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.success} role="status">{notice}</p>}

      <div className={styles.twoCol}>
        <section className={styles.card} aria-label="Submission">
          <h2 className={styles.sectionTitle}>Submitted work</h2>
          {a.checkedInAt && (
            <p className={styles.meta}>
              Checked in {when(a.checkedInAt)} by {a.checkInMethod?.replace(/_/g, " ").toLowerCase()}
            </p>
          )}
          <ol className={styles.checklist}>
            {a.job.checklist.map((item) => {
              const r = a.responses.find((x) => x.itemId === item.id);
              return (
                <li key={item.id} className={styles.checkItem}>
                  <strong>{item.label}</strong>
                  {item.kind === "CONFIRM" && <span>{r?.confirmed ? "✓ Marked done" : "Not done"}</span>}
                  {item.kind === "TEXT" && <span>{r?.text ?? "—"}</span>}
                  {item.kind === "PHOTO" && (r?.evidenceFileId ? <EvidenceThumb fileId={r.evidenceFileId} /> : <span>No photo</span>)}
                  {r?.duplicateFlag && (
                    <span className={styles.notice}>⚠ The same {item.kind === "PHOTO" ? "photo" : "answer"} was submitted on another assignment. This is a signal to check, not proof of anything.</span>
                  )}
                </li>
              );
            })}
          </ol>
          <p className={styles.meta}>Complete when: {a.job.completionCriteria}</p>

          {a.status === "SUBMITTED" && (
            <div className={styles.list}>
              {a.reviewDueAt && <p className={styles.notice}>Review by {when(a.reviewDueAt)}. After that the work is approved automatically, as your job terms say.</p>}
              <label className={styles.field}>
                Note to the worker
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
              </label>
              <div className={styles.actions}>
                <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => void act(() => workSend(`${org}/review`, { decision: "APPROVE", note: note || undefined }), "Approved. The payout is on its way to the worker.")}>
                  Approve {money(a.agreedPayPaise)}
                </button>
                <button type="button" className={styles.btn} disabled={busy || note.trim().length < 5} onClick={() => void act(() => workSend(`${org}/review`, { decision: "REQUEST_REWORK", note }), "Changes requested.")}>
                  Ask for changes
                </button>
              </div>
              <p className={styles.hint}>You can ask for changes twice. If you believe the work should be paid less, open a dispute below — a FastQue reviewer decides.</p>
            </div>
          )}

          {(a.status === "SUBMITTED" || a.status === "REWORK_REQUESTED") && (
            <div className={styles.list}>
              <label className={styles.field}>
                Dispute the quality of this work
                <textarea value={disputeText} onChange={(e) => setDisputeText(e.target.value)} placeholder="What does not meet the job’s completion conditions?" maxLength={2000} />
              </label>
              <button type="button" className={styles.btnDanger} disabled={busy || disputeText.trim().length < 10} onClick={() => void act(() => workSend(`assignments/${a.id}/disputes`, { reasonCode: "QUALITY_ISSUE", description: disputeText }), "Dispute opened for platform review.")}>
                Open a dispute
              </button>
            </div>
          )}

          {a.disputes.map((d) => (
            <div key={d.id} className={styles.notice}>
              <strong>{WORK_DISPUTE_REASON_LABELS[d.reasonCode]}</strong> — opened by {d.openedBy === "EMPLOYER" ? "you" : "the worker"}
              <p>{d.description}</p>
              {d.status === "RESOLVED" ? <p><strong>Decision:</strong> {money(d.awardPaise ?? 0)} — {d.resolutionNote}</p> : <p>Under review by FastQue.</p>}
            </div>
          ))}
        </section>

        <aside className={styles.list} style={{ gap: "var(--bc-space-4)" }}>
          {(a.status === "ACCEPTED" || a.status === "NO_SHOW_REVIEW") && (
            <section className={styles.card} aria-label="Attendance">
              <h2 className={styles.sectionTitle}>Attendance</h2>
              <button type="button" className={styles.btn} disabled={busy} onClick={() => void act(() => workSend(`${org}/confirm-attendance`), "Attendance confirmed.")}>
                Confirm the worker is here
              </button>
              {a.status === "ACCEPTED" && startedPlus30 && (
                <button type="button" className={styles.btnDanger} disabled={busy} onClick={() => void act(() => workSend(`${org}/no-show`), "No-show reported. The worker has 72 hours to respond.")}>
                  Report a no-show
                </button>
              )}
            </section>
          )}
          {(a.status === "ACCEPTED" || a.status === "CHECKED_IN") && (
            <section className={styles.card} aria-label="Cancel this worker">
              <h2 className={styles.sectionTitle}>Cancel this worker</h2>
              <p className={styles.meta}>
                {a.status === "CHECKED_IN" ? `The worker has arrived: they receive ${money(a.job.cancellationTerms.employerCancelAfterArrivalPaise)}.` : "Before arrival, the late-cancellation terms of the job apply."}
              </p>
              <button type="button" className={styles.btnDanger} disabled={busy || note.trim().length < 3} onClick={() => void act(() => workSend(`${org}/cancel`, { reason: note }), "Worker cancelled.")}>
                Cancel (uses the note as the reason)
              </button>
              <textarea aria-label="Reason" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason" />
            </section>
          )}
          <section className={styles.card} aria-label="Timeline">
            <h2 className={styles.sectionTitle}>Timeline</h2>
            <ol className={styles.timeline}>
              {a.timeline.map((e) => (
                <li key={e.id}>
                  <strong>{e.action.replace(/_/g, " ").toLowerCase()}</strong>
                  <span className={styles.meta}> · {when(e.createdAt)}</span>
                  {e.note && <div className={styles.meta}>{e.note}</div>}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function EmployerAssignmentPage() {
  return (
    <RequireRole redirectTo="/login">
      <main className={styles.page}>
        <WorkNav />
        <Review />
      </main>
    </RequireRole>
  );
}
