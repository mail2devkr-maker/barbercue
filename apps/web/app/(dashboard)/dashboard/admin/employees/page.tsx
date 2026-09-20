"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ADMIN_PATHS,
  UserStatus,
  type AdminEmployeeDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../lib/api";
import { Button, LinkButton } from "../../../../../components/ui/Button";
import styles from "../admin.module.css";

export default function AdminEmployeesPage() {
  const [employees, setEmployees] = useState<AdminEmployeeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [territory, setTerritory] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
    void load();
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
          <LinkButton href="/employee/login" variant="outline">Open employee login</LinkButton>
        </div>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {success && <p className={styles.success} role="status">{success}</p>}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Add employee</h2>
          <span>Employee ID is generated automatically</span>
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
        <p className={styles.formHint}>Passwords are stored only as secure hashes. FastQue does not display the password again after creation.</p>
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
                <tr><th>Employee</th><th>Territory</th><th>Status</th><th>Joined</th><th>Password reset</th><th>Access</th></tr>
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
