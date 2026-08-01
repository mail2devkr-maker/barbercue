"use client";

import { useAuth } from "../../../../lib/auth-context";

// Platform admin — same (dashboard) route group as owner/staff, gated by a stricter
// PLATFORM_ADMIN-only guard per ARCHITECTURE.md §2.
export default function AdminDashboardPage() {
  const { user, logout } = useAuth();

  return (
    <main style={{ padding: "3rem 1.5rem" }}>
      <h1>Platform admin</h1>
      <p>
        Logged in as <strong>{user?.email}</strong> ({user?.roles.join(", ")}).
      </p>
      <p>Admin dashboard — placeholder, not yet implemented.</p>
      <button onClick={() => void logout()} style={{ marginTop: 16 }}>
        Log out
      </button>
    </main>
  );
}
