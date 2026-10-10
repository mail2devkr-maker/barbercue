"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ADMIN_PATHS, UserStatus, type AdminEmployeeDto } from "@barbercue/shared";
import { QRCodeCanvas } from "qrcode.react";
import { ApiError, apiFetch } from "../../../../../lib/api";
import styles from "../admin.module.css";
import { buildEmployeeIdCardDraftPdf, formatEmployeeJoiningDate, OFFICIAL_SITE_QR_URL } from "./employee-id-card";

/** HR/Co-Founder/Platform Admin-only official ID-card generator for registered active employees. */
export default function EmployeeIdCardGenerator() {
  const [employees, setEmployees] = useState<AdminEmployeeDto[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [territory, setTerritory] = useState("");
  const [designation, setDesignation] = useState("Field Executive");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const qrNode = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const rows = await apiFetch<AdminEmployeeDto[]>(ADMIN_PATHS.admin + "/" + ADMIN_PATHS.employees);
      setEmployees(rows.filter((row) => row.status === UserStatus.ACTIVE));
    } catch (error) {
      setStatus(error instanceof ApiError ? error.message : "Could not load employee records.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = employees.find((employee) => employee.id === employeeId) ?? null;

  function selectEmployee(event: ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value;
    const employee = employees.find((item) => item.id === id);
    setEmployeeId(id);
    setTerritory(employee?.territory ?? "");
    setDesignation("Field Executive");
    setStatus(null);
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setStatus(null);
    if (file && (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024 || file.size === 0
    )) {
      setPhoto(null);
      setStatus("Choose a PNG, JPG or WebP image up to 5 MB.");
      event.target.value = "";
      return;
    }
    setPhoto(file);
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    const qrCanvas = qrNode.current?.querySelector("canvas");
    if (!selected || !photo || !qrCanvas) {
      setStatus("Select a registered employee, choose a photo and wait for the QR to load.");
      return;
    }
    setBusy(true);
    try {
      // Avoid issuing with a stale inactive/renamed employee selection.
      const liveRows = await apiFetch<AdminEmployeeDto[]>(ADMIN_PATHS.admin + "/" + ADMIN_PATHS.employees);
      const latest = liveRows.find((row) => row.id === selected.id);
      if (!latest || latest.status !== UserStatus.ACTIVE || latest.employeeCode !== selected.employeeCode ||
          latest.fullName !== selected.fullName || latest.joinedAt !== selected.joinedAt) {
        throw new Error("Employee record changed or is no longer active. Refresh and select again.");
      }
      const bytes = await buildEmployeeIdCardDraftPdf({
        employeeCode: latest.employeeCode,
        fullName: latest.fullName,
        joinedAt: latest.joinedAt,
        territory: territory.trim().slice(0, 160),
        designation: designation.trim().slice(0, 100) || "Field Executive",
        photo,
        siteQrCanvas: qrCanvas,
      });
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "FastQue-Employee-ID-" + selected.employeeCode + ".pdf";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
      setStatus("Official FastQue company ID card downloaded. Print at 100% actual size. QR opens only fastque.com.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not generate ID card draft.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="company-id-card" className={styles.section + " " + styles.offerLetterPanel} aria-labelledby="company-id-card-title">
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>HR automation</p>
          <h2 id="company-id-card-title">Company ID card generator</h2>
        </div>
        <span>Employee + photo → official A4 ID card</span>
      </div>
      <form className={styles.offerLetterForm} onSubmit={(event) => void generate(event)}>
        <div className={styles.offerLetterGrid}>
          <label>
            <span>Registered employee</span>
            <select value={employeeId} onChange={selectEmployee} required disabled={loading || busy}>
              <option value="">{loading ? "Loading employees..." : "Select employee"}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName + " (" + employee.employeeCode + ")"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Employee ID (issued in employee management)</span>
            <input readOnly value={selected?.employeeCode ?? ""} placeholder="Select employee first" />
          </label>
          <label>
            <span>Employee name (from CRM)</span>
            <input readOnly value={selected?.fullName ?? ""} placeholder="Select employee first" />
          </label>
          <label>
            <span>Designation</span>
            <input value={designation} onChange={(event) => setDesignation(event.target.value)} maxLength={100} required />
          </label>
          <label>
            <span>Location / territory</span>
            <input value={territory} onChange={(event) => setTerritory(event.target.value)} maxLength={160} placeholder="Delhi - NCR" />
          </label>
          <label>
            <span>Joining date (from employee record)</span>
            <input readOnly value={selected ? formatEmployeeJoiningDate(selected.joinedAt) : ""} />
          </label>
        </div>
        <label className={styles.offerUpload}>
          <span>Employee photograph</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={choosePhoto} required />
          <small>{photo ? photo.name : "PNG / JPG / WebP; maximum 5 MB. Photo is processed only in this browser."}</small>
        </label>
        <div className={styles.offerLetterActions}>
          <button className={styles.offerLetterButton} type="submit" disabled={busy || loading || !selected}>
            {busy ? "Generating A4 PDF..." : "Generate official company ID card PDF"}
          </button>
          <p className={styles.offerPrivacy}>
            Uses the existing FastQue front/back card style at standard 85.6 × 54 mm per side.
            Employee name and ID come from real records. This form cannot allocate a new or reserved employee ID.
          </p>
        </div>
        <p className={styles.offerPrivacy}>
          An approved HR signature is printed once, at the bottom of the back.
          The QR opens <strong>fastque.com</strong> only and does not verify employee status.
          Generate cards only for authorized, active personnel. Photos are processed in this browser and not permanently stored.
        </p>
        {status && <p className={styles.offerStatus} role="status">{status}</p>}
      </form>
      <div aria-hidden="true" ref={qrNode} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
        <QRCodeCanvas value={OFFICIAL_SITE_QR_URL} size={256} level="H" bgColor="#ffffff" fgColor="#17131b" marginSize={2} />
      </div>
    </section>
  );
}
