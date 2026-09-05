"use client";

import { use } from "react";
import { Role } from "@barbercue/shared";
import { RequireRole } from "../../../../../../components/auth/RequireRole";
import { SetupNavigation } from "../../../../../../components/dashboard/SetupNavigation";
import { PaymentQrSection } from "../../../../../../components/dashboard/PaymentQrSection";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

/**
 * Setup-wizard step for Payment QR (Part 1, shop-onboarding mission) — same PaymentQrSection
 * component the settings page renders, reused here rather than duplicated, so there is exactly one
 * place that talks to SalonPaymentQrService.
 *
 * Deliberately not a blocking step: BookingsService.create only refuses ONLINE (APP/WEB) bookings
 * without a QR — WALK_IN is never gated, and this page's own "Next →" (from SetupNavigation, no
 * override) always continues to the live-queue step whether or not a QR was added here. Leaving
 * this page without finishing does not delete the shop or lock anything — Payment QR stays visible
 * and editable on the settings page (and flagged there by the setup checklist) for as long as it
 * remains unset.
 */
export default function DashboardPaymentQrPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = use(params);

  return (
    <RequireRole roles={[Role.SALON_OWNER, Role.PLATFORM_ADMIN]} redirectTo="/dashboard/salons">
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Payment QR</h1>
      <p className={styles.pageSubtitle}>
        Required for online bookings — a customer paying through the app or website scans this to
        pay you directly. Walk-ins never need it, and you can always add or change it later from
        Settings.
      </p>
      <SetupNavigation salonId={salonId} currentStep="payment-qr" section="steps" />

      <PaymentQrSection salonId={salonId} />

      <SetupNavigation salonId={salonId} currentStep="payment-qr" section="actions" />
    </main>
    </RequireRole>
  );
}
