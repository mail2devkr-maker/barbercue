"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  quoteWorkJob,
  WORK_LIMITS,
  type WorkCategoryDto,
  type WorkChecklistItem,
  type WorkEmployerJobDto,
  type WorkJobDraft,
} from "@barbercue/shared";
import { errorText, money, workGet, workSend } from "../../../../lib/work";
import styles from "../work.module.css";

type Item = Pick<WorkChecklistItem, "id" | "label" | "kind" | "required" | "uniqueAcrossJob">;

/** datetime-local value (local time) for a Date. */
function local(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dateFromHint(hint: string | undefined, time: string | undefined): string {
  const d = new Date();
  if (hint === "tomorrow") d.setDate(d.getDate() + 1);
  else if (hint && hint !== "today") return "";
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return local(d);
}

const rupees = (paise: number | undefined) => (paise ? String(paise / 100) : "");
const toPaise = (r: string) => Math.round(Number(r || 0) * 100);

export function JobForm({ orgId, initial, onSaved }: { orgId: string; initial?: WorkEmployerJobDto; onSaved: (job: WorkEmployerJobDto) => void }) {
  const [categories, setCategories] = useState<WorkCategoryDto[]>([]);
  const [draftText, setDraftText] = useState("");
  const [draftMissing, setDraftMissing] = useState<string[] | null>(null);
  const [f, setF] = useState({
    categorySlug: initial?.categorySlug ?? "",
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    locationType: initial?.locationType ?? "ON_SITE",
    addressLine: initial?.addressLine ?? "",
    city: initial?.city ?? "",
    locality: initial?.locality ?? "",
    positions: String(initial?.positions ?? 1),
    startsAt: initial ? local(new Date(initial.startsAt)) : "",
    endsAt: initial ? local(new Date(initial.endsAt)) : "",
    applicationDeadline: initial?.applicationDeadline ? local(new Date(initial.applicationDeadline)) : "",
    payType: initial?.payType ?? "FIXED",
    pay: rupees(initial?.payPerWorkerPaise),
    bonusDescription: initial?.bonusDescription ?? "",
    minAge: String(initial?.minAge ?? 18),
    minVerificationLevel: String(initial?.minVerificationLevel ?? 1),
    requiredSkills: initial?.requiredSkills.join(", ") ?? "",
    languages: initial?.languages.join(", ") ?? "",
    hiringMode: initial?.hiringMode ?? "INSTANT_ACCEPT",
    requiresCheckIn: initial?.requiresCheckIn ?? true,
    completionCriteria: initial?.completionCriteria ?? "",
    arrivalComp: rupees(initial?.cancellationTerms.employerCancelAfterArrivalPaise),
    lateComp: rupees(initial?.cancellationTerms.employerLateCancelPaise),
    lateHours: String(initial?.cancellationTerms.workerLateCancelHours ?? WORK_LIMITS.defaultWorkerLateCancelHours),
    reviewWindowHours: String(initial?.reviewWindowHours ?? WORK_LIMITS.defaultReviewWindowHours),
  });
  const [items, setItems] = useState<Item[]>(initial?.checklist ?? [{ id: "step-1", label: "", kind: "CONFIRM", required: true, uniqueAcrossJob: false }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    workGet<WorkCategoryDto[]>("categories").then(setCategories).catch(() => undefined);
  }, []);

  async function smartDraft() {
    setError(null);
    try {
      const d = await workSend<WorkJobDraft>("draft", { text: draftText });
      const x = d.fields;
      setF((cur) => ({
        ...cur,
        title: x.title ?? cur.title,
        description: cur.description || draftText,
        city: x.city ?? cur.city,
        positions: x.positions ? String(x.positions) : cur.positions,
        pay: x.payPerWorkerPaise ? String(x.payPerWorkerPaise / 100) : cur.pay,
        payType: x.payType ?? cur.payType,
        startsAt: dateFromHint(x.dateHint, x.startTime) || cur.startsAt,
        endsAt: dateFromHint(x.dateHint, x.endTime) || cur.endsAt,
      }));
      if (x.checklist?.length) setItems(x.checklist.map((c) => ({ ...c, required: true, uniqueAcrossJob: false })));
      setDraftMissing(d.missing);
    } catch (err) {
      setError(errorText(err));
    }
  }

  const positions = Number(f.positions) || 0;
  const payPaise = toPaise(f.pay);
  let quote: ReturnType<typeof quoteWorkJob> | null = null;
  try {
    if (positions >= 1 && payPaise > 0) quote = quoteWorkJob(positions, payPaise, initial?.quote.feeBps ?? WORK_LIMITS.defaultFeeBps);
  } catch {
    quote = null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
    const body = {
      categorySlug: f.categorySlug,
      title: f.title,
      description: f.description,
      locationType: f.locationType,
      addressLine: f.locationType === "REMOTE" ? null : f.addressLine || null,
      city: f.city,
      locality: f.locality || null,
      positions,
      startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : "",
      endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : "",
      applicationDeadline: f.applicationDeadline ? new Date(f.applicationDeadline).toISOString() : null,
      payType: f.payType,
      payPerWorkerPaise: payPaise,
      bonusDescription: f.bonusDescription || null,
      minAge: Number(f.minAge) || 18,
      minVerificationLevel: Number(f.minVerificationLevel) || 1,
      requiredSkills: split(f.requiredSkills).map((s) => s.toLowerCase()),
      languages: split(f.languages),
      hiringMode: f.hiringMode,
      requiresCheckIn: f.locationType === "REMOTE" ? false : f.requiresCheckIn,
      checklist: items.filter((i) => i.label.trim()).map((i, idx) => ({ ...i, id: i.id || `step-${idx + 1}`, label: i.label.trim() })),
      completionCriteria: f.completionCriteria,
      cancellationTerms: { employerCancelAfterArrivalPaise: toPaise(f.arrivalComp), employerLateCancelPaise: toPaise(f.lateComp), workerLateCancelHours: Number(f.lateHours) || 0 },
      reviewWindowHours: Number(f.reviewWindowHours) || 72,
    };
    try {
      const saved = initial
        ? await workSend<WorkEmployerJobDto>(`orgs/${orgId}/jobs/${initial.id}`, body, "PUT")
        : await workSend<WorkEmployerJobDto>(`orgs/${orgId}/jobs`, body);
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const input = (k: keyof typeof f, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <label className={styles.field}>
      {label}
      <input value={String(f[k])} onChange={(e) => set(k, e.target.value)} {...extra} />
      {hint && <span className={styles.hint}>{hint}</span>}
    </label>
  );

  return (
    <form onSubmit={(e) => void submit(e)} className={styles.list} style={{ gap: "var(--bc-space-4)" }} aria-label="Job details">
      {!initial && (
        <section className={styles.card} aria-label="Smart draft">
          <h2 className={styles.sectionTitle}>Describe the work in one sentence</h2>
          <p className={styles.meta}>We’ll fill in what we can read from it and list what’s missing. Nothing is guessed — check every field before publishing.</p>
          <textarea
            aria-label="Describe the work"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="I need 10 students in Greater Noida tomorrow between 10 AM and 4 PM to visit salons, explain our app, obtain owner consent and register interested shops. Pay ₹500 per completed assignment."
            style={{ minHeight: 90, padding: 12, borderRadius: 10, border: "1px solid var(--bc-border)", font: "inherit" }}
          />
          <div className={styles.actions}>
            <button type="button" className={styles.btn} disabled={draftText.trim().length < 10} onClick={() => void smartDraft()}>
              Fill the form from this
            </button>
          </div>
          {draftMissing && (
            <p className={styles.notice}>
              <strong>Still needed:</strong> {draftMissing.join(" · ")}
            </p>
          )}
        </section>
      )}

      <section className={styles.card} aria-label="Basics">
        <h2 className={styles.sectionTitle}>Basics</h2>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            Category
            <select required value={f.categorySlug} onChange={(e) => set("categorySlug", e.target.value)}>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {input("title", "Job title", { required: true, maxLength: 120 })}
          <label className={`${styles.field} ${styles.full}`}>
            Description
            <textarea required value={f.description} onChange={(e) => set("description", e.target.value)} minLength={30} maxLength={4000} />
            <span className={styles.hint}>Say exactly what the work is. Never ask workers for money, documents or passwords — such jobs are blocked.</span>
          </label>
          <label className={styles.field}>
            Work type
            <select value={f.locationType} onChange={(e) => set("locationType", e.target.value)}>
              <option value="ON_SITE">On-site</option>
              <option value="HYBRID">Hybrid</option>
              <option value="REMOTE">Remote</option>
            </select>
          </label>
          {f.locationType !== "REMOTE" && input("addressLine", "Address or service area", { required: true })}
          {input("city", "City", { required: true })}
          {input("locality", "Locality (optional)")}
        </div>
      </section>

      <section className={styles.card} aria-label="Schedule and pay">
        <h2 className={styles.sectionTitle}>Schedule and pay</h2>
        <div className={styles.formGrid}>
          {input("positions", "Workers needed", { required: true, inputMode: "numeric" }, `Up to ${WORK_LIMITS.maxPositions}`)}
          {input("startsAt", "Starts", { required: true, type: "datetime-local" })}
          {input("endsAt", "Ends", { required: true, type: "datetime-local" })}
          {input("applicationDeadline", "Applications close (optional)", { type: "datetime-local" })}
          <label className={styles.field}>
            Pay type
            <select value={f.payType} onChange={(e) => set("payType", e.target.value)}>
              <option value="FIXED">Fixed for the assignment</option>
              <option value="PER_TASK">Per completed task</option>
              <option value="HOURLY">Hourly (enter the total for the shift)</option>
              <option value="DAILY">Daily</option>
            </select>
          </label>
          {input("pay", "Guaranteed pay per worker (₹)", { required: true, inputMode: "decimal" }, "The amount each worker is paid for completed work. Workers see this before accepting.")}
          <label className={`${styles.field} ${styles.full}`}>
            Bonus (optional, shown separately and never counted as guaranteed)
            <input value={f.bonusDescription} onChange={(e) => set("bonusDescription", e.target.value)} maxLength={300} />
          </label>
        </div>
        {quote && (
          <p className={styles.notice}>
            You fund <strong>{money(quote.employerTotalPaise)}</strong> before the job goes live: {money(quote.workerPayTotalPaise)} worker pay + {money(quote.platformFeeTotalPaise)} platform fee ({quote.feeBps / 100}%). Unused money is released back when the job closes. Workers pay nothing.
          </p>
        )}
      </section>

      <section className={styles.card} aria-label="Who can take it">
        <h2 className={styles.sectionTitle}>Who can take it</h2>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            How workers join
            <select value={f.hiringMode} onChange={(e) => set("hiringMode", e.target.value)}>
              <option value="INSTANT_ACCEPT">Instant accept — first eligible workers get the places</option>
              <option value="APPLY_AND_SELECT">Apply — you choose who gets an offer</option>
            </select>
          </label>
          {input("minAge", "Minimum age", { inputMode: "numeric" }, "18 or more")}
          <label className={styles.field}>
            Verification needed
            <select value={f.minVerificationLevel} onChange={(e) => set("minVerificationLevel", e.target.value)}>
              <option value="1">Verified phone</option>
              <option value="2">Eligibility checked by FastQue</option>
            </select>
          </label>
          {input("requiredSkills", "Required skills (comma separated)", { placeholder: "hindi, sales" })}
          {input("languages", "Languages (optional)")}
          {f.locationType !== "REMOTE" && (
            <label className={styles.field} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={f.requiresCheckIn} onChange={(e) => set("requiresCheckIn", e.target.checked)} style={{ width: 20, minHeight: 20 }} />
              Workers check in on arrival
            </label>
          )}
        </div>
      </section>

      <section className={styles.card} aria-label="Checklist">
        <h2 className={styles.sectionTitle}>Task checklist and completion</h2>
        <ol className={styles.checklist}>
          {items.map((it, i) => (
            <li key={i} className={styles.checkItem}>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  Step {i + 1}
                  <input value={it.label} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="e.g. Obtain the owner’s consent" />
                </label>
                <label className={styles.field}>
                  Worker provides
                  <select value={it.kind} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, kind: e.target.value as Item["kind"] } : x)))}>
                    <option value="CONFIRM">A tick (done)</option>
                    <option value="TEXT">Details (text)</option>
                    <option value="PHOTO">A photo</option>
                  </select>
                </label>
              </div>
              <div className={styles.actions}>
                {it.kind === "TEXT" && (
                  <label className={styles.meta} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" checked={it.uniqueAcrossJob} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, uniqueAcrossJob: e.target.checked } : x)))} />
                    Flag if another worker submits the same answer (e.g. same shop phone)
                  </label>
                )}
                <label className={styles.meta} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={it.required} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />
                  Required
                </label>
                {items.length > 1 && (
                  <button type="button" className={styles.btnGhost} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
        {items.length < WORK_LIMITS.maxChecklistItems && (
          <button type="button" className={styles.btn} onClick={() => setItems((xs) => [...xs, { id: `step-${Date.now().toString(36)}`, label: "", kind: "CONFIRM", required: true, uniqueAcrossJob: false }])}>
            Add a step
          </button>
        )}
        <label className={styles.field}>
          The work counts as complete when…
          <textarea required value={f.completionCriteria} onChange={(e) => set("completionCriteria", e.target.value)} minLength={10} maxLength={1000} />
        </label>
      </section>

      <section className={styles.card} aria-label="Cancellation terms">
        <h2 className={styles.sectionTitle}>Cancellation and review terms (shown to workers)</h2>
        <div className={styles.formGrid}>
          {input("arrivalComp", "If you cancel after a worker arrives, you pay (₹)", { required: true, inputMode: "decimal" }, "Up to the full pay")}
          {input("lateComp", "If you cancel shortly before the start, you pay (₹)", { inputMode: "decimal" })}
          {input("lateHours", "“Shortly before” means within (hours)", { inputMode: "numeric" })}
          {input("reviewWindowHours", "You review submitted work within (hours)", { inputMode: "numeric" }, `${WORK_LIMITS.minReviewWindowHours}–${WORK_LIMITS.maxReviewWindowHours}. Unreviewed work is approved automatically after this.`)}
        </div>
      </section>

      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.btnPrimary} disabled={busy}>
          {busy ? "Saving…" : initial ? "Save changes" : "Save draft and preview"}
        </button>
      </div>
    </form>
  );
}
