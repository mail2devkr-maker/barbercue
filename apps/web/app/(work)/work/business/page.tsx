"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { WorkOrgType, type WorkOrgDto, type WorkOrgReportDto } from "@barbercue/shared";
import { RequireRole } from "../../../../components/auth/RequireRole";
import { errorText, JOB_STATUS, money, ORG_STATUS, when, workGet, workSend } from "../../../../lib/work";
import { Badge, Stat, WorkNav } from "../WorkUi";
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

  const field = (k: keyof typeof f, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={styles.field}>
      {label}
      <input value={f[k]} onChange={(e) => set(k, e.target.value)} {...extra} />
    </label>
  );

  return (
    <form className={styles.card} onSubmit={(e) => void submit(e)} aria-label="Business details">
      <div className={styles.formGrid}>
        {field("legalName", "Legal business name", { required: true })}
        {field("displayName", "Name workers will see", { required: true })}
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
        {field("gstin", "GSTIN (if registered)", { placeholder: "09ABCDE1234F1Z5" })}
        <label className={`${styles.field} ${styles.full}`}>
          Registered address
          <input required value={f.registeredAddress} onChange={(e) => set("registeredAddress", e.target.value)} />
        </label>
        {field("city", "City", { required: true })}
        {field("contactName", "Authorised contact person", { required: true })}
        {field("contactPhone", "Contact mobile", { required: true, inputMode: "tel" })}
        {field("contactEmail", "Contact email", { required: true, type: "email" })}
      </div>
      <p className={styles.hint}>A FastQue reviewer checks these details before you can publish paid work. Contact details are never shown to workers.</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.btnPrimary} disabled={busy}>
          {initial ? "Save details" : "Create business"}
        </button>
      </div>
    </form>
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
      <>
        <div>
          <h1 className={styles.title}>Post work in minutes. Pay for completed work.</h1>
          <p className={styles.sub}>Tell us about your business. Once verified you can post paid assignments, track attendance and approve work before anyone is paid.</p>
        </div>
        <OrgForm
          onSaved={(o) => {
            setCreating(false);
            setOrgId(o.id);
            loadOrgs();
          }}
        />
      </>
    );
  }

  const org = orgs.find((o) => o.id === orgId) ?? orgs[0];
  const st = ORG_STATUS[org.status];
  const canEdit = org.myRole === "OWNER" && (org.status === "DRAFT" || org.status === "REJECTED");

  return (
    <>
      <div className={styles.jobHead}>
        <div>
          <h1 className={styles.title}>{org.displayName}</h1>
          <p className={styles.sub}>
            <Badge tone={st.tone}>{st.label}</Badge> · your role: {org.myRole?.toLowerCase()}
          </p>
        </div>
        <div className={styles.actions}>
          {orgs.length > 1 && (
            <select aria-label="Switch business" value={org.id} onChange={(e) => setOrgId(e.target.value)} className={styles.btn}>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.displayName}
                </option>
              ))}
            </select>
          )}
          {org.status === "VERIFIED" && (
            <Link href={`/work/business/${org.id}/jobs/new`} className={styles.btnPrimary}>
              Post a job
            </Link>
          )}
          <button type="button" className={styles.btnGhost} onClick={() => setCreating(true)}>
            Add another business
          </button>
        </div>
      </div>

      {org.status === "REJECTED" && org.rejectionReason && (
        <p className={styles.error}>
          <strong>Reviewer’s note:</strong> {org.rejectionReason}
        </p>
      )}
      {org.status === "SUSPENDED" && <p className={styles.error}>This business is suspended: {org.rejectionReason}. Contact support to appeal.</p>}
      {(org.status === "DRAFT" || org.status === "REJECTED") && (
        <div className={styles.notice}>
          <strong>Next step:</strong> submit your business for verification. You can prepare job drafts meanwhile, but only verified businesses can publish paid work.
          <div className={styles.actions} style={{ marginTop: 8 }}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => void workSend(`orgs/${org.id}/submit`).then(loadOrgs).catch((err) => setError(errorText(err)))}
            >
              Submit for verification
            </button>
            {canEdit && (
              <button type="button" className={styles.btn} onClick={() => setEditing((x) => !x)}>
                {editing ? "Close" : "Edit details"}
              </button>
            )}
            <Link href={`/work/business/${org.id}/jobs/new`} className={styles.btn}>
              Prepare a draft job
            </Link>
          </div>
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
      {(org.status === "SUBMITTED" || org.status === "UNDER_REVIEW") && <p className={styles.notice}>Our team is reviewing your business details. You’ll be able to publish jobs once verified.</p>}

      {report && (
        <div className={styles.stats}>
          <Stat label="Funded" value={money(report.fundedPaise)} />
          <Stat label="Approved worker pay" value={money(report.workerPayApprovedPaise)} />
          <Stat label="Platform fees" value={money(report.platformFeesPaise)} />
          <Stat label="Still committed" value={money(report.committedPaise)} />
          <Stat label="Released to you" value={money(report.releasedToEmployerPaise)} />
          <Stat label="Owed to workers" value={money(report.owedToWorkersPaise)} />
        </div>
      )}

      <section className={styles.card} aria-label="Jobs">
        <h2 className={styles.sectionTitle}>Jobs</h2>
        {jobs.length === 0 ? (
          <p className={styles.meta}>No jobs yet.</p>
        ) : (
          <div className={styles.list}>
            {jobs.map((j) => (
              <Link key={j.id} href={`/work/business/${org.id}/jobs/${j.id}`} className={styles.row}>
                <span className={styles.rowMain}>
                  <strong>{j.title}</strong>
                  <span className={styles.meta}>
                    {j.categoryName} · {j.city} · {when(j.startsAt)}
                  </span>
                </span>
                <span className={styles.actions}>
                  <span className={styles.meta}>
                    {j.filled}/{j.positions} filled · {money(j.payPerWorkerPaise)} each
                  </span>
                  <Badge tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge>
                </span>
              </Link>
            ))}
          </div>
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
