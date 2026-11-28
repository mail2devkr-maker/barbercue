"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useParams } from "next/navigation";
import type { WorkEmployerJobDto, WorkFundingDto } from "@barbercue/shared";
import { RequireRole } from "../../../../../../../components/auth/RequireRole";
import { ASSIGNMENT_STATUS, errorText, JOB_STATUS, money, PAY_TYPE_LABEL, PAYOUT_STATUS, timeRange, when, workGet, workSend } from "../../../../../../../lib/work";
import { Badge, SandboxNote, WorkNav } from "../../../../WorkUi";
import { JobForm } from "../../../JobForm";
import styles from "../../../../work.module.css";

function EmployerJob() {
  const { orgId, jobId } = useParams<{ orgId: string; jobId: string }>();
  const [job, setJob] = useState<WorkEmployerJobDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const base = `orgs/${orgId}/jobs/${jobId}`;
  const load = useCallback(() => {
    workGet<WorkEmployerJobDto>(base)
      .then(setJob)
      .catch((err) => setError(errorText(err, "Job not found.")));
  }, [base]);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      load();
    } catch (err) {
      setError(errorText(err));
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!job) return error ? <p className={styles.error} role="alert">{error}</p> : <div className={styles.skeleton} aria-busy="true" />;
  if (editing) {
    return (
      <>
        <h1 className={styles.title}>Edit draft</h1>
        <JobForm
          orgId={orgId}
          initial={job}
          onSaved={(j) => {
            setJob(j);
            setEditing(false);
          }}
        />
      </>
    );
  }

  const st = JOB_STATUS[job.status];
  const q = job.quote;
  const funding = job.funding;
  const editable = ["DRAFT", "PENDING_VERIFICATION", "FUNDING_REQUIRED"].includes(job.status);
  const live = !["DRAFT", "PENDING_VERIFICATION", "FUNDING_REQUIRED", "REJECTED", "CLOSED", "CANCELLED"].includes(job.status);
  return (
    <>
      <Link href="/work/business" className={styles.meta}>
        ← Business
      </Link>
      <div className={styles.jobHead}>
        <div className={styles.rowMain}>
          <h1 className={styles.title}>{job.title}</h1>
          <span className={styles.meta}>
            {job.categoryName} · {timeRange(job.startsAt, job.endsAt)} · {job.city}
          </span>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.success} role="status">{notice}</p>}
      {job.moderationNote && <p className={styles.notice}><strong>Reviewer’s note:</strong> {job.moderationNote}</p>}
      {job.screeningFlags.length > 0 && job.status === "PENDING_VERIFICATION" && (
        <p className={styles.notice}>
          This job is with our team for a quick check because it mentions: {job.screeningFlags.map((f) => f.label.toLowerCase()).join(", ")}. Workers must never be asked to pay or share passwords/IDs.
        </p>
      )}

      <div className={styles.twoCol}>
        <div className={styles.list} style={{ gap: "var(--bc-space-4)" }}>
          {job.status === "DRAFT" && (
            <section className={styles.card} aria-label="Preview">
              <h2 className={styles.sectionTitle}>Preview — this is what workers will see</h2>
              <p>{job.description}</p>
              <p className={styles.meta}>
                {money(job.payPerWorkerPaise)} guaranteed, {PAY_TYPE_LABEL[job.payType]} · {job.positions} workers · {job.hiringMode === "INSTANT_ACCEPT" ? "instant accept" : "apply and select"}
              </p>
              <ol className={styles.checklist}>
                {job.checklist.map((c) => (
                  <li key={c.id} className={styles.checkItem}>
                    {c.label} <span className={styles.chip}>{c.kind.toLowerCase()}</span>
                  </li>
                ))}
              </ol>
              <p className={styles.meta}>Complete when: {job.completionCriteria}</p>
              <p className={styles.meta}>
                Cancellation after arrival: {money(job.cancellationTerms.employerCancelAfterArrivalPaise)} · Late cancellation ({job.cancellationTerms.workerLateCancelHours} h): {money(job.cancellationTerms.employerLateCancelPaise)} · Review window: {job.reviewWindowHours} h
              </p>
              <div className={styles.actions}>
                <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => void act(() => workSend(`${base}/publish`, { version: job.version }), "Checked and ready for funding.")}>
                  I’ve checked this — publish
                </button>
                <button type="button" className={styles.btn} onClick={() => setEditing(true)}>
                  Edit
                </button>
              </div>
            </section>
          )}

          {job.status === "FUNDING_REQUIRED" && (
            <section className={styles.card} aria-label="Funding">
              <h2 className={styles.sectionTitle}>Fund this job to open it to workers</h2>
              <p>
                Amount: <strong>{money(q.employerTotalPaise)}</strong> ({money(q.workerPayTotalPaise)} worker pay + {money(q.platformFeeTotalPaise)} fee). Unused funds are released back when the job closes.
              </p>
              {funding?.sandbox && <SandboxNote />}
              <div className={styles.actions}>
                {(!funding || funding.status === "FAILED") && (
                  <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => void act(() => workSend<WorkFundingDto>(`${base}/fund`, { version: job.version }, "POST", true), "Payment order created.")}>
                    Create payment order
                  </button>
                )}
                {funding?.status === "CREATED" && funding.sandbox && (
                  <>
                    <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => void act(() => workSend(`sandbox/fundings/${funding.id}/complete`, { outcome: "SUCCEEDED" }), "Sandbox payment confirmed — your job is open.")}>
                      Complete sandbox payment
                    </button>
                    <button type="button" className={styles.btnGhost} disabled={busy} onClick={() => void act(() => workSend(`sandbox/fundings/${funding.id}/complete`, { outcome: "FAILED" }), "Sandbox payment declined.")}>
                      Simulate a declined payment
                    </button>
                  </>
                )}
                {funding?.status === "CREATED" && !funding.sandbox && !funding.manualBank && !funding.manualUpi && <p className={styles.meta}>Waiting for the payment provider to confirm…</p>}
                <button type="button" className={styles.btn} onClick={() => setEditing(true)}>
                  Edit (returns to draft)
                </button>
              </div>
              {funding?.status === "CREATED" && funding.manualUpi && (
                <div className={styles.notice} role="note">
                  <p>
                    <strong>Pay by UPI</strong> exactly <strong>{money(funding.amountPaise)}</strong> to <strong>{funding.manualUpi.payeeName}</strong>:
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
                    <div style={{ background: "#fff", padding: 10, borderRadius: 12, lineHeight: 0 }} data-keep-colors>
                      <QRCodeSVG value={funding.manualUpi.upiUri} size={168} aria-label="UPI payment QR code" />
                    </div>
                    <dl className={styles.kv}>
                      <dt>UPI ID</dt><dd>{funding.manualUpi.vpa}</dd>
                      <dt>Amount</dt><dd>{money(funding.amountPaise)}</dd>
                      <dt>Note / reference</dt><dd><strong>{funding.manualUpi.reference}</strong></dd>
                    </dl>
                  </div>
                  <p>
                    <a className={styles.btnPrimary} href={funding.manualUpi.upiUri}>Open UPI app</a>
                  </p>
                  <p className={styles.meta}>
                    Scan the QR with any UPI app (or tap the button on your phone) and keep the reference in the note. Your job opens to workers once FastQue finance matches the payment, usually within one working day. FastQue never asks you to pay anyone else.
                  </p>
                </div>
              )}
              {funding?.status === "CREATED" && funding.manualBank && (
                <div className={styles.notice} role="note">
                  <p>
                    <strong>Pay by bank transfer (NEFT / IMPS / RTGS)</strong> of exactly <strong>{money(funding.amountPaise)}</strong> to:
                  </p>
                  <dl className={styles.kv}>
                    <dt>Account name</dt><dd>{funding.manualBank.accountName}</dd>
                    <dt>Account number</dt><dd>{funding.manualBank.accountNumber}</dd>
                    <dt>IFSC</dt><dd>{funding.manualBank.ifsc}</dd>
                    <dt>Bank</dt><dd>{funding.manualBank.bankName}</dd>
                    <dt>Remarks / reference</dt><dd><strong>{funding.manualBank.reference}</strong></dd>
                  </dl>
                  <p className={styles.meta}>
                    Write the reference in the transfer remarks. Your job opens to workers once FastQue finance sees the money on the bank statement, usually within one working day. Pay from your business account; FastQue never asks you to pay anyone else.
                  </p>
                </div>
              )}
              {funding?.status === "FAILED" && <p className={styles.error}>The last payment attempt failed. You can try again.</p>}
            </section>
          )}

          {job.applications.length > 0 && (
            <section className={styles.card} aria-label="Applicants">
              <h2 className={styles.sectionTitle}>Applicants</h2>
              <div className={styles.list}>
                {job.applications.map((a) => (
                  <div key={a.id} className={styles.row}>
                    <span className={styles.rowMain}>
                      <strong>{a.workerName}</strong>
                      <span className={styles.meta}>
                        {a.verificationLevel >= 2 ? "Verified" : "Phone verified"} · {a.completedAssignments} completed jobs · applied {when(a.createdAt)}
                      </span>
                      {a.note && <span>“{a.note}”</span>}
                    </span>
                    {a.status === "APPLIED" ? (
                      <span className={styles.actions}>
                        <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => void act(() => workSend(`orgs/${orgId}/applications/${a.id}/decide`, { decision: "OFFER" }), "Offer sent.")}>
                          Offer
                        </button>
                        <button type="button" className={styles.btnGhost} disabled={busy} onClick={() => void act(() => workSend(`orgs/${orgId}/applications/${a.id}/decide`, { decision: "REJECT" }), "Application declined.")}>
                          Decline
                        </button>
                      </span>
                    ) : (
                      <Badge tone="grey">{a.status.toLowerCase()}</Badge>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {job.assignments.length > 0 && (
            <section className={styles.card} aria-label="Workers">
              <h2 className={styles.sectionTitle}>Workers</h2>
              <div className={styles.list}>
                {job.assignments.map((a) => (
                  <Link key={a.id} href={`/work/business/${orgId}/assignments/${a.id}`} className={styles.row}>
                    <span className={styles.rowMain}>
                      <strong>
                        #{a.slotNumber} {a.workerName}
                      </strong>
                      {a.duplicateFlags > 0 && <span className={styles.meta}>⚠ {a.duplicateFlags} answer(s) match another submission — check before approving</span>}
                    </span>
                    <span className={styles.actions}>
                      <Badge tone={ASSIGNMENT_STATUS[a.status].tone}>{ASSIGNMENT_STATUS[a.status].label}</Badge>
                      {a.payoutStatus && <Badge tone={PAYOUT_STATUS[a.payoutStatus].tone}>{PAYOUT_STATUS[a.payoutStatus].label}</Badge>}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className={styles.list} style={{ gap: "var(--bc-space-4)" }}>
          <section className={styles.card} aria-label="Summary">
            <div className={styles.pay}>{money(job.payPerWorkerPaise)}</div>
            <span className={styles.meta}>per worker · {job.positions - job.slotsLeft}/{job.positions} places taken</span>
            <span className={styles.meta}>Total funded for this job: {money(q.employerTotalPaise)}</span>
          </section>
          {job.checkInCode && live && (
            <section className={styles.card} aria-label="Check-in code">
              <h2 className={styles.sectionTitle}>On-site check-in code</h2>
              <div className={styles.code} aria-label={`Check-in code ${job.checkInCode.split("").join(" ")}`}>
                {job.checkInCode}
              </div>
              <p className={styles.meta}>Show this to workers when they arrive. You can also confirm attendance from each worker’s page.</p>
            </section>
          )}
          <section className={styles.card} aria-label="Close or cancel">
            <h2 className={styles.sectionTitle}>Finish</h2>
            {["OPEN", "PARTIALLY_FILLED", "FILLED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED"].includes(job.status) && (
              <button type="button" className={styles.btn} disabled={busy} onClick={() => void act(() => workSend(`${base}/close`), "Job closed. Unused funds were released.")}>
                Close job and release unused funds
              </button>
            )}
            {(editable || live) && (
              <>
                <input aria-label="Cancellation reason" placeholder="Reason for cancelling" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid var(--bc-border)" }} />
                <button type="button" className={styles.btnDanger} disabled={busy || cancelReason.trim().length < 3} onClick={() => void act(() => workSend(`${base}/cancel`, { reason: cancelReason }), "Job cancelled. Workers who had arrived receive the disclosed compensation.")}>
                  Cancel job
                </button>
                <p className={styles.hint}>Workers who already checked in get {money(job.cancellationTerms.employerCancelAfterArrivalPaise)} each.</p>
              </>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

export default function EmployerJobPage() {
  return (
    <RequireRole redirectTo="/login">
      <main className={styles.page}>
        <WorkNav />
        <EmployerJob />
      </main>
    </RequireRole>
  );
}
