"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { WORK_INELIGIBLE_LABELS, type WorkJobDetailDto } from "@barbercue/shared";
import { useAuth } from "../../../../../lib/auth-context";
import { errorText, hoursBetween, money, PAY_TYPE_LABEL, timeRange, when, workGet, workSend } from "../../../../../lib/work";
import { Badge, WorkNav } from "../../WorkUi";
import styles from "../../work.module.css";

export default function WorkJobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();
  const { status } = useAuth();
  const [job, setJob] = useState<WorkJobDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    if (status === "loading") return;
    const path = status === "authenticated" ? `me/jobs/${jobId}` : `jobs/${jobId}`;
    workGet<WorkJobDetailDto>(path)
      .then(setJob)
      .catch((err) => setError(errorText(err, "This job is not available.")));
  }, [jobId, status]);

  useEffect(load, [load]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const r = await workSend<{ assignmentId: string }>(`jobs/${jobId}/accept`, undefined, "POST", true);
      router.push(`/work/me/assignments/${r.assignmentId}`);
    } catch (err) {
      setError(errorText(err));
      load();
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await workSend(`jobs/${jobId}/apply`, { note: note.trim() || undefined });
      setMessage("Application sent. The business will review it and you’ll get a notification if they make you an offer.");
      load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function respond(response: "ACCEPT" | "DECLINE") {
    if (!job?.viewer?.applicationId) return;
    setBusy(true);
    try {
      const r = await workSend<{ assignmentId: string | null }>(`applications/${job.viewer.applicationId}/respond`, { response });
      if (r.assignmentId) router.push(`/work/me/assignments/${r.assignmentId}`);
      else load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!job) {
    return (
      <main className={styles.page}>
        <WorkNav />
        {error ? <p className={styles.error} role="alert">{error}</p> : <div className={styles.skeleton} aria-busy="true" />}
      </main>
    );
  }

  const v = job.viewer;
  const terms = job.cancellationTerms;
  return (
    <main className={styles.page}>
      <WorkNav />
      <Link href="/work" className={styles.meta}>
        ← All jobs
      </Link>
      <div className={styles.twoCol}>
        <article className={styles.card}>
          <span className={styles.meta}>{job.categoryName}</span>
          <h1 className={styles.title}>{job.title}</h1>
          <p className={styles.meta}>
            Posted by <strong>{job.employer.displayName}</strong> {job.employer.verified && <Badge tone="green">✓ Verified business</Badge>}
          </p>
          <div className={styles.facts}>
            <span>📍 {job.locationType === "REMOTE" ? "Remote" : [job.addressLine, job.locality, job.city].filter(Boolean).join(", ")}</span>
            <span>🗓 {timeRange(job.startsAt, job.endsAt)}</span>
            <span>⏱ {hoursBetween(job.startsAt, job.endsAt)}</span>
          </div>
          <p style={{ whiteSpace: "pre-wrap" }}>{job.description}</p>

          <h2 className={styles.sectionTitle}>What you’ll do</h2>
          <ol className={styles.checklist}>
            {job.checklist.map((c) => (
              <li key={c.id} className={styles.checkItem}>
                <span>
                  {c.label} {c.kind === "PHOTO" && <span className={styles.chip}>photo</span>} {c.kind === "TEXT" && <span className={styles.chip}>details</span>}
                </span>
              </li>
            ))}
          </ol>
          <h2 className={styles.sectionTitle}>When the work counts as complete</h2>
          <p>{job.completionCriteria}</p>

          <h2 className={styles.sectionTitle}>Requirements</h2>
          <ul style={{ paddingLeft: 20 }}>
            <li>Age {job.minAge}+</li>
            {job.minVerificationLevel > 1 && <li>Verified worker profile (eligibility check)</li>}
            {job.requiredSkills.length > 0 && <li>Skills: {job.requiredSkills.join(", ")}</li>}
            {job.languages.length > 0 && <li>Languages: {job.languages.join(", ")}</li>}
            {job.requiresCheckIn && <li>Check in on arrival with the code shown on site, or your location (only with your permission)</li>}
          </ul>
        </article>

        <aside className={styles.card} aria-label="Pay and terms">
          <div>
            <div className={styles.pay}>{money(job.payPerWorkerPaise)}</div>
            <div className={styles.meta}>Guaranteed pay, {PAY_TYPE_LABEL[job.payType]}</div>
          </div>
          {job.bonusDescription && <p className={styles.notice}>Possible bonus (not guaranteed): {job.bonusDescription}</p>}
          <div className={styles.chips}>
            {job.funded && <Badge tone="green">Pay funded by the business</Badge>}
            <Badge tone="navy">{job.slotsLeft > 0 ? `${job.slotsLeft} of ${job.positions} places left` : "All places taken"}</Badge>
          </div>
          <div className={styles.list} style={{ fontSize: "var(--bc-text-sm)" }}>
            <span>
              <strong>Payout:</strong> after the business approves your work. If they don’t respond within {job.reviewWindowHours} hours, it is approved automatically.
            </span>
            <span>
              <strong>If the business cancels after you arrive:</strong> you get {money(terms.employerCancelAfterArrivalPaise)}.
            </span>
            {terms.employerLateCancelPaise > 0 && (
              <span>
                <strong>If they cancel within {terms.workerLateCancelHours} h of the start:</strong> you get {money(terms.employerLateCancelPaise)}.
              </span>
            )}
            <span>
              <strong>If you need to cancel:</strong> withdraw before check-in. Withdrawing less than {terms.workerLateCancelHours} h before the start is noted on your reliability record. It never costs you money.
            </span>
            {job.applicationDeadline && <span><strong>Applications close:</strong> {when(job.applicationDeadline)}</span>}
            <span>Employer: {job.employer.completedAssignments} paid assignments{job.employer.onTimeReviewRate !== null ? `, ${Math.round(job.employer.onTimeReviewRate * 100)}% reviewed on time` : ""}</span>
          </div>

          {error && <p className={styles.error} role="alert">{error}</p>}
          {message && <p className={styles.success} role="status">{message}</p>}

          {status === "unauthenticated" && (
            <Link href={`/login?next=/work/jobs/${job.id}`} className={styles.btnPrimary}>
              Sign in to take this job
            </Link>
          )}
          {v && !v.hasProfile && (
            <Link href={`/work/me?next=/work/jobs/${job.id}`} className={styles.btnPrimary}>
              Create your worker profile
            </Link>
          )}
          {v?.assignmentId && (
            <Link href={`/work/me/assignments/${v.assignmentId}`} className={styles.btnPrimary}>
              You have this job — open instructions
            </Link>
          )}
          {v?.hasProfile && !v.assignmentId && !v.eligible && (
            <div className={styles.notice}>
              <strong>You can’t take this job yet:</strong>
              <ul style={{ paddingLeft: 18 }}>
                {v.reasons.map((r) => (
                  <li key={r}>{r === "MISSING_SKILLS" ? `Add these skills to your profile if you have them: ${v.missingSkills.join(", ")}` : WORK_INELIGIBLE_LABELS[r]}</li>
                ))}
              </ul>
            </div>
          )}
          {v?.hasProfile && !v.assignmentId && v.eligible && job.hiringMode === "INSTANT_ACCEPT" && (
            <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => void accept()}>
              {busy ? "Reserving your place…" : `Take this job for ${money(job.payPerWorkerPaise)}`}
            </button>
          )}
          {v?.hasProfile && !v.assignmentId && v.eligible && job.hiringMode === "APPLY_AND_SELECT" && !v.applicationStatus && (
            <>
              <label className={styles.field}>
                Note to the business (optional)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} />
              </label>
              <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => void apply()}>
                Apply
              </button>
            </>
          )}
          {v?.applicationStatus === "APPLIED" && <p className={styles.notice}>You applied. The business hasn’t decided yet.</p>}
          {v?.applicationStatus === "OFFERED" && (
            <div className={styles.actions}>
              <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => void respond("ACCEPT")}>
                Accept offer
              </button>
              <button type="button" className={styles.btn} disabled={busy} onClick={() => void respond("DECLINE")}>
                Decline
              </button>
            </div>
          )}
          {v?.applicationStatus === "REJECTED" && <p className={styles.notice}>The business chose other workers for this job.</p>}
          <p className={styles.demo}>FastQue never asks workers to pay a fee or deposit. Report any job that does.</p>
        </aside>
      </div>
    </main>
  );
}
