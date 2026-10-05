"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ADMIN_PATHS,
  CrmFollowUpStatus,
  CrmLeadStatus,
  type AdminCrmFollowUpDto,
  type AdminCrmLeadDto,
  type AdminCrmOverviewDto,
  type AdminCrmVisitDto,
} from "@barbercue/shared";
import { ApiError, apiFetch } from "../../../../../lib/api";
import { LinkButton } from "../../../../../components/ui/Button";
import styles from "../admin.module.css";
import { buildOfferLetterPdf, extractResumeHints, loadFastQueLogoForPdf, type SalaryBasis } from "./offer-letter";

function pretty(value: string): string {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not load CRM activity.";
}

const crmBase = `${ADMIN_PATHS.admin}/${ADMIN_PATHS.crm}`;

export default function AdminCrmPage() {
  const [overview, setOverview] = useState<AdminCrmOverviewDto | null>(null);
  const [leads, setLeads] = useState<AdminCrmLeadDto[]>([]);
  const [visits, setVisits] = useState<AdminCrmVisitDto[]>([]);
  const [followUps, setFollowUps] = useState<AdminCrmFollowUpDto[]>([]);
  const [employeeId, setEmployeeId] = useState("ALL");
  const [leadStatus, setLeadStatus] = useState<"ALL" | CrmLeadStatus>("ALL");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offerResume, setOfferResume] = useState<File | null>(null);
  const [offerName, setOfferName] = useState("");
  const [offerRole, setOfferRole] = useState("Field Sales Executive");
  const [offerEmployeeCode, setOfferEmployeeCode] = useState("");
  const [offerAddress, setOfferAddress] = useState("");
  const [offerEmail, setOfferEmail] = useState("");
  const [offerPhone, setOfferPhone] = useState("");
  const [offerSalary, setOfferSalary] = useState("");
  const [offerSalaryBasis, setOfferSalaryBasis] = useState<SalaryBasis>("monthly");
  const [offerJoiningDate, setOfferJoiningDate] = useState("");
  const [offerStatus, setOfferStatus] = useState<string | null>(null);
  const [offerWorking, setOfferWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextOverview, nextLeads, nextVisits, nextFollowUps] = await Promise.all([
        apiFetch<AdminCrmOverviewDto>(`${crmBase}/${ADMIN_PATHS.overview}`),
        apiFetch<AdminCrmLeadDto[]>(`${crmBase}/${ADMIN_PATHS.leads}`),
        apiFetch<AdminCrmVisitDto[]>(`${crmBase}/${ADMIN_PATHS.visits}`),
        apiFetch<AdminCrmFollowUpDto[]>(`${crmBase}/${ADMIN_PATHS.followUps}`),
      ]);
      setOverview(nextOverview);
      setLeads(nextLeads);
      setVisits(nextVisits);
      setFollowUps(nextFollowUps);
      setError(null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  const onOfferResumeChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setOfferStatus(null);
    setOfferResume(file);
    if (!file) return;

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "docx", "txt"].includes(extension)) {
      setOfferStatus("Use a PDF, DOCX, or TXT resume.");
      setOfferResume(null);
      event.target.value = "";
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setOfferStatus("Resume must be 8 MB or smaller.");
      setOfferResume(null);
      event.target.value = "";
      return;
    }

    setOfferWorking(true);
    try {
      const hints = await extractResumeHints(file);
      if (hints.candidateName) setOfferName(hints.candidateName);
      if (hints.email) setOfferEmail(hints.email);
      if (hints.phone) setOfferPhone(hints.phone);
      if (hints.address) setOfferAddress(hints.address);
      setOfferStatus("Resume read locally. Verify the candidate details below.");
    } catch {
      setOfferStatus("Resume selected. Enter or verify the candidate details below.");
    } finally {
      setOfferWorking(false);
    }
  };

  const generateOfferLetter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOfferStatus(null);
    if (!offerResume) {
      setOfferStatus("Upload the candidate resume first.");
      return;
    }
    const salary = Number(offerSalary.replace(/,/g, ""));
    if (!Number.isFinite(salary) || salary <= 0) {
      setOfferStatus("Enter a valid base salary greater than zero.");
      return;
    }
    if (!offerName.trim()) {
      setOfferStatus("Candidate name is required.");
      return;
    }

    setOfferWorking(true);
    try {
      const brandImage = await loadFastQueLogoForPdf();
      const bytes = buildOfferLetterPdf({
        candidateName: offerName.trim(),
        email: offerEmail.trim(),
        phone: offerPhone.trim(),
        role: offerRole.trim() || "Field Sales Executive",
        employeeCode: offerEmployeeCode.trim(),
        address: offerAddress.trim(),
        baseSalary: salary,
        salaryBasis: offerSalaryBasis,
        joiningDate: offerJoiningDate,
      }, brandImage);
      const pdfBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(pdfBuffer).set(bytes);
      const blob = new Blob([pdfBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `FastQue-Offer-Letter-${offerName.trim().replace(/[^A-Za-z0-9]+/g, "-") || "Candidate"}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setOfferStatus("Branded 3-page offer letter PDF generated. Check your Downloads folder.");
    } catch {
      setOfferStatus("Could not generate the offer letter PDF. Please verify the details and try again.");
    } finally {
      setOfferWorking(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const filteredLeads = useMemo(
    () =>
      leads.filter(
        (lead) =>
          (employeeId === "ALL" || lead.employee.id === employeeId) &&
          (leadStatus === "ALL" || lead.status === leadStatus) &&
          (!q ||
            `${lead.shopName} ${lead.contactName ?? ""} ${lead.phone ?? ""} ${lead.email ?? ""} ${lead.city ?? ""} ${lead.locality ?? ""} ${lead.employee.fullName} ${lead.employee.employeeCode}`
              .toLowerCase()
              .includes(q)),
      ),
    [employeeId, leadStatus, leads, q],
  );

  const filteredVisits = useMemo(
    () =>
      visits.filter(
        (visit) =>
          (employeeId === "ALL" || visit.employee.id === employeeId) &&
          (!q ||
            `${visit.shopName} ${visit.employee.fullName} ${visit.employee.employeeCode} ${visit.outcome}`
              .toLowerCase()
              .includes(q)),
      ),
    [employeeId, q, visits],
  );

  const filteredFollowUps = useMemo(
    () =>
      followUps.filter(
        (item) =>
          (employeeId === "ALL" || item.employee.id === employeeId) &&
          (!q ||
            `${item.leadShopName} ${item.employee.fullName} ${item.employee.employeeCode} ${item.channel} ${item.status}`
              .toLowerCase()
              .includes(q)),
      ),
    [employeeId, followUps, q],
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>FastQue field operations</p>
          <h1>CRM control center</h1>
          <p>Leads, visits, follow-ups, employee performance and shop onboarding attribution.</p>
        </div>
        <div className={styles.headerActions}>
          <a className={styles.offerHeaderButton} href="#offer-letter">Offer letter</a>
          <LinkButton href="/dashboard/admin/employees" variant="outline">Employees</LinkButton>
          <LinkButton href="/dashboard/admin" variant="outline">Platform operations</LinkButton>
        </div>
      </header>

      <section id="offer-letter" className={`${styles.section} ${styles.offerLetterPanel}`} aria-labelledby="offer-letter-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>HR automation</p>
            <h2 id="offer-letter-title">Offer letter generator</h2>
          </div>
          <span>Resume + base salary → PDF</span>
        </div>
        <form className={styles.offerLetterForm} onSubmit={generateOfferLetter}>
          <label className={styles.offerUpload}>
            <span>Employee / candidate resume</span>
            <input type="file" accept=".pdf,.docx,.txt" onChange={onOfferResumeChange} required />
            <small>{offerResume ? `${offerResume.name} · ${(offerResume.size / 1024).toFixed(0)} KB` : "PDF, DOCX or TXT · max 8 MB"}</small>
          </label>
          <div className={styles.offerLetterGrid}>
            <label><span>Base salary (INR)</span><input value={offerSalary} onChange={(e) => setOfferSalary(e.target.value)} inputMode="decimal" placeholder="50000" required /></label>
            <label><span>Salary basis</span><select value={offerSalaryBasis} onChange={(e) => setOfferSalaryBasis(e.target.value as SalaryBasis)}><option value="monthly">Per month</option><option value="annual">Per annum</option></select></label>
            <label><span>Candidate name</span><input value={offerName} onChange={(e) => setOfferName(e.target.value)} placeholder="Auto-filled when possible" required /></label>
            <label><span>Offered role</span><input value={offerRole} onChange={(e) => setOfferRole(e.target.value)} placeholder="Field Sales Executive" /></label>
            <label><span>Employee number <small>(optional)</small></span><input value={offerEmployeeCode} onChange={(e) => setOfferEmployeeCode(e.target.value)} placeholder="Generated later if blank" /></label>
            <label><span>Address <small>(optional)</small></span><input value={offerAddress} onChange={(e) => setOfferAddress(e.target.value)} placeholder="Candidate postal address" /></label>
            <label><span>Email <small>(optional)</small></span><input type="email" value={offerEmail} onChange={(e) => setOfferEmail(e.target.value)} /></label>
            <label><span>Phone <small>(optional)</small></span><input value={offerPhone} onChange={(e) => setOfferPhone(e.target.value)} /></label>
            <label><span>Proposed joining date <small>(optional)</small></span><input type="date" value={offerJoiningDate} onChange={(e) => setOfferJoiningDate(e.target.value)} /></label>
          </div>
          <div className={styles.offerLetterActions}>
            <button className={styles.offerLetterButton} type="submit" disabled={offerWorking}>{offerWorking ? "Reading resume…" : "Generate offer letter PDF"}</button>
            <p className={styles.offerPrivacy}>Resume processing and PDF generation happen in your browser. The PDF uses the original FastQue logo, landing-page gradient, detailed employment terms, acceptance section and salary annexure. The resume is not uploaded or stored.</p>
          </div>
          {offerStatus && <p className={styles.offerStatus} role="status">{offerStatus}</p>}
        </form>
      </section>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {loading && !overview && <p className={styles.loading}>Loading field CRM…</p>}

      {overview && (
        <>
          <section className={styles.metrics} aria-label="CRM totals">
            <article><strong>{overview.counts.employees}</strong><span>Employees</span></article>
            <article><strong>{overview.counts.leads}</strong><span>Leads</span></article>
            <article><strong>{overview.counts.onboarded}</strong><span>Onboarded</span></article>
            <article><strong>{overview.counts.visitsLast30Days}</strong><span>Visits · 30 days</span></article>
            <article><strong>{overview.counts.openFollowUps}</strong><span>Open follow-ups</span></article>
            <article><strong>{overview.counts.overdueFollowUps}</strong><span>Overdue</span></article>
            <article><strong>{overview.conversionRatePercent}%</strong><span>Conversion</span></article>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>Employee performance</h2>
              <span>Field sales/onboarding activity</span>
            </div>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Territory</th>
                    <th>Leads</th>
                    <th>Onboarded</th>
                    <th>Conversion</th>
                    <th>Visits · 30d</th>
                    <th>Open follow-ups</th>
                    <th>Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.performance.map((row) => (
                    <tr key={row.employee.id}>
                      <td><strong>{row.employee.fullName}</strong><small>{row.employee.employeeCode} · {row.employee.status}</small></td>
                      <td>{row.employee.territory ?? "Not assigned"}</td>
                      <td>{row.leads}</td>
                      <td>{row.onboarded}</td>
                      <td>{row.conversionRatePercent}%</td>
                      <td>{row.visitsLast30Days}</td>
                      <td>{row.openFollowUps}</td>
                      <td>{row.overdueFollowUps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {overview.performance.length === 0 && <p className={styles.empty}>No field employees configured yet.</p>}
          </section>

          <section className={styles.filters} aria-label="CRM filters">
            <div>
              <label htmlFor="crm-search">Search CRM</label>
              <input id="crm-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Shop, contact, employee, city…" />
            </div>
            <div>
              <label htmlFor="crm-employee">Employee</label>
              <select id="crm-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="ALL">All employees</option>
                {overview.performance.map((row) => (
                  <option key={row.employee.id} value={row.employee.id}>
                    {row.employee.employeeCode} · {row.employee.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="crm-status">Lead status</label>
              <select id="crm-status" value={leadStatus} onChange={(e) => setLeadStatus(e.target.value as "ALL" | CrmLeadStatus)}>
                <option value="ALL">All lead stages</option>
                {Object.values(CrmLeadStatus).map((value) => <option key={value} value={value}>{pretty(value)}</option>)}
              </select>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><h2>Lead pipeline</h2><span>{filteredLeads.length} shown</span></div>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Shop</th><th>Employee</th><th>Contact</th><th>Location</th><th>Stage</th><th>Attribution</th><th>Updated</th></tr></thead>
                <tbody>{filteredLeads.map((lead) => (
                  <tr key={lead.id}>
                    <td><strong>{lead.shopName}</strong><small>{pretty(lead.source)}</small></td>
                    <td><strong>{lead.employee.fullName}</strong><small>{lead.employee.employeeCode}</small></td>
                    <td>{lead.contactName ?? "—"}<small>{lead.phone ?? lead.email ?? "No contact"}</small></td>
                    <td>{[lead.locality, lead.city].filter(Boolean).join(", ") || "—"}</td>
                    <td><span className={styles.status}>{pretty(lead.status)}</span></td>
                    <td>{lead.onboardedSalon ? <><strong>{lead.onboardedSalon.publicId}</strong><small>{lead.onboardedSalon.name}</small></> : "—"}</td>
                    <td>{dateTime(lead.updatedAt)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {filteredLeads.length === 0 && <p className={styles.empty}>No leads match these filters.</p>}
          </section>

          <div className={styles.twoColumn}>
            <section className={styles.section}>
              <div className={styles.sectionHeader}><h2>Field visits</h2><span>{filteredVisits.length} shown</span></div>
              <div className={styles.activityGrid}>
                {filteredVisits.slice(0, 100).map((visit) => (
                  <article key={visit.id}>
                    <strong>{visit.shopName}</strong>
                    <span>{visit.employee.employeeCode} · {visit.employee.fullName}</span>
                    <small>{pretty(visit.outcome)} · {dateTime(visit.visitedAt)}</small>
                    {visit.notes && <small>{visit.notes}</small>}
                  </article>
                ))}
              </div>
              {filteredVisits.length === 0 && <p className={styles.empty}>No visits match these filters.</p>}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}><h2>Follow-ups</h2><span>{filteredFollowUps.length} shown</span></div>
              <div className={styles.activityGrid}>
                {filteredFollowUps.slice(0, 100).map((item) => {
                  const overdue = item.status === CrmFollowUpStatus.OPEN && new Date(item.dueAt).getTime() < Date.now();
                  return (
                    <article key={item.id} style={overdue ? { borderColor: "rgba(255,111,145,.48)" } : undefined}>
                      <strong>{item.leadShopName}</strong>
                      <span>{item.employee.employeeCode} · {item.employee.fullName}</span>
                      <small>{pretty(item.channel)} · {pretty(item.status)} · {dateTime(item.dueAt)}</small>
                      {overdue && <small style={{ color: "#ffb7c9", fontWeight: 700 }}>OVERDUE</small>}
                    </article>
                  );
                })}
              </div>
              {filteredFollowUps.length === 0 && <p className={styles.empty}>No follow-ups match these filters.</p>}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
