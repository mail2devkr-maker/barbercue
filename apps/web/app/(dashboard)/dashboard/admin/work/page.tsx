"use client";

import { useCallback, useEffect, useState } from "react";
import { Role, type WorkAdminOverviewDto, type WorkAssignmentDetailDto, type WorkLedgerTrialBalanceDto, type WorkOrgDto } from "@barbercue/shared";
import { useAuth } from "../../../../../lib/auth-context";
import { apiFetchBlob } from "../../../../../lib/api";
import { errorText, JOB_STATUS, money, ORG_STATUS, PAYOUT_STATUS, W, when, workGet, workSend } from "../../../../../lib/work";
import { Badge, EvidenceThumb, SandboxNote, Stat } from "../../../../(work)/work/WorkUi";
import styles from "../../../../(work)/work/work.module.css";

type Tab = "overview" | "kyc" | "jobs" | "workers" | "transfers" | "payouts" | "disputes" | "ledger" | "audit";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "kyc", label: "Business KYC" },
  { id: "jobs", label: "Job moderation" },
  { id: "workers", label: "Workers" },
  { id: "transfers", label: "Bank transfers" },
  { id: "payouts", label: "Payouts" },
  { id: "disputes", label: "Disputes" },
  { id: "ledger", label: "Ledger" },
  { id: "audit", label: "Audit trail" },
];

interface AdminJob { id: string; title: string; orgName: string; orgStatus: string; category: string; status: keyof typeof JOB_STATUS; city: string; positions: number; filled: number; payPerWorkerPaise: number; startsAt: string; screeningFlags: { code: string; label: string }[]; description: string }
interface AdminWorker { userId: string; fullName: string; workerType: string; city: string; verificationLevel: number; suspended: boolean; createdAt: string; skills: string[] }
interface AdminPayout { id: string; assignmentId: string; jobTitle: string; orgName: string; amountPaise: number; attempt: number; provider: string; status: keyof typeof PAYOUT_STATUS; failureReason: string | null; manualUtr: string | null; createdAt: string }
interface PaymentsConfig { provider: string; sandbox: boolean; payoutMethod: "UPI" | "BANK" }
interface ManualFunding { id: string; reference: string; amountPaise: number; jobId: string; jobTitle: string; orgName: string; orgLegalName: string; jobStillWaiting: boolean; createdAt: string }
interface AdminDispute { id: string; assignmentId: string; jobTitle: string; orgName: string; openedBy: string; reasonCode: string; description: string; status: string; awardPaise: number | null; resolutionNote: string | null; agreedPayPaise: number; slaDueAt: string; overdue: boolean }
interface AuditRow { id: string; entityType: string; entityId: string; action: string; fromStatus: string | null; toStatus: string | null; actorParty: string; note: string | null; createdAt: string }

function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!path) return;
    workGet<T>(path)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(errorText(err)));
  }, [path]);
  useEffect(load, [load]);
  return { data, error, reload: load };
}

export default function AdminWorkPage() {
  const { user } = useAuth();
  const canWrite = !!user?.roles.includes(Role.PLATFORM_ADMIN);
  // Work reviewer: may take review decisions (KYC, worker verify, job moderation) and nothing else.
  const canReview = canWrite || !!user?.roles.includes(Role.WORK_REVIEWER);
  const [tab, setTab] = useState<Tab>("overview");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<unknown>, ok: string, reload: () => void) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }
  const ask = (q: string) => (typeof window === "undefined" ? null : window.prompt(q));

  return (
    <main className={styles.page} style={{ maxWidth: 1280 }}>
      <div>
        <h1 className={styles.title}>FastQue Work</h1>
        <p className={styles.sub}>Marketplace control centre. Every action here is recorded in the audit trail. {canWrite ? "" : canReview ? "" : "You have read-only access."}</p>
      </div>
      <div className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {msg && <p className={msg.ok ? styles.success : styles.error} role="status">{msg.text}</p>}
      {tab === "overview" && <Overview />}
      {tab === "kyc" && <Kyc canWrite={canReview} busy={busy} act={act} ask={ask} />}
      {tab === "jobs" && <Jobs canWrite={canReview} busy={busy} act={act} ask={ask} />}
      {tab === "workers" && <Workers canWrite={canReview} canSuspend={canWrite} busy={busy} act={act} ask={ask} />}
      {tab === "transfers" && <Transfers canWrite={canWrite} busy={busy} act={act} ask={ask} />}
      {tab === "payouts" && <Payouts canWrite={canWrite} busy={busy} act={act} ask={ask} />}
      {tab === "disputes" && <Disputes canWrite={canWrite} busy={busy} act={act} ask={ask} />}
      {tab === "ledger" && <Ledger />}
      {tab === "audit" && <Audit />}
    </main>
  );
}

type Act = (fn: () => Promise<unknown>, ok: string, reload: () => void) => Promise<void>;
interface Props { canWrite: boolean; busy: boolean; act: Act; ask: (q: string) => string | null }

function Overview() {
  const { data, error } = useLoad<WorkAdminOverviewDto>("admin/overview");
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <div className={styles.skeleton} />;
  return (
    <>
      {!data.ledgerBalanced && <p className={styles.error}>The ledger does not reconcile. Open the Ledger tab before approving any payouts.</p>}
      <div className={styles.stats}>
        <Stat label="Worker profiles" value={data.workers} />
        <Stat label="Verified workers" value={data.verifiedWorkers} />
        <Stat label="Verified businesses" value={data.orgs.VERIFIED} />
        <Stat label="KYC waiting" value={data.pendingKyc} />
        <Stat label="Jobs in moderation" value={data.jobsAwaitingModeration} />
        <Stat label="Open disputes" value={data.openDisputes} />
        <Stat label="Gross funded" value={money(data.grossFundedPaise)} />
        <Stat label="Platform fees earned" value={money(data.platformFeesPaise)} />
        <Stat label="Owed to workers" value={money(data.workerPayoutLiabilityPaise)} />
        <Stat label="Paid out" value={money(data.paidOutPaise)} />
        <Stat label="Payout success" value={data.payoutSuccessRate === null ? "—" : `${Math.round(data.payoutSuccessRate * 100)}%`} />
        <Stat label="Ledger" value={data.ledgerBalanced ? "Balanced" : "UNBALANCED"} />
      </div>
      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>Jobs by status</h2>
        <div className={styles.chips}>
          {Object.entries(data.jobs).map(([s, n]) => (
            <Badge key={s} tone={JOB_STATUS[s as keyof typeof JOB_STATUS]?.tone ?? "grey"}>
              {JOB_STATUS[s as keyof typeof JOB_STATUS]?.label ?? s}: {n}
            </Badge>
          ))}
        </div>
        <h2 className={styles.sectionTitle}>Assignments by status</h2>
        <div className={styles.chips}>
          {Object.entries(data.assignments).map(([s, n]) => (
            <span key={s} className={styles.chip}>
              {s.toLowerCase().replace(/_/g, " ")}: {n}
            </span>
          ))}
        </div>
      </section>
    </>
  );
}

function Kyc({ canWrite, busy, act, ask }: Props) {
  const { data, error, reload } = useLoad<WorkOrgDto[]>("admin/orgs");
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <div className={styles.skeleton} />;
  const review = (id: string, decision: string, reason?: string | null) => act(() => workSend(`admin/orgs/${id}/review`, { decision, reason: reason ?? undefined }), `Business ${decision.toLowerCase().replace(/_/g, " ")}.`, reload);
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr><th>Business</th><th>Details</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {data.map((o) => (
            <tr key={o.id}>
              <td><strong>{o.displayName}</strong><div className={styles.meta}>{o.legalName}</div></td>
              <td className={styles.meta}>
                {o.orgType} · GSTIN {o.gstin ?? "none"}<br />{o.registeredAddress}, {o.city}<br />{o.contactName} · {o.contactPhone} · {o.contactEmail}
              </td>
              <td><Badge tone={ORG_STATUS[o.status].tone}>{ORG_STATUS[o.status].label}</Badge>{o.rejectionReason && <div className={styles.meta}>{o.rejectionReason}</div>}</td>
              <td>
                {canWrite && (
                  <div className={styles.actions}>
                    {o.status === "SUBMITTED" && <button className={styles.btn} disabled={busy} onClick={() => void review(o.id, "MARK_UNDER_REVIEW")}>Start review</button>}
                    {["SUBMITTED", "UNDER_REVIEW", "SUSPENDED"].includes(o.status) && <button className={styles.btnPrimary} disabled={busy} onClick={() => void review(o.id, "VERIFY")}>Verify</button>}
                    {["SUBMITTED", "UNDER_REVIEW"].includes(o.status) && <button className={styles.btnDanger} disabled={busy} onClick={() => { const r = ask("Reason shown to the business:"); if (r) void review(o.id, "REJECT", r); }}>Reject</button>}
                    {o.status === "VERIFIED" && <button className={styles.btnDanger} disabled={busy} onClick={() => { const r = ask("Reason for suspension:"); if (r) void review(o.id, "SUSPEND", r); }}>Suspend</button>}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Jobs({ canWrite, busy, act, ask }: Props) {
  const { data, error, reload } = useLoad<AdminJob[]>("admin/jobs");
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <div className={styles.skeleton} />;
  const flagged = data.filter((j) => j.status === "PENDING_VERIFICATION");
  return (
    <>
      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>Waiting for moderation ({flagged.length})</h2>
        {flagged.length === 0 && <p className={styles.meta}>Nothing to moderate.</p>}
        {flagged.map((j) => (
          <div key={j.id} className={styles.checkItem}>
            <strong>{j.title}</strong>
            <span className={styles.meta}>{j.orgName} · {j.category} · {money(j.payPerWorkerPaise)} × {j.positions}</span>
            <span>{j.description}</span>
            <div className={styles.chips}>{j.screeningFlags.map((f) => <Badge key={f.code} tone="red">{f.label}</Badge>)}</div>
            {canWrite && (
              <div className={styles.actions}>
                <button className={styles.btnPrimary} disabled={busy} onClick={() => void act(() => workSend(`admin/jobs/${j.id}/moderate`, { decision: "APPROVE" }), "Job approved for funding.", reload)}>Approve</button>
                <button className={styles.btnDanger} disabled={busy} onClick={() => { const r = ask("Reason shown to the business:"); if (r) void act(() => workSend(`admin/jobs/${j.id}/moderate`, { decision: "REJECT", reason: r }), "Job rejected.", reload); }}>Reject</button>
              </div>
            )}
          </div>
        ))}
      </section>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Job</th><th>Business</th><th>City</th><th>Starts</th><th>Filled</th><th>Pay</th><th>Status</th></tr></thead>
          <tbody>
            {data.map((j) => (
              <tr key={j.id}>
                <td>{j.title}</td><td>{j.orgName}</td><td>{j.city}</td><td>{when(j.startsAt)}</td><td>{j.filled}/{j.positions}</td><td>{money(j.payPerWorkerPaise)}</td>
                <td><Badge tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Workers({ canWrite, canSuspend, busy, act, ask }: Props & { canSuspend: boolean }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, reload } = useLoad<AdminWorker[]>(`admin/workers${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  return (
    <>
      <form className={styles.filters} onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
        <label className={styles.field}>Search name or city<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <button className={styles.btn} type="submit">Search</button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
      {data && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Worker</th><th>City</th><th>Level</th><th>Joined</th><th /></tr></thead>
            <tbody>
              {data.map((w) => (
                <tr key={w.userId}>
                  <td><strong>{w.fullName}</strong><div className={styles.meta}>{w.workerType} · {w.skills.join(", ")}</div></td>
                  <td>{w.city}</td>
                  <td>{w.verificationLevel}{w.suspended && <> <Badge tone="red">Suspended</Badge></>}</td>
                  <td>{when(w.createdAt)}</td>
                  <td>
                    {canWrite && (
                      <div className={styles.actions}>
                        {w.verificationLevel < 2 && <button className={styles.btn} disabled={busy} onClick={() => { const n = ask("How was eligibility checked? (recorded in the audit trail)"); if (n) void act(() => workSend(`admin/workers/${w.userId}/verify`, { note: n }), "Worker verified (level 2).", reload); }}>Verify eligibility</button>}
                        {canSuspend && <button className={styles.btnGhost} disabled={busy} onClick={() => { const r = ask(w.suspended ? "Reason for reinstating:" : "Reason for suspending (worker can appeal):"); if (r) void act(() => workSend(`admin/workers/${w.userId}/suspension`, { suspended: !w.suspended, reason: r }), w.suspended ? "Worker reinstated." : "Worker suspended.", reload); }}>{w.suspended ? "Reinstate" : "Suspend"}</button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Asks for a bank UTR; null when cancelled. Letters and digits only, as on the statement. */
function askUtr(ask: Props["ask"], q: string): string | null {
  const v = ask(q);
  if (v === null) return null;
  const utr = v.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,30}$/.test(utr)) {
    window.alert("Enter the UTR exactly as on the bank statement: 6 to 30 letters and digits.");
    return null;
  }
  return utr;
}

async function downloadNeftFile() {
  const { blob, filename } = await apiFetchBlob(`${W}/admin/payouts/neft-export.csv`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? "fastque-work-neft.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Transfers({ canWrite, busy, act, ask }: Props) {
  const cfg = useLoad<PaymentsConfig>("admin/payments/config");
  const manual = cfg.data?.provider === "manual_bank";
  const { data, error, reload } = useLoad<ManualFunding[]>(manual ? "admin/fundings/manual" : null);
  if (cfg.error) return <p className={styles.error}>{cfg.error}</p>;
  if (!cfg.data) return <div className={styles.skeleton} />;
  if (!manual) return <p className={styles.notice}>Bank transfer is not the active payment method, so there is nothing to confirm here.</p>;
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <div className={styles.skeleton} />;
  return (
    <>
      <p className={styles.notice}>
        Match each transfer on the company bank statement: same reference in the remarks and exactly the amount shown. Confirming opens the job to workers and cannot be undone.
      </p>
      {data.length === 0 && <p className={styles.meta}>No transfers waiting.</p>}
      {data.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Reference</th><th>Business</th><th>Job</th><th>Amount</th><th>Ordered</th><th /></tr></thead>
            <tbody>
              {data.map((f) => (
                <tr key={f.id}>
                  <td><strong>{f.reference}</strong></td>
                  <td>{f.orgName}<div className={styles.meta}>{f.orgLegalName}</div></td>
                  <td>{f.jobTitle}{!f.jobStillWaiting && <div className={styles.meta}>Job changed since: money will be released back to the business balance.</div>}</td>
                  <td>{money(f.amountPaise)}</td>
                  <td>{when(f.createdAt)}</td>
                  <td>
                    {canWrite && (
                      <div className={styles.actions}>
                        <button className={styles.btnPrimary} disabled={busy} onClick={() => {
                          const utr = askUtr(ask, `UTR of the ${money(f.amountPaise)} credit with reference ${f.reference}:`);
                          if (!utr) return;
                          const amt = ask(`Amount credited on the statement, in ₹ (must be exactly ${f.amountPaise / 100}):`);
                          if (amt === null) return;
                          void act(() => workSend(`admin/fundings/${f.id}/manual-confirm`, { outcome: "RECEIVED", utr, amountPaise: Math.round(Number(amt) * 100) }), "Transfer confirmed. The job is open to workers.", reload);
                        }}>Confirm received</button>
                        <button className={styles.btnGhost} disabled={busy} onClick={() => {
                          const reason = ask("Why is this transfer being marked as not received? (shown in the audit trail)");
                          if (reason && reason.trim().length >= 5) void act(() => workSend(`admin/fundings/${f.id}/manual-confirm`, { outcome: "NOT_RECEIVED", reason: reason.trim() }), "Marked not received. The business can create a new payment order.", reload);
                        }}>Not received</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Payouts({ canWrite, busy, act, ask }: Props) {
  const { data, error, reload } = useLoad<AdminPayout[]>("admin/payouts");
  const cfg = useLoad<PaymentsConfig>("admin/payments/config");
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <div className={styles.skeleton} />;
  const sandbox = data.some((p) => p.provider === "sandbox");
  const manual = cfg.data?.provider === "manual_bank";
  return (
    <>
      {sandbox && <SandboxNote />}
      {manual && (
        <p className={styles.notice}>
          Payouts are sent by NEFT from the company account. Payouts marked &ldquo;Sent to bank&rdquo; are in the NEFT file until you record them; after the bank processes them, record each UTR here. Payouts still pending are waiting for the worker to add bank details.
        </p>
      )}
      {canWrite && (
        <div className={styles.actions}>
          <button className={styles.btn} disabled={busy} onClick={() => void act(() => workSend("admin/payouts/process"), manual ? "Pending payouts with bank details are now ready to send." : "Pending payouts sent to the provider (those with a UPI ID).", reload)}>{manual ? "Prepare pending payouts" : "Send pending payouts"}</button>
          {manual && <button className={styles.btnPrimary} disabled={busy} onClick={() => void act(downloadNeftFile, "NEFT file downloaded. It contains bank account numbers: keep it private and delete it after upload.", reload)}>Download NEFT file</button>}
          <button className={styles.btn} disabled={busy} onClick={() => void act(() => workSend("admin/sweep"), "Review deadlines and expiries processed.", reload)}>Run deadline rules now</button>
        </div>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Job</th><th>Amount</th><th>Attempt</th><th>Status</th><th>Created</th><th /></tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <td>{p.jobTitle}<div className={styles.meta}>{p.orgName}</div></td>
                <td>{money(p.amountPaise)}</td>
                <td>{p.attempt}</td>
                <td><Badge tone={PAYOUT_STATUS[p.status].tone}>{PAYOUT_STATUS[p.status].label}</Badge>{p.manualUtr && <div className={styles.meta}>UTR {p.manualUtr}</div>}{p.failureReason && <div className={styles.meta}>{p.failureReason}</div>}</td>
                <td>{when(p.createdAt)}</td>
                <td>
                  {canWrite && (
                    <div className={styles.actions}>
                      {p.status === "PROCESSING" && p.provider === "sandbox" && (
                        <>
                          <button className={styles.btn} disabled={busy} onClick={() => void act(() => workSend(`sandbox/payouts/${p.id}/settle`, { outcome: "SUCCEEDED" }), "Sandbox payout settled.", reload)}>Settle (sandbox)</button>
                          <button className={styles.btnGhost} disabled={busy} onClick={() => void act(() => workSend(`sandbox/payouts/${p.id}/settle`, { outcome: "FAILED" }), "Sandbox payout failed.", reload)}>Fail (sandbox)</button>
                        </>
                      )}
                      {p.status === "PROCESSING" && p.provider === "manual_bank" && (
                        <>
                          <button className={styles.btnPrimary} disabled={busy} onClick={() => {
                            const utr = askUtr(ask, `UTR of the ${money(p.amountPaise)} NEFT for ${p.jobTitle}:`);
                            if (utr) void act(() => workSend(`admin/payouts/${p.id}/manual-confirm`, { outcome: "PAID", utr }), "Payout recorded as paid.", reload);
                          }}>Mark paid</button>
                          <button className={styles.btnGhost} disabled={busy} onClick={() => {
                            const reason = ask("Why did the NEFT fail? (shown to the worker as the failure reason)");
                            if (reason && reason.trim().length >= 5) void act(() => workSend(`admin/payouts/${p.id}/manual-confirm`, { outcome: "FAILED", reason: reason.trim() }), "Payout marked failed. Retry it once the details are fixed.", reload);
                          }}>Mark failed</button>
                        </>
                      )}
                      {p.status === "FAILED" && <button className={styles.btnPrimary} disabled={busy} onClick={() => void act(() => workSend(`admin/payouts/${p.id}/retry`), "Retry created.", reload)}>Retry</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DisputeEvidence({ assignmentId }: { assignmentId: string }) {
  const { data } = useLoad<WorkAssignmentDetailDto>(`admin/assignments/${assignmentId}`);
  if (!data) return <span className={styles.meta}>Loading submission…</span>;
  return (
    <div className={styles.list}>
      {data.job.checklist.map((i) => {
        const r = data.responses.find((x) => x.itemId === i.id);
        return (
          <div key={i.id} className={styles.meta}>
            <strong>{i.label}:</strong> {i.kind === "PHOTO" ? (r?.evidenceFileId ? <EvidenceThumb fileId={r.evidenceFileId} admin /> : "no photo") : i.kind === "TEXT" ? r?.text ?? "—" : r?.confirmed ? "done" : "not done"}
            {r?.duplicateFlag && " ⚠ duplicate signal"}
          </div>
        );
      })}
      <ol className={styles.timeline}>
        {data.timeline.map((e) => <li key={e.id}>{e.action.toLowerCase().replace(/_/g, " ")} · {e.actorParty.toLowerCase()} · {when(e.createdAt)}{e.note ? ` — ${e.note}` : ""}</li>)}
      </ol>
    </div>
  );
}

function Disputes({ canWrite, busy, act, ask }: Props) {
  const { data, error, reload } = useLoad<AdminDispute[]>("admin/disputes");
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <div className={styles.skeleton} />;
  return (
    <div className={styles.list}>
      {data.length === 0 && <p className={styles.meta}>No disputes.</p>}
      {data.map((d) => (
        <section key={d.id} className={styles.card}>
          <div className={styles.jobHead}>
            <span className={styles.rowMain}>
              <strong>{d.jobTitle}</strong>
              <span className={styles.meta}>{d.orgName} · opened by {d.openedBy.toLowerCase()} · {d.reasonCode.toLowerCase().replace(/_/g, " ")} · agreed pay {money(d.agreedPayPaise)}</span>
            </span>
            <span className={styles.actions}>
              {d.overdue && <Badge tone="red">SLA overdue</Badge>}
              <Badge tone={d.status === "OPEN" ? "amber" : "grey"}>{d.status.toLowerCase()}</Badge>
            </span>
          </div>
          <p>{d.description}</p>
          {d.status === "RESOLVED" && <p className={styles.notice}>Awarded {money(d.awardPaise ?? 0)} — {d.resolutionNote}</p>}
          <button className={styles.btnGhost} onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? "Hide submission" : "View submission and history"}</button>
          {open === d.id && <DisputeEvidence assignmentId={d.assignmentId} />}
          {canWrite && d.status === "OPEN" && (
            <div className={styles.actions}>
              <button className={styles.btnPrimary} disabled={busy} onClick={() => { const n = ask("Reason for paying in full (shown to both sides):"); if (n) void act(() => workSend(`admin/disputes/${d.id}/resolve`, { awardPaise: d.agreedPayPaise, note: n }), "Resolved: paid in full.", reload); }}>Pay in full</button>
              <button className={styles.btn} disabled={busy} onClick={() => { const amt = ask(`Award in ₹ (0 – ${d.agreedPayPaise / 100}):`); const n = amt !== null ? ask("Reason (shown to both sides):") : null; if (amt !== null && n) void act(() => workSend(`admin/disputes/${d.id}/resolve`, { awardPaise: Math.round(Number(amt) * 100), note: n }), "Dispute resolved.", reload); }}>Partial / no award</button>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function Ledger() {
  const { data, error } = useLoad<WorkLedgerTrialBalanceDto>("admin/ledger");
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <div className={styles.skeleton} />;
  return (
    <section className={styles.card}>
      <p className={data.balanced ? styles.success : styles.error}>
        {data.balanced ? "Balanced: every journal sums to zero and money held at the provider equals what is owed." : `NOT BALANCED — unbalanced journals: ${data.unbalancedJournals.join(", ") || "none"}; provider-held ${money(data.providerHeldPaise)} vs obligations ${money(data.sumOfObligationsPaise)}.`}
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Account</th><th>Balance (debit +)</th></tr></thead>
          <tbody>{data.accounts.map((a) => <tr key={a.accountCode}><td>{a.accountCode}</td><td>{money(Math.abs(a.balancePaise))} {a.balancePaise < 0 ? "Cr" : "Dr"}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function Audit() {
  const [jobId, setJobId] = useState("");
  const [path, setPath] = useState<string | null>(null);
  const { data, error } = useLoad<AuditRow[]>(path);
  return (
    <>
      <form className={styles.filters} onSubmit={(e) => { e.preventDefault(); setPath(`admin/audit?jobId=${encodeURIComponent(jobId.trim())}`); }}>
        <label className={styles.field}>Job id<input value={jobId} onChange={(e) => setJobId(e.target.value)} placeholder="Paste a job id" /></label>
        <button className={styles.btn} type="submit" disabled={!/^[0-9a-f-]{36}$/i.test(jobId.trim())}>Show history</button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
      {data && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>When</th><th>Entity</th><th>Action</th><th>Change</th><th>By</th><th>Note</th></tr></thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id}>
                  <td>{when(e.createdAt)}</td><td>{e.entityType.toLowerCase()} {e.entityId.slice(0, 8)}</td><td>{e.action}</td>
                  <td>{e.fromStatus ?? ""}{e.toStatus ? ` → ${e.toStatus}` : ""}</td><td>{e.actorParty.toLowerCase()}</td><td>{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
