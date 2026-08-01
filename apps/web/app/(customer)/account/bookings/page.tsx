"use client";

import { useAuth } from "../../../../lib/auth-context";

// Customer account — my bookings. Auth-gated by app/(customer)/account/layout.tsx (Phase 2).
export default function MyBookingsPage() {
  const { user, logout } = useAuth();

  return (
    <main style={{ padding: "3rem 1.5rem" }}>
      <h1>My bookings</h1>
      <p>Logged in as <strong>{user?.phone}</strong>.</p>
      <p>Customer account area — placeholder, not yet implemented.</p>
      <button onClick={() => void logout()} style={{ marginTop: 16 }}>
        Log out
      </button>
    </main>
  );
}
