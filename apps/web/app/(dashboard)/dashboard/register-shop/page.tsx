"use client";

import { RequireRole } from "../../../../components/auth/RequireRole";
import { RegisterSalonForm } from "../../../../components/salons/RegisterSalonForm";

// Deliberately OUTSIDE dashboard/salons/layout.tsx's STAFF/OWNER-only RequireRole: registration
// is how a plain CUSTOMER becomes a SALON_OWNER in the first place, so it needs a looser gate (any
// authenticated user, no `roles` restriction) than the rest of the salon dashboard.
export default function RegisterShopPage() {
  return (
    <RequireRole redirectTo="/login">
      <main style={{ padding: "3rem 1.5rem", maxWidth: 600, margin: "0 auto" }}>
        <h1>Register your barber shop</h1>
        <p style={{ color: "#6B6357", marginBottom: 28 }}>
          You&apos;ll get a unique shop ID and a dashboard to manage bookings and your live queue.
          Your shop starts in pending review before it&apos;s visible to customers.
        </p>
        <RegisterSalonForm />
      </main>
    </RequireRole>
  );
}
