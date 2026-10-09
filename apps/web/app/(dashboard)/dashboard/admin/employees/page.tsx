"use client";

import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ADMIN_PATHS,
  UserStatus,
  type AdminEmployeeDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../lib/api";
import { Button, LinkButton } from "../../../../../components/ui/Button";
import { useAuth } from "../../../../../lib/auth-context";
import { buildEmployeeIdCardPreview, mayPreviewCompanyIdCard } from "../../../../../lib/employee-id-card";
import styles from "../admin.module.css";

export default function AdminEmployeesPage() {
  const { user } = useAuth();
  const [cardPhotos, setCardPhotos] = useState<Record<string, string>>({});
  const [employees, setEmployees] = useState<AdminEmployeeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [territory, setTerritory] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [specialNumber, setSpecialNumber] = useState("1");
  const [specialFullName, setSpecialFullName] = useState("");
  const [specialTerritory, setSpecialTerritory] = useState("");
  const [specialPassword, setSpecialPassword] = useState("");
  const [specialConfirmPassword, setSpecialConfirmPassword] = useState("");
  const [specialTotp, setSpecialTotp] = useState("");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEmployees(await apiFetch<AdminEmployeeDto[]>(`${ADMIN_PATHS.admin}/${ADMIN_PATHS.employees}`));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not load employees.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Defer the initial request so the effect does not synchronously trigger React state changes.
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => { cancelled = true; };
  }, [load]);

  async function createEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusyId("create");
    try {
      const employee = await apiFetch<AdminEmployeeDto>(
        `${ADMIN_PATHS.admin}/${ADMIN_PATHS.employees}`,
        {
          method: "POST",
          body: JSON.stringify({ fullName, territory: territory || undefined, password, confirmPassword }),
        },
      );
      setEmployees((current) => [employee, ...current]);
      setFullName("");
      setTerritory("");
      setPassword("");
      setConfirmPassword("");
      setSuccess(`Created ${employee.employeeCode} for ${employee.fullName}. Share the Employee ID and temporary password securely.`);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not create employee.");
    } finally {
      setBusyId(null);
    }
  }

  async function createSpecialEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const employeeNumber = Number(specialNumber);
    if (!Number.isInteger(employeeNumber) || employeeNumber < 1 || employeeNumber > 100) {
      setError("Reserved employee number must be between 1 and 100.");
      return;
    }
    if (specialPassword !== specialConfirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!/^\d{6}$/.test(specialTotp)) {
      setError("Enter the current 6-digit authenticator code.");
      return;
    }
    if (!window.confirm(`Use reserved FastQue Employee ID FQ-FE-${String(employeeNumber).padStart(5, "0")}? This range is owner-controlled.`)) return;

    setBusyId("special");
    try {
      const employee = await apiFetch<AdminEmployeeDto>(
        `${ADMIN_PATHS.admin}/${ADMIN_PATHS.employees}/${ADMIN_PATHS.special}`,
        {
          method: "POST",
          body: JSON.stringify({
            employeeNumber,
            fullName: specialFullName,
            territory: specialTerritory || undefined,
            password: specialPassword,
            confirmPassword: specialConfirmPassword,
            totpCode: specialTotp,
          }),
        },
      );
      setEmployees((current) => [employee, ...current]);
      setSpecialFullName("");
      setSpecialTerritory("");
      setSpecialPassword("");
      setSpecialConfirmPassword("");
      setSpecialTotp("");
      setSuccess(`Reserved ID ${employee.employeeCode} created after authenticator verification.`);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not create the reserved employee ID.");
    } finally {
      setBusyId(null);
    }
  }

  async function onCardPortrait(employee: AdminEmployeeDto, file: File | undefined) {
    setError(null);
    if (!file) {
      setCardPhotos(current => {
        const next = { ...current };
        delete next[employee.id];
        return next;
      });
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError("ID portrait must be a PNG, JPEG, or WebP under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setCardPhotos(current => ({ ...current, [employee.id]: reader.result as string }));
      }
    };
    reader.onerror = () => setError("Could not read the employee portrait.");
    reader.readAsDataURL(file);
  }

  function previewCompanyIdCard(employee: AdminEmployeeDto) {
    if (!mayPreviewCompanyIdCard(user?.roles ?? [], employee.employeeCode)) {
      setError("You are not authorized to preview this company ID card.");
      return;
    }
    try {
      const svg = document.getElementById("fastque-company-id-qr-" + employee.id)?.outerHTML;
      if (!svg) throw new Error("Website QR is not ready; reload the page.");
      const html = buildEmployeeIdCardPreview(employee, {
        qrSvg: svg,
        photoDataUrl: cardPhotos[employee.id],
        logoUrl: window.location.origin + "/brand/fastque-clean-lockup-transparent.png",
      });
      const popup = window.open("", "_blank");
      if (!popup) throw new Error("Allow popups to preview the employee ID card.");
      popup.opener = null;
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
      setSuccess("Draft company ID preview opened. Check portrait, QR and print at 100% size. This is not an issued ID.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not create the ID preview.");
    }
  }

  async function toggleStatus(employee: AdminEmployeeDto) {
    const next = employee.status === UserStatus.ACTIVE ? UserStatus.SUSPENDED : UserStatus.ACTIVE;
    const verb = next === UserStatus.ACTIVE ? "reactivate" : "deactivate";
    if (!window.confirm(`${verb} ${employee.fullName} (${employee.employeeCode})?`)) return;
    setBusyId(employee.id);
    setError(null);
    setSuccess(null);
    try {
      const updated = await apiFetch<AdminEmployeeDto>(
        `${ADMIN_PATHS.admin}/${ADMIN_PATHS.employees}/${employee.id}`,
        { method: "PATCH", body: JSON.stringify({ status: next }) },
      );
      setEmployees((current) => current.map((row) => row.id === updated.id ? updated : row));
      setSuccess(`${updated.employeeCode} is now ${updated.status.toLowerCase()}.`);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not change employee status.");
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(employee: AdminEmployeeDto) {
    const nextPassword = resetPasswords[employee.id] ?? "";
    if (nextPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (!window.confirm(`Reset the password for ${employee.employeeCode}? All existing employee sessions will be signed out.`)) return;
    setBusyId(employee.id);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(
        `${ADMIN_PATHS.admin}/${ADMIN_PATHS.employees}/${employee.id}/${ADMIN_PATHS.password}`,
        {
          method: "POST",
          body: JSON.stringify({ password: nextPassword, confirmPassword: nextPassword }),
        },
      );
      setResetPasswords((current) => ({ ...current, [employee.id]: "" }));
      setSuccess(`Password reset for ${employee.employeeCode}. Share the new password securely.`);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not reset employee password.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>FastQue field operations</p>
          <h1>Employees</h1>
          <p>Create Employee IDs, manage access, and reset field-team passwords.</p>
        </div>
        <div className={styles.headerActions}>
          <LinkButton href="/dashboard/admin" variant="outline">Platform operations</LinkButton>
          <LinkButton href="/dashboard/admin/crm" variant="outline">Field CRM</LinkButton>
          <LinkButton href="/employee/login" variant="outline">Open employee login</LinkButton>
        </div>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {success && <p className={styles.success} role="status">{success}</p>}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Add employee</h2>
          <span>Standard IDs start at FQ-FE-00101</span>
        </div>
        <form className={styles.employeeForm} onSubmit={createEmployee}>
          <label>
            Full name
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={2} maxLength={120} required placeholder="Field executive name" />
          </label>
          <label>
            Territory / area
            <input value={territory} onChange={(event) => setTerritory(event.target.value)} maxLength={160} placeholder="Patna, Bihar" />
          </label>
          <label>
            Temporary password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} required autoComplete="new-password" placeholder="Minimum 8 characters" />
          </label>
          <label>
            Confirm password
            <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} maxLength={72} required autoComplete="new-password" />
          </label>
          <div className={styles.formAction}>
            <Button type="submit" disabled={busyId === "create"}>
              {busyId === "create" ? "Creating…" : "Create employee"}
            </Button>
          </div>
        </form>
        <p className={styles.formHint}>IDs FQ-FE-00001 through FQ-FE-00100 are reserved and will never be issued by this standard form. Passwords are stored only as secure hashes.</p>
      </section>

      <section className={styles.section}>
        <details>
          <summary><strong>Reserved special employee IDs (1–100)</strong></summary>
          <p className={styles.formHint}>Owner-controlled range only. Creating one requires your current 6-digit FastQue admin authenticator code in addition to your signed-in admin session.</p>
          <form className={styles.employeeForm} onSubmit={createSpecialEmployee}>
            <label>
              Reserved number
              <input type="number" min={1} max={100} value={specialNumber} onChange={(event) => setSpecialNumber(event.target.value)} required />
            </label>
            <label>
              Full name
              <input value={specialFullName} onChange={(event) => setSpecialFullName(event.target.value)} minLength={2} maxLength={120} required />
            </label>
            <label>
              Territory / area
              <input value={specialTerritory} onChange={(event) => setSpecialTerritory(event.target.value)} maxLength={160} placeholder="Patna, Bihar" />
            </label>
            <label>
              Temporary password
              <input type="password" value={specialPassword} onChange={(event) => setSpecialPassword(event.target.value)} minLength={8} maxLength={72} required autoComplete="new-password" />
            </label>
            <label>
              Confirm password
              <input type="password" value={specialConfirmPassword} onChange={(event) => setSpecialConfirmPassword(event.target.value)} minLength={8} maxLength={72} required autoComplete="new-password" />
            </label>
            <label>
              Authenticator code
              <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={specialTotp} onChange={(event) => setSpecialTotp(event.target.value.replace(/\D/g, "").slice(0, 6))} required autoComplete="one-time-code" placeholder="6-digit code" />
            </label>
            <div className={styles.formAction}>
              <Button type="submit" disabled={busyId === "special"}>
                {busyId === "special" ? "Authenticating…" : "Authenticate & create reserved ID"}
              </Button>
            </div>
          </form>
        </details>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Employee accounts</h2>
          <span>{employees.length} total</span>
        </div>
        {loading ? <p className={styles.loading}>Loading employees…</p> : (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr><th>Employee</th><th>Territory</th><th>Status</th><th>Joined</th><th>Password reset</th><th>Access</th><th>ID card</th></tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <td><strong>{employee.fullName}</strong><small>{employee.employeeCode}</small></td>
                    <td>{employee.territory ?? "Not assigned"}</td>
                    <td><span className={styles.status}>{employee.status}</span></td>
                    <td>{new Date(employee.joinedAt).toLocaleDateString()}</td>
                    <td>
                      <div className={styles.passwordReset}>
                        <input
                          type="password"
                          minLength={8}
                          maxLength={72}
                          value={resetPasswords[employee.id] ?? ""}
                          onChange={(event) => setResetPasswords((current) => ({ ...current, [employee.id]: event.target.value }))}
                          placeholder="New password"
                          autoComplete="new-password"
                        />
                        <Button type="button" variant="outline" disabled={busyId === employee.id} onClick={() => void resetPassword(employee)}>
                          Reset
                        </Button>
                      </div>
                    </td>
                    <td>
                      <Button type="button" variant="outline" disabled={busyId === employee.id} onClick={() => void toggleStatus(employee)}>
                        {employee.status === UserStatus.ACTIVE ? "Deactivate" : "Reactivate"}
                      </Button>
                    </td>
                    <td>
                      {mayPreviewCompanyIdCard(user?.roles ?? [], employee.employeeCode) ? (
                        <div style={{ display: "grid", gap: 6, minWidth: 140 }}>
                          <label style={{ fontSize: 11 }}>Portrait (optional for draft)
                            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void onCardPortrait(employee, event.target.files?.[0])} />
                          </label>
                          <span aria-hidden="true" style={{ position: "absolute", left: "-9999px" }}>
                            <QRCodeSVG id={"fastque-company-id-qr-" + employee.id} value="https://fastque.com" size={128} level="H" />
                          </span>
                          <Button type="button" variant="outline" onClick={() => previewCompanyIdCard(employee)}>
                            Preview ID card (DRAFT)
                          </Button>
                        </div>
                      ) : <span>Restricted</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && employees.length === 0 && <p className={styles.empty}>No employee accounts yet. Create the first one above.</p>}
      </section>
    </main>
  );
}
