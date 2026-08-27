"use client";

import { useState } from "react";
import { staffLoginSchema } from "@barbercue/shared";
import { ApiError } from "../../lib/api";
import { authButtonStyle, authErrorStyle, authInputStyle } from "./AuthCard";

/**
 * Shared by /owner/login and /staff/login — both roles authenticate identically (email +
 * password against the same POST /auth/staff/login endpoint per AuthService), so the form logic
 * lives once here rather than being duplicated across two near-identical pages.
 */
export function EmailPasswordLoginForm({
  onSubmit,
  forgotPasswordHref,
}: {
  onSubmit: (input: { email: string; password: string }) => Promise<void>;
  forgotPasswordHref: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = staffLoginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid email or password.");
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
    <form onSubmit={handleSubmit}>
      {error && <p style={authErrorStyle}>{error}</p>}
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={authInputStyle}
        autoFocus
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={authInputStyle}
      />
      <button type="submit" style={authButtonStyle} disabled={submitting}>
        {submitting ? "Logging in..." : "Log in"}
      </button>
      <p style={{ textAlign: "center", marginTop: 16, fontSize: "0.85rem" }}>
        <a href={forgotPasswordHref} style={{ color: "var(--bc-muted)" }}>
          Forgot password?
        </a>
      </p>
    </form>
  );
}
