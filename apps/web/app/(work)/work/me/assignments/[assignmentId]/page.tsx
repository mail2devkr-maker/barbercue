"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { WORK_DISPUTE_REASON_LABELS, WorkDisputeReason, type WorkAssignmentDetailDto, type WorkChecklistItem } from "@barbercue/shared";
import { RequireRole } from "../../../../../../components/auth/RequireRole";
import { ASSIGNMENT_STATUS, errorText, money, PAYOUT_STATUS, timeRange, when, workGet, workSend, workUpload } from "../../../../../../lib/work";
import { Badge, EvidenceThumb, WorkNav } from "../../../WorkUi";
import styles from "../../../work.module.css";

const EDITABLE = ["ACCEPTED", "CHECKED_IN", "REWORK_REQUESTED"];

function ChecklistItemRow({ item, a, editable, onChange }: { item: WorkChecklistItem; a: WorkAssignmentDetailDto; editable: boolean; onChange: () => void }) {
  const r = a.responses.find((x) => x.itemId === item.id);
  const [text, setText] = useState(r?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = item.kind === "PHOTO" ? !!r?.evidenceFileId : item.kind === "TEXT" ? !!r?.text : !!r?.confirmed;

  async function save(body: { confirmed?: boolean; text?: string }) {
    setBusy(true);
    setError(null);
    try {
      await workSend(`assignments/${a.id}/responses/${item.id}`, body, "PUT");
      onChange();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await workUpload(`assignments/${a.id}/evidence/${item.id}`, file);
      onChange();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`${styles.checkItem} ${done ? styles.checkDone : ""}`}>
      <strong>
        {done ? "✓ " : ""}
        {item.label}
        {!item.required && <span className={styles.meta}> (optional)</span>}
      </strong>
      {item.kind === "CONFIRM" && (
        <label className={styles.field} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" disabled={!editable || busy} checked={!!r?.confirmed} onChange={(e) => void save({ confirmed: e.target.checked })} style={{ width: 22, minHeight: 22 }} />
          Done
        </label>
      )}
      {item.kind === "TEXT" && (
        <div className={styles.actions}>
          <input aria-label={item.label} className={styles.field} style={{ flex: 1, padding: 10, border: "1px solid var(--bc-border)", borderRadius: 8 }} value={text} disabled={!editable || busy} onChange={(e) => setText(e.target.value)} />
          {editable && (
            <button type="button" className={styles.btn} disabled={busy || text === (r?.text ?? "")} onClick={() => void save({ text })}>
              Save
            </button>
          )}
        </div>
      )}
      {item.kind === "PHOTO" && (
        <div className={styles.actions}>
          {r?.evidenceFileId && <EvidenceThumb fileId={r.evidenceFileId} />}
          {editable && (
            <label className={styles.btn}>
              {r?.evidenceFileId ? "Replace photo" : "Take or choose photo"}
              <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className={styles.srOnly} disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
            </label>
          )}
        </div>
      )}
      {error && <span className={styles.error}>{error}</span>}
    </li>
  );
}

function AssignmentView() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const [a, setA] = useState<WorkAssignmentDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [dispute, setDispute] = useState({ reasonCode: WorkDisputeReason.UNFAIR_REJECTION as WorkDisputeReason, description: "" });

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
      load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function gpsCheckIn() {
    if (!navigator.geolocation) {
      setError("Location is not available on this device. Use the on-site code or ask the business to confirm your attendance.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => void act(() => workSend(`assignments/${assignmentId}/check-in`, { method: "GPS", latitude: pos.coords.latitude, longitude: pos.coords.longitude, locationConsent: true }), "Checked in."),
      () => setError("We couldn’t get your location. Use the on-site code or ask the business to confirm your attendance."),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  if (!a) return error ? <p className={styles.error} role="alert">{error}</p> : <div className={styles.skeleton} aria-busy="true" />;

  const editable = EDITABLE.includes(a.status) && !(a.status === "ACCEPTED" && a.job.requiresCheckIn);
  const status = ASSIGNMENT_STATUS[a.status];
  const terms = a.job.cancellationTerms;
  return (
    <>
      <Link href="/work/me" className={styles.meta}>
        ← My work
      </Link>
      <div className={styles.jobHead}>
        <div className={styles.rowMain}>
          <h1 className={styles.title}>{a.jobTitle}</h1>
          <span className={styles.meta}>
            {a.employerName} · {timeRange(a.startsAt, a.endsAt)}
          </span>
        </div>
        <div className={styles.actions}>
          <Badge tone={status.tone}>{status.label}</Badge>
          {a.payoutStatus && <Badge tone={PAYOUT_STATUS[a.payoutStatus].tone}>{PAYOUT_STATUS[a.payoutStatus].label}</Badge>}
        </div>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.success} role="status">{notice}</p>}
      {a.status === "REWORK_REQUESTED" && a.reviewNote && (
        <p className={styles.notice}>
          <strong>The business asked for changes:</strong> {a.reviewNote}
        </p>
      )}

      <div className={styles.twoCol}>
        <div className={styles.list} style={{ gap: "var(--bc-space-4)" }}>
          {a.status === "ACCEPTED" && a.job.requiresCheckIn && (
            <section className={styles.card} aria-label="Check in">
              <h2 className={styles.sectionTitle}>Check in when you arrive</h2>
              <p className={styles.meta}>Check-in opens one hour before the start. Ask the person in charge for the 6-digit code.</p>
              <div className={styles.actions}>
                <input aria-label="Check-in code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} style={{ fontSize: "1.4rem", letterSpacing: "0.3em", width: 170, padding: 10, borderRadius: 10, border: "1px solid var(--bc-border)" }} />
                <button type="button" className={styles.btnPrimary} disabled={busy || code.length !== 6} onClick={() => void act(() => workSend(`assignments/${a.id}/check-in`, { method: "QR_CODE", code }), "Checked in. You can start the checklist.")}>
                  Check in
                </button>
                <button type="button" className={styles.btn} disabled={busy} onClick={gpsCheckIn}>
                  Use my location once
                </button>
              </div>
              <p className={styles.hint}>Your location is read only when you press the button, only once, and only shared with this business.</p>
            </section>
          )}

          <section className={styles.card} aria-label="Checklist">
            <h2 className={styles.sectionTitle}>Checklist</h2>
            <ol className={styles.checklist}>
              {a.job.checklist.map((item) => (
                <ChecklistItemRow key={item.id} item={item} a={a} editable={editable} onChange={load} />
              ))}
            </ol>
            <p className={styles.meta}>Complete when: {a.job.completionCriteria}</p>
            {editable && (
              <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => void act(() => workSend(`assignments/${a.id}/submit`), "Submitted. The business has until the review deadline to respond.")}>
                Submit my work
              </button>
            )}
            {a.reviewDueAt && a.status === "SUBMITTED" && <p className={styles.notice}>If the business doesn’t review by {when(a.reviewDueAt)}, your work is approved automatically.</p>}
          </section>

          {["REWORK_REQUESTED", "CHECKED_IN"].includes(a.status) || a.status === "NO_SHOW_REVIEW" ? (
            <section className={styles.card} aria-label="Raise a dispute">
              <h2 className={styles.sectionTitle}>Something wrong?</h2>
              <p className={styles.meta}>A FastQue reviewer looks at both sides and decides. Your work is never rejected automatically.</p>
              <label className={styles.field}>
                Reason
                <select value={dispute.reasonCode} onChange={(e) => setDispute((d) => ({ ...d, reasonCode: e.target.value as WorkDisputeReason }))}>
                  {(["UNFAIR_REJECTION", "NO_WORK_AVAILABLE", "UNSAFE_CONDITIONS", "NO_SHOW", "OTHER"] as WorkDisputeReason[]).map((r) => (
                    <option key={r} value={r}>
                      {r === "NO_SHOW" ? "I did attend (no-show report is wrong)" : WORK_DISPUTE_REASON_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                What happened
                <textarea value={dispute.description} onChange={(e) => setDispute((d) => ({ ...d, description: e.target.value }))} maxLength={2000} />
              </label>
              <button type="button" className={styles.btnDanger} disabled={busy || dispute.description.trim().length < 10} onClick={() => void act(() => workSend(`assignments/${a.id}/disputes`, dispute), "Dispute opened. We’ll review it and tell you the outcome.")}>
                Open a dispute
              </button>
            </section>
          ) : null}

          {a.disputes.length > 0 && (
            <section className={styles.card} aria-label="Disputes">
              <h2 className={styles.sectionTitle}>Disputes</h2>
              {a.disputes.map((d) => (
                <div key={d.id} className={styles.notice}>
                  <strong>{WORK_DISPUTE_REASON_LABELS[d.reasonCode]}</strong> — opened by {d.openedBy === "WORKER" ? "you" : "the business"} on {when(d.createdAt)}
                  <p>{d.description}</p>
                  {d.status === "RESOLVED" ? <p><strong>Decision:</strong> {money(d.awardPaise ?? 0)} — {d.resolutionNote}</p> : <p>Under review by FastQue.</p>}
                </div>
              ))}
            </section>
          )}
        </div>

        <aside className={styles.list} style={{ gap: "var(--bc-space-4)" }}>
          <section className={styles.card} aria-label="Pay">
            <div className={styles.pay}>{money(a.approvedAmountPaise ?? a.agreedPayPaise)}</div>
            <span className={styles.meta}>{a.approvedAmountPaise !== null ? "Approved amount" : "Agreed pay (locked when you accepted)"}</span>
            <p className={styles.meta}>
              📍 {a.job.locationType === "REMOTE" ? "Remote" : [a.job.addressLine, a.job.city].filter(Boolean).join(", ")}
            </p>
            <p className={styles.meta}>If the business cancels after you arrive you get {money(terms.employerCancelAfterArrivalPaise)}.</p>
          </section>
          {a.status === "ACCEPTED" && (
            <section className={styles.card} aria-label="Withdraw">
              <h2 className={styles.sectionTitle}>Can’t make it?</h2>
              <p className={styles.meta}>Withdraw before check-in. Less than {terms.workerLateCancelHours} h before the start counts as a late cancellation on your record. There is never a fee.</p>
              <input aria-label="Reason" placeholder="Reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} style={{ padding: 10, borderRadius: 8, border: "1px solid var(--bc-border)" }} />
              <button type="button" className={styles.btnDanger} disabled={busy || cancelReason.trim().length < 3} onClick={() => void act(() => workSend(`assignments/${a.id}/cancel`, { reason: cancelReason }), "You’ve withdrawn from this job.")}>
                Withdraw
              </button>
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

export default function WorkerAssignmentPage() {
  return (
    <RequireRole redirectTo="/login">
      <main className={styles.page}>
        <WorkNav />
        <AssignmentView />
      </main>
    </RequireRole>
  );
}
