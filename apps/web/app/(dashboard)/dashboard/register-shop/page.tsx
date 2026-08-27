"use client";

import { RequireRole } from "../../../../components/auth/RequireRole";
import { RegisterSalonForm } from "../../../../components/salons/RegisterSalonForm";

// Deliberately OUTSIDE dashboard/salons/layout.tsx's STAFF/OWNER-only RequireRole: registration
// is how a plain CUSTOMER becomes a SALON_OWNER in the first place, so it needs a looser gate (any
// authenticated user, no `roles` restriction) than the rest of the salon dashboard.
export default function RegisterShopPage() {
  return (
    <RequireRole redirectTo="/login">
      <main style={{ padding: "2.5rem 1.5rem 3rem", maxWidth: 600, margin: "0 auto" }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: "1.8rem",
            letterSpacing: "-0.01em",
            color: "var(--bc-ink)",
            marginBottom: 4,
          }}
        >
          Register your barber shop
        </h1>
        {/* Phase 11 replaced admin moderation with owner self-activation, so this no longer says
            "pending review" — nobody reviews it, and implying otherwise leaves owners waiting for
            an approval that will never arrive. */}
        <p style={{ color: "var(--bc-muted)", marginBottom: 28, lineHeight: 1.55 }}>
          You&apos;ll get a unique shop ID and a dashboard to manage bookings and your live queue.
          Your shop starts closed. Add your services, chairs and barbers, then open it yourself
          from your dashboard — there&apos;s no waiting for approval.
        </p>
        <RegisterSalonForm />
      </main>
    </RequireRole>
  );
}
