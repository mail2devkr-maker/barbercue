"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { WorkOrgType, type WorkOrgDto, type WorkOrgReportDto } from "@barbercue/shared";
import { RequireRole } from "../../../../components/auth/RequireRole";
import { errorText, JOB_STATUS, money, ORG_STATUS, when, workGet, workSend } from "../../../../lib/work";
import { Badge, WorkNav } from "../WorkUi";
import styles from "../work.module.css";

interface OrgJobRow {
  id: string;
  title: string;
  categoryName: string;
  status: keyof typeof JOB_STATUS;
  city: string;
  startsAt: string;
  positions: number;
  filled: number;
  payPerWorkerPaise: number;
}

const ORG_TYPE_LABEL: Record<WorkOrgType, string> = {
  INDIVIDUAL: "Individual business",
  MSME: "MSME",
  STARTUP: "Startup",
  RETAIL: "Retail shop",
  RESTAURANT: "Restaurant / café",
  SALON: "Salon",
  EVENT_ORGANIZER: "Event organizer",
  MARKETING_AGENCY: "Marketing agency",
  ENTERPRISE: "Enterprise",
  WORKFORCE_AGENCY: "Authorised workforce agency",
};

const PILL_FOR_TONE: Record<string, string> = { green: styles.pgPillGood, amber: styles.pgPillWarn, red: styles.pgPillBad };

function OrgForm({ initial, onSaved }: { initial?: WorkOrgDto; onSaved: (o: WorkOrgDto) => void }) {
  const [f, setF] = useState({
    legalName: initial?.legalName ?? "",
    displayName: initial?.displayName ?? "",
    orgType: initial?.orgType ?? WorkOrgType.MSME,
    gstin: initial?.gstin ?? "",
    registeredAddress: initial?.registeredAddress ?? "",
    city: initial?.city ?? "",
    contactName: initial?.contactName ?? "",
    contactPhone: initial?.contactPhone ?? "+91",
    contactEmail: initial?.contactEmail ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...f, gstin: f.gstin.trim() || null };
      onSaved(initial ? await workSend<WorkOrgDto>(`orgs/${initial.id}`, body, "PUT") : await workSend<WorkOrgDto>("orgs", body));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof typeof f, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <label className={styles.field}>
      {label}
      <input value={f[k]} onChange={(e) => set(k, e.target.value)} {...extra} />
      {hint && <span className={styles.hint}>{hint}</span>}
    </label>
  );

  return (
    <form className={styles.pgForm} onSubmit={(e) => void submit(e)} aria-label="Business details">
      <fieldset className={styles.pgFieldset}>
        <legend className={styles.pgLegend}>
          <span className={styles.pgLegendNum}>1</span> About your business
        </legend>
        <div className={styles.formGrid}>
          {field("legalName", "Legal business name", { required: true, placeholder: "As on your GST or registration" })}
          {field("displayName", "Name students will see", { required: true, placeholder: "e.g. Bloom Events" })}
          <label className={styles.field}>
            Business type
            <select value={f.orgType} onChange={(e) => set("orgType", e.target.value)}>
              {Object.values(WorkOrgType).map((t) => (
                <option key={t} value={t}>
                  {ORG_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          {field("gstin", "GSTIN (optional)", { placeholder: "09ABCDE1234F1Z5" }, "Speeds up verification if you have one.")}
        </div>
      </fieldset>

      <fieldset className={styles.pgFieldset}>
        <legend className={styles.pgLegend}>
          <span className={styles.pgLegendNum}>2</span> Where you’re based
        </legend>
        <div className={styles.formGrid}>
          <label className={`${styles.field} ${styles.full}`}>
            Registered address
            <input required value={f.registeredAddress} onChange={(e) => set("registeredAddress", e.target.value)} placeholder="Building, street, area" />
          </label>
          {field("city", "City", { required: true, placeholder: "e.g. Greater Noida" })}
        </div>
      </fieldset>

      <fieldset className={styles.pgFieldset}>
        <legend className={styles.pgLegend}>
          <span className={styles.pgLegendNum}>3</span> Who we should contact
        </legend>
        <div className={styles.formGrid}>
          {field("contactName", "Authorised contact person", { required: true, autoComplete: "name" })}
          {field("contactPhone", "Contact mobile", { required: true, inputMode: "tel", autoComplete: "tel" }, "Format: +91 followed by 10 digits.")}
          {field("contactEmail", "Contact email", { required: true, type: "email", autoComplete: "email" })}
        </div>
      </fieldset>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.pgFormFoot}>
        <p className={styles.hint}>🔒 Only the FastQue review team sees these details. Students never see your contact information.</p>
        <button type="submit" className={styles.pgBigBtn} disabled={busy}>
          {busy ? "Saving…" : initial ? "Save details" : "Create business →"}
        </button>
      </div>
    </form>
  );
}

/** Onboarding state: no business yet (or adding another one). */
function BusinessOnboarding({ onSaved, onCancel }: { onSaved: (o: WorkOrgDto) => void; onCancel?: () => void }) {
  return (
    <>
      <section className={styles.pgHero} aria-labelledby="biz-hero">
        <div className={styles.pgHeroMain}>
          <span className={styles.lpEyebrow}>🏢 FastQue Work · for businesses</span>
          <h1 id="biz-hero" className={styles.pgTitle}>
            Hire students for shifts, promos &amp; <span className={styles.lpTitleAccent}>campaigns.</span>
          </h1>
          <p className={styles.pgLead}>Post short, paid assignments, track attendance on the day, and approve the work before anyone is paid. Set up takes about two minutes.</p>
          <div className={styles.pgPills}>
            <span className={styles.pgPill}>✓ Free to sign up</span>
            <span className={styles.pgPill}>✓ Pay only for approved work</span>
            <span className={styles.pgPill}>✓ Unused money comes back</span>
          </div>
          {onCancel && (
            <button type="button" className={styles.pgBtnOutline} onClick={onCancel}>
              ← Back to my business
            </button>
          )}
        </div>
        <div className={styles.pgHeroAside} aria-hidden="true">
          <div className={styles.pgFeature}>
            <span className={styles.pgFeatureIcon}>⚡</span>
            <span>
              <strong>Fill shifts fast</strong>Instant-accept gigs let eligible students claim a place in one tap.
            </span>
          </div>
          <div className={styles.pgFeature}>
            <span className={styles.pgFeatureIcon}>📍</span>
            <span>
              <strong>Know who showed up</strong>On-site check-in codes and a task checklist with photo proof.
            </span>
          </div>
          <div className={styles.pgFeature}>
            <span className={styles.pgFeatureIcon}>🧾</span>
            <span>
              <strong>Clean records</strong>Every rupee is tracked, with a report for each job.
            </span>
          </div>
        </div>
      </section>

      <div className={styles.pgSplit}>
        <OrgForm onSaved={onSaved} />
        <aside className={styles.pgSide} aria-label="How it works">
          <div className={styles.pgPanel}>
            <h2>What happens next</h2>
            <ol className={styles.pgTimeline}>
              <li>
                <span>
                  <strong>Create your business</strong>The details on the left. You can prepare job drafts straight away.
                </span>
              </li>
              <li>
                <span>
                  <strong>Quick verification</strong>A FastQue reviewer checks your details before you can publish paid work.
                </span>
              </li>
              <li>
                <span>
                  <strong>Post and fund a gig</strong>You see the exact total (pay + platform fee) before it goes live.
                </span>
              </li>
              <li>
                <span>
                  <strong>Approve, then pay</strong>Students are paid only for work you approve. Unused funds are released back.
                </span>
              </li>
            </ol>
          </div>
          <div className={styles.pgPanel}>
            <h3>House rules</h3>
            <ul className={styles.pgTicks}>
              <li>Never ask students for a fee, deposit, OTP or documents.</li>
              <li>Show the real pay and tasks — jobs are screened before they go live.</li>
              <li>Review submitted work within the window you choose.</li>
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}

function VerificationTrack({ status, hasJobs }: { status: WorkOrgDto["status"]; hasJobs: boolean }) {
  const reviewing = status === "SUBMITTED" || status === "UNDER_REVIEW";
  const verified = status === "VERIFIED";
  const steps = [
    { title: "Business created", body: "Your details are saved.", done: true, now: false },
    {
      title: verified ? "Verified" : reviewing ? "In review" : "Submit for review",
      body: verified ? "You can publish paid work." : reviewing ? "Our team is checking your details." : status === "REJECTED" ? "Fix the reviewer’s note and resubmit." : "Send your details to FastQue.",
      done: verified,
      now: !verified,
    },
    { title: "Post your first gig", body: "Publish, fund and open it to students.", done: verified && hasJobs, now: verified && !hasJobs },
    { title: "Approve & pay", body: "Pay only for work you approve.", done: false, now: verified && hasJobs },
  ];
  return (
    <ol className={styles.pgSteps} aria-label="Your progress">
      {steps.map((s, i) => (
        <li key={s.title} className={`${styles.pgStep} ${s.done ? styles.pgStepDone : s.now ? styles.pgStepNow : ""}`} aria-current={s.now ? "step" : undefined}>
          <span className={styles.pgStepDot}>{s.done ? "✓" : i + 1}</span>
          <span>
            <strong>{s.title}</strong>
            {s.body}
          </span>
        </li>
      ))}
    </ol>
  );
}

function MoneyStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className={styles.pgStat}>
      <span className={styles.pgStatLabel}>{label}</span>
      <span className={styles.pgStatValue}>{value}</span>
      <span className={styles.pgStatHint}>{hint}</span>
    </div>
  );
}

function BusinessHome() {
  const [orgs, setOrgs] = useState<WorkOrgDto[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<OrgJobRow[]>([]);
  const [report, setReport] = useState<WorkOrgReportDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrgs = useCallback(() => {
    workGet<WorkOrgDto[]>("orgs/mine")
      .then((list) => {
        setOrgs(list);
        setOrgId((cur) => cur ?? list[0]?.id ?? null);
      })
      .catch((err) => setError(errorText(err, "Couldn’t load your businesses.")));
  }, []);
  useEffect(loadOrgs, [loadOrgs]);

  useEffect(() => {
    if (!orgId) return;
    workGet<OrgJobRow[]>(`orgs/${orgId}/jobs`).then(setJobs).catch(() => setJobs([]));
    workGet<WorkOrgReportDto>(`orgs/${orgId}/report`).then(setReport).catch(() => setReport(null));
  }, [orgId]);

  if (error) return <p className={styles.error} role="alert">{error}</p>;
  if (!orgs) return <div className={styles.skeleton} aria-busy="true" />;

  if (orgs.length === 0 || creating) {
    return (
      <BusinessOnboarding
        onCancel={orgs.length > 0 ? () => setCreating(false) : undefined}
        onSaved={(o) => {
          setCreating(false);
          setOrgId(o.id);
          loadOrgs();
        }}
      />
    );
  }

  const org = orgs.find((o) => o.id === orgId) ?? orgs[0];
  const st = ORG_STATUS[org.status];
  const canEdit = org.myRole === "OWNER" && (org.status === "DRAFT" || org.status === "REJECTED");
  const needsSubmit = org.status === "DRAFT" || org.status === "REJECTED";
  const submit = () => void workSend(`orgs/${org.id}/submit`).then(loadOrgs).catch((err) => setError(errorText(err)));

  return (
    <>
      <section className={styles.pgHero} aria-labelledby="biz-name">
        <div className={styles.pgHeroMain}>
          <span className={styles.lpEyebrow}>🏢 Your business</span>
          <h1 id="biz-name" className={styles.pgTitle}>
            {org.displayName}
          </h1>
          <div className={styles.pgPills}>
            <span className={`${styles.pgPill} ${PILL_FOR_TONE[st.tone] ?? ""}`}>{st.label}</span>
            <span className={styles.pgPill}>Your role: {org.myRole?.toLowerCase()}</span>
            <span className={styles.pgPill}>📍 {org.city}</span>
          </div>
          <div className={styles.pgHeroActions}>
            {org.status === "VERIFIED" && (
              <Link href={`/work/business/${org.id}/jobs/new`} className={styles.pgBtnHot}>
                + Post a gig
              </Link>
            )}
            {needsSubmit && (
              <button type="button" className={styles.pgBtnHot} onClick={submit}>
                Submit for verification
              </button>
            )}
            {needsSubmit && (
              <Link href={`/work/business/${org.id}/jobs/new`} className={styles.pgBtnLight}>
                Prepare a draft gig
              </Link>
            )}
            {canEdit && (
              <button type="button" className={styles.pgBtnOutline} onClick={() => setEditing((x) => !x)}>
                {editing ? "Close editor" : "Edit details"}
              </button>
            )}
            {orgs.length > 1 && (
              <select aria-label="Switch business" value={org.id} onChange={(e) => setOrgId(e.target.value)} className={styles.pgSelectDark}>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.displayName}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className={styles.pgBtnOutline} onClick={() => setCreating(true)}>
              Add another business
            </button>
          </div>
        </div>
        {report && (
          <div className={styles.pgMoney}>
            <span className={styles.pgMoneyLabel}>Funded so far</span>
            <span className={styles.pgMoneyValue}>{money(report.fundedPaise)}</span>
            <div className={styles.pgMoneyRow}>
              <span>
                Still committed <strong>{money(report.committedPaise)}</strong>
              </span>
              <span>
                Released to you <strong>{money(report.releasedToEmployerPaise)}</strong>
              </span>
            </div>
          </div>
        )}
      </section>

      <VerificationTrack status={org.status} hasJobs={jobs.length > 0} />

      {org.status === "REJECTED" && org.rejectionReason && (
        <div className={`${styles.pgCallout} ${styles.pgCalloutBad}`} role="alert">
          <p>
            <strong>Reviewer’s note:</strong> {org.rejectionReason}
          </p>
        </div>
      )}
      {org.status === "SUSPENDED" && (
        <div className={`${styles.pgCallout} ${styles.pgCalloutBad}`} role="alert">
          <p>
            <strong>This business is suspended:</strong> {org.rejectionReason}. Contact support to appeal.
          </p>
        </div>
      )}
      {needsSubmit && (
        <div className={styles.pgCallout}>
          <p>
            <strong>Next step:</strong> submit your business for verification. You can prepare gig drafts meanwhile, but only verified businesses can publish paid work.
          </p>
          <button type="button" className={styles.pgBigBtn} onClick={submit}>
            Submit for verification
          </button>
        </div>
      )}
      {(org.status === "SUBMITTED" || org.status === "UNDER_REVIEW") && (
        <div className={styles.pgCallout}>
          <p>
            <strong>⏳ We’re reviewing your business.</strong> You’ll be able to publish gigs as soon as it’s verified. Meanwhile you can prepare drafts.
          </p>
          <Link href={`/work/business/${org.id}/jobs/new`} className={styles.btn}>
            Prepare a draft gig
          </Link>
        </div>
      )}

      {editing && canEdit && (
        <OrgForm
          initial={org}
          onSaved={() => {
            setEditing(false);
            loadOrgs();
          }}
        />
      )}

      {report && (
        <div className={styles.pgStats} aria-label="Money summary">
          <MoneyStat label="Approved worker pay" value={money(report.workerPayApprovedPaise)} hint="For work you approved" />
          <MoneyStat label="Owed to workers" value={money(report.owedToWorkersPaise)} hint="Approved, payout in progress" />
          <MoneyStat label="Platform fees" value={money(report.platformFeesPaise)} hint="Shown before you fund" />
          <MoneyStat label="Still committed" value={money(report.committedPaise)} hint="Held for open places" />
        </div>
      )}

      <section className={styles.pgListCard} aria-labelledby="biz-jobs">
        <div className={styles.pgListHead}>
          <h2 id="biz-jobs">Your gigs</h2>
          <span className={styles.pgCount}>{jobs.length}</span>
        </div>
        {jobs.length === 0 ? (
          <div className={styles.pgEmpty}>
            <strong>No gigs yet.</strong>
            <span>
              {org.status === "VERIFIED"
                ? "Describe the work in one sentence and we’ll fill in the form for you."
                : "You can prepare a draft now and publish it once you’re verified."}
            </span>
            <Link href={`/work/business/${org.id}/jobs/new`} className={styles.btnPrimary}>
              {org.status === "VERIFIED" ? "Post your first gig" : "Prepare a draft"}
            </Link>
          </div>
        ) : (
          jobs.map((j) => (
            <Link key={j.id} href={`/work/business/${org.id}/jobs/${j.id}`} className={styles.pgRow}>
              <span className={styles.pgRowIcon} aria-hidden="true">
                📌
              </span>
              <span className={styles.rowMain}>
                <span className={styles.pgRowTitle}>{j.title}</span>
                <span className={styles.meta}>
                  {j.categoryName} · {j.city} · {when(j.startsAt)}
                </span>
              </span>
              <span className={styles.pgRowEnd}>
                <span className={styles.meta}>
                  {j.filled}/{j.positions} filled · {money(j.payPerWorkerPaise)} each
                </span>
                <Badge tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge>
              </span>
            </Link>
          ))
        )}
      </section>
    </>
  );
}

export default function BusinessPage() {
  return (
    <RequireRole redirectTo="/login">
      <main className={styles.page}>
        <WorkNav />
        <BusinessHome />
      </main>
    </RequireRole>
  );
}
