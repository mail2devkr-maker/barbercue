"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  ADMIN_PATHS,
  Role,
  type AdminAccessUserDto,
  type ManagedAdminRole,
} from "@barbercue/shared";
import { ApiError, apiFetch } from "../../../../../lib/api";
import { LinkButton } from "../../../../../components/ui/Button";
import styles from "../admin.module.css";

const MANAGED_ROLES: Array<{ value: ManagedAdminRole; label: string }> = [
  { value: Role.CO_FOUNDER, label: "Co-Founder" },
  { value: Role.HR_ADMIN, label: "HR Admin" },
  { value: Role.SALES_ADMIN, label: "Sales Admin" },
  { value: Role.PLATFORM_VIEWER, label: "Read-only Viewer" },
];

function labelRole(role: Role): string {
  return role
    .replace(/^PLATFORM_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AdminAccessPage() {
  const [users, setUsers] = useState<AdminAccessUserDto[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ManagedAdminRole>(Role.CO_FOUNDER);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let active = true;
    void apiFetch<AdminAccessUserDto[]>(`${ADMIN_PATHS.admin}/${ADMIN_PATHS.access}`)
      .then((nextUsers) => {
        if (!active) return;
        setUsers(nextUsers);
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof ApiError ? err.message : "Could not load access list.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      const next = await apiFetch<AdminAccessUserDto[]>(`${ADMIN_PATHS.admin}/${ADMIN_PATHS.access}`, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setUsers(next);
      setEmail("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not grant access.");
    } finally {
      setWorking(false);
    }
  }

  async function revoke(userId: string, roleToRemove: ManagedAdminRole) {
    if (!window.confirm(`Remove ${labelRole(roleToRemove)} access from this account?`)) return;
    setWorking(true);
    setError(null);
    try {
      const next = await apiFetch<AdminAccessUserDto[]>(
        `${ADMIN_PATHS.admin}/${ADMIN_PATHS.access}/${userId}/${ADMIN_PATHS.revoke}`,
        { method: "POST", body: JSON.stringify({ role: roleToRemove }) },
      );
      setUsers(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not revoke access.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Super Admin only</p>
          <h1>CRM access management</h1>
          <p>Grant separate FastQue accounts to co-founders, HR, sales, or read-only viewers. Password sharing is not required.</p>
        </div>
        <LinkButton href="/dashboard/admin" variant="outline">Platform operations</LinkButton>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Grant access</h2>
            <span>Google sign-in + authenticator code remains mandatory on the admin login surface.</span>
          </div>
        </div>
        <form onSubmit={grant} style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(180px, .5fr) auto", gap: 12, alignItems: "end" }}>
          <label>
            <span>Email address</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cofounder@example.com" required />
          </label>
          <label>
            <span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as ManagedAdminRole)}>
              {MANAGED_ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <button type="submit" disabled={working}>{working ? "Saving…" : "Grant access"}</button>
        </form>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}><h2>Current internal access</h2><span>{users.length} accounts</span></div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Account</th><th>Roles</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.email ?? "No email"}</strong></td>
                  <td>{item.roles.map(labelRole).join(", ")}</td>
                  <td>{item.status}</td>
                  <td>
                    {item.roles
                      .filter((r): r is ManagedAdminRole => r !== Role.PLATFORM_ADMIN)
                      .map((r) => (
                        <button key={r} type="button" disabled={working} onClick={() => void revoke(item.id, r)} style={{ marginRight: 8 }}>
                          Remove {labelRole(r)}
                        </button>
                      ))}
                    {item.roles.includes(Role.PLATFORM_ADMIN) && <small>Super Admin protected</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
