"use client";

import { useState } from "react";
import { RequireRole } from "../../../../components/auth/RequireRole";
import { InitialPasswordSetup } from "../../../../components/auth/InitialPasswordSetup";
import { RegisterSalonForm } from "../../../../components/salons/RegisterSalonForm";
import { useAuth } from "../../../../lib/auth-context";
import styles from "./register-shop.module.css";

// Deliberately OUTSIDE dashboard/salons/layout.tsx's STAFF/OWNER-only RequireRole: registration
// is how a plain CUSTOMER becomes a SALON_OWNER in the first place, so it needs a looser gate (any
// authenticated user, no `roles` restriction) than the rest of the salon dashboard.
export default function RegisterShopPage() {
  const { user } = useAuth();
  const [passwordCompleted, setPasswordCompleted] = useState(false);
  const needsPassword = Boolean(
    user?.email && !user.passwordConfigured && !passwordCompleted,
  );

  return (
    <RequireRole redirectTo="/login">
      <main className={styles.page}>
        <div className={styles.hero}>
          <p className={styles.eyebrow}>FastQue owner onboarding</p>
          <h1 className={styles.title}>
            Build your shop,<br />on your terms.
          </h1>
        {/* Phase 11 replaced admin moderation with owner self-activation, so this no longer says
            "pending review" — nobody reviews it, and implying otherwise leaves owners waiting for
            an approval that will never arrive. */}
        <p className={styles.intro}>
          You&apos;ll get a unique shop ID and a dashboard to manage bookings and your live queue.
          Your shop starts closed. Add your services, chairs and barbers, then open it yourself
          from your dashboard — there&apos;s no waiting for approval.
        </p>
        </div>
        <section className={styles.formCard} aria-label="Register your shop">
          <div className={styles.formCardHeader}>
            <span className={styles.stepBadge}>Step 1</span>
            <div>
              <h2>Register your shop</h2>
              <p>Start with the details customers will use to find you.</p>
            </div>
          </div>
          {needsPassword ? (
            <div className={styles.securityCard}>
              <InitialPasswordSetup onComplete={() => setPasswordCompleted(true)} />
            </div>
          ) : (
            <RegisterSalonForm />
          )}
        </section>
      </main>
    </RequireRole>
  );
}
