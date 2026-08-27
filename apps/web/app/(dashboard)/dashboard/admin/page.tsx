"use client";

import { useAuth } from "../../../../lib/auth-context";
import { Button } from "../../../../components/ui/Button";

// Platform admin — same (dashboard) route group as owner/staff, gated by a stricter
// PLATFORM_ADMIN-only guard per ARCHITECTURE.md §2.
export default function AdminDashboardPage() {
  const { user, logout } = useAuth();

  return (
    <main style={{ padding: "3rem 1.5rem" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.8rem", letterSpacing: "-0.01em", color: "var(--bc-ink)" }}>
        Platform admin
      </h1>
      <p style={{ color: "var(--bc-muted)" }}>
        Logged in as <strong style={{ color: "var(--bc-ink)" }}>{user?.email}</strong> ({user?.roles.join(", ")}).
      </p>
      <p style={{ color: "var(--bc-muted)" }}>Admin dashboard — placeholder, not yet implemented.</p>
      <div style={{ marginTop: 16 }}>
        <Button type="button" variant="outline" onClick={() => void logout()}>
          Log out
        </Button>
      </div>
    </main>
  );
}
