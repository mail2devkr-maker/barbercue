"use client";

import { useAuth } from "../../../../lib/auth-context";

// Landing page after a successful owner/staff login. Salon selection/management is a later
// phase (PROJECT_STRUCTURE.md) — this confirms the auth+RBAC foundation is working end to end.
export default function SalonsDashboardHomePage() {
  const { user, logout } = useAuth();

  return (
    <main style={{ padding: "3rem 1.5rem" }}>
      <h1>Salon dashboard</h1>
      <p>
        Logged in as <strong>{user?.email}</strong> ({user?.roles.join(", ")}).
      </p>
      <p>Salon/queue/staff management — placeholder, not yet implemented.</p>
      <button onClick={() => void logout()} style={{ marginTop: 16 }}>
        Log out
      </button>
    </main>
  );
}
