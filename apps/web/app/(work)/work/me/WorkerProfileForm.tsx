"use client";

import { useState, type FormEvent } from "react";
import { WORKER_TYPE_LABELS, WorkerType, type WorkerProfileDto } from "@barbercue/shared";
import { errorText, workSend } from "../../../../lib/work";
import styles from "../work.module.css";

const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** Collects only what is needed to match and pay a worker. College is optional for everyone. */
export function WorkerProfileForm({ initial, onSaved }: { initial: WorkerProfileDto | null; onSaved: (p: WorkerProfileDto) => void }) {
  const [form, setForm] = useState({
    fullName: initial?.fullName ?? "",
    workerType: initial?.workerType ?? WorkerType.COLLEGE_STUDENT,
    dateOfBirth: initial?.dateOfBirth ?? "",
    city: initial?.city ?? "",
    locality: initial?.locality ?? "",
    workRadiusKm: String(initial?.workRadiusKm ?? 10),
    languages: initial?.languages.join(", ") ?? "Hindi, English",
    skills: initial?.skills.join(", ") ?? "",
    collegeName: initial?.collegeName ?? "",
    bio: initial?.bio ?? "",
    payoutUpiVpa: "",
    bankAccountNumber: "",
    bankIfsc: "",
    bankAccountName: initial?.payoutBankMasked?.accountName ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  // Before a profile exists the server has not said which method is active; ask for a bank account
  // only when it has (UPI stays the default the original form used).
  const bank = initial?.payoutMethod === "BANK";
  const saved = initial?.payoutBankMasked ?? null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = await workSend<WorkerProfileDto>(
        "me/profile",
        {
          fullName: form.fullName,
          workerType: form.workerType,
          dateOfBirth: form.dateOfBirth,
          city: form.city,
          locality: form.locality || null,
          workRadiusKm: Number(form.workRadiusKm) || 10,
          languages: split(form.languages),
          skills: split(form.skills).map((s) => s.toLowerCase()),
          collegeName: form.collegeName || null,
          bio: form.bio || null,
          // Left blank = keep the saved UPI ID (it is never sent back to the browser in full).
          ...(form.payoutUpiVpa.trim() ? { payoutUpiVpa: form.payoutUpiVpa.trim() } : {}),
          // Same rule for the bank account: sent only when a new account number is typed.
          ...(form.bankAccountNumber.trim()
            ? { payoutBank: { accountNumber: form.bankAccountNumber, ifsc: form.bankIfsc, accountName: form.bankAccountName } }
            : {}),
        },
        "PUT",
      );
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.pgForm} onSubmit={(e) => void submit(e)} aria-label="Worker profile">
      <fieldset className={styles.pgFieldset}>
        <legend className={styles.pgLegend}>
          <span className={styles.pgLegendNum}>1</span> About you
        </legend>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            Full name
            <input required value={form.fullName} onChange={(e) => set("fullName", e.target.value)} autoComplete="name" placeholder="As on your college ID" />
          </label>
          <label className={styles.field}>
            I am a
            <select value={form.workerType} onChange={(e) => set("workerType", e.target.value)}>
              {Object.values(WorkerType).map((t) => (
                <option key={t} value={t}>
                  {WORKER_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Date of birth
            <input required type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} />
            <span className={styles.hint}>You must be 18 or older. Only your age is checked against gigs.</span>
          </label>
          <label className={styles.field}>
            College (optional)
            <input value={form.collegeName} onChange={(e) => set("collegeName", e.target.value)} placeholder="Your college or university" />
          </label>
        </div>
      </fieldset>

      <fieldset className={styles.pgFieldset}>
        <legend className={styles.pgLegend}>
          <span className={styles.pgLegendNum}>2</span> Where you’ll work
        </legend>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            City
            <input required value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Greater Noida" />
          </label>
          <label className={styles.field}>
            Area / locality (optional)
            <input value={form.locality} onChange={(e) => set("locality", e.target.value)} placeholder="e.g. Knowledge Park" />
          </label>
          <label className={styles.field}>
            How far will you travel (km)
            <input inputMode="numeric" value={form.workRadiusKm} onChange={(e) => set("workRadiusKm", e.target.value.replace(/\D/g, ""))} />
          </label>
        </div>
      </fieldset>

      <fieldset className={styles.pgFieldset}>
        <legend className={styles.pgLegend}>
          <span className={styles.pgLegendNum}>3</span> Your skills
        </legend>
        <div className={styles.formGrid}>
          <label className={`${styles.field} ${styles.full}`}>
            Skills (comma separated)
            <input value={form.skills} onChange={(e) => set("skills", e.target.value)} placeholder="hindi, sales, excel, photography" />
            <span className={styles.hint}>Gigs list the skills they need. Only add skills you actually have.</span>
          </label>
          <label className={styles.field}>
            Languages
            <input value={form.languages} onChange={(e) => set("languages", e.target.value)} />
          </label>
          <label className={`${styles.field} ${styles.full}`}>
            About you (optional)
            <textarea value={form.bio} onChange={(e) => set("bio", e.target.value)} maxLength={600} placeholder="A line or two about what you’re good at." />
          </label>
        </div>
      </fieldset>

      <fieldset className={styles.pgFieldset}>
        <legend className={styles.pgLegend}>
          <span className={styles.pgLegendNum}>4</span> Get paid
        </legend>
        {bank ? (
          <>
            <p className={styles.hint}>
              FastQue pays you by bank transfer (NEFT) to your own savings account.
              {saved && <> Saved: {saved.accountName}, account ending {saved.last4}, IFSC {saved.ifsc}. Leave the account number blank to keep it.</>}
            </p>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                Name on the bank account
                <input value={form.bankAccountName} onChange={(e) => set("bankAccountName", e.target.value)} autoComplete="off" required={!!form.bankAccountNumber.trim()} placeholder="Exactly as in your passbook" />
              </label>
              <label className={styles.field}>
                Account number
                <input value={form.bankAccountNumber} onChange={(e) => set("bankAccountNumber", e.target.value.replace(/[^\d ]/g, ""))} inputMode="numeric" autoComplete="off" placeholder={saved ? `•••• ${saved.last4}` : "9 to 18 digits"} />
              </label>
              <label className={styles.field}>
                IFSC
                <input value={form.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value.toUpperCase())} autoComplete="off" maxLength={11} required={!!form.bankAccountNumber.trim()} placeholder="e.g. SBIN0001234" />
              </label>
            </div>
            <span className={styles.hint}>🔒 Stored encrypted and only used to pay you. Businesses never see it.</span>
          </>
        ) : (
          <label className={styles.field}>
            UPI ID for payouts {initial?.payoutUpiVpaMasked && <span className={styles.hint}>(saved: {initial.payoutUpiVpaMasked} — leave blank to keep)</span>}
            <input value={form.payoutUpiVpa} onChange={(e) => set("payoutUpiVpa", e.target.value)} placeholder="yourname@bank" autoComplete="off" />
            <span className={styles.hint}>🔒 Only used to pay you. Businesses never see it.</span>
          </label>
        )}
      </fieldset>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.pgFormFoot}>
        <p className={styles.hint}>Joining is free. FastQue never asks you for a fee or deposit.</p>
        <button type="submit" className={styles.pgBigBtn} disabled={saving}>
          {saving ? "Saving…" : initial ? "Save profile" : "Create my profile →"}
        </button>
      </div>
    </form>
  );
}
