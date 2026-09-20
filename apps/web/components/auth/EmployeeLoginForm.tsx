"use client";

import { useState } from "react";
import { employeeLoginSchema } from "@barbercue/shared";
import { ApiError } from "../../lib/api";
import styles from "./customer-auth.module.css";

export function EmployeeLoginForm({
  onSubmit,
}: {
  onSubmit: (input: { employeeCode: string; password: string }) => Promise<void>;
}) {
  const [employeeCode, setEmployeeCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = employeeLoginSchema.safeParse({ employeeCode, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid Employee ID and password.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {error && <p className={styles.errorMessage} role="alert">{error}</p>}
      <div className={styles.field}>
        <label htmlFor="employee-code">Employee ID</label>
        <input
          id="employee-code"
          type="text"
          inputMode="text"
          autoComplete="username"
          placeholder="FQ-FE-00001"
          value={employeeCode}
          onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
          className={styles.input}
          autoFocus
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="employee-password">Password</label>
        <input
          id="employee-password"
          type="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={styles.input}
        />
      </div>
      <button type="submit" className={styles.primaryButton} disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in as employee"}
      </button>
      <p className={styles.formFootnote}>
        Employee accounts are issued and managed by FastQue administrators.
      </p>
    </form>
  );
}
