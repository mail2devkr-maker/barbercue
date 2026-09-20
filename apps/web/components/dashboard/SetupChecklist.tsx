"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChairStatus, DASHBOARD_PATHS, SalonStatus, StaffMemberStatus } from "@barbercue/shared";
import type {
  OperatingHoursDto,
  SalonChairDto,
  SalonPaymentQrDto,
  SalonServiceDto,
  SalonSetupReadinessDto,
  SalonStaffDto,
} from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import styles from "./dashboard.module.css";

interface ChecklistStep {
  label: string;
  done: boolean;
  href: string | null;
  /** Shown under an incomplete step to explain why it matters, in the owner's terms. */
  why: string;
}

/**
 * First-run setup progress for one shop, shown on the settings page — which is exactly where
 * RegisterSalonForm drops a brand-new owner after registration, so it is the first thing they see.
 *
 * Counts come from the owner setup endpoints this user already has access to; there is no
 * dedicated "setup progress" endpoint and adding one would mean a backend route whose only job is
 * to re-count rows the setup pages already count. Parallel GETs for one salon on one page are a
 * fair trade for not inventing an endpoint (and not an N+1 — this renders for a single salon).
 *
 * The core checklist mirrors the backend's real activation gate
 * (SalonActivationService.assertReadyToOpen), which refuses to move a PENDING salon to ACTIVE
 * without an active service, chair and staff member. Opening hours and payment QR are intentionally
 * shown separately as optional online-booking setup because neither is required to open the shop.
 */
export function SetupChecklist({
  salonId,
  status,
  onReadyChange,
}: {
  salonId: string;
  status: SalonStatus;
  /**
   * Reports which of the three opening requirements are met. The settings page uses it to show,
   * item by item, what still blocks opening — this component already does the counts, so
   * re-fetching them a level up would be pure duplication. It mirrors the same shape the backend
   * returns in a SALON_SETUP_INCOMPLETE error, so the page renders one component either way.
   */
  onReadyChange?: (readiness: SalonSetupReadinessDto) => void;
}) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const [services, setServices] = useState<SalonServiceDto[] | null>(null);
  const [chairs, setChairs] = useState<SalonChairDto[] | null>(null);
  const [staff, setStaff] = useState<SalonStaffDto[] | null>(null);
  const [hours, setHours] = useState<OperatingHoursDto[] | null>(null);
  const [paymentQr, setPaymentQr] = useState<SalonPaymentQrDto | null>(null);
  // A failed count must not render as "not done" — that would nag an owner who has already
  // finished the step. On error the whole checklist hides instead.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<SalonServiceDto[]>(`${base}/${DASHBOARD_PATHS.services}`),
      apiFetch<SalonChairDto[]>(`${base}/${DASHBOARD_PATHS.chairs}`),
      apiFetch<SalonStaffDto[]>(`${base}/${DASHBOARD_PATHS.staff}`),
      apiFetch<OperatingHoursDto[]>(`${base}/${DASHBOARD_PATHS.operatingHours}`),
      apiFetch<SalonPaymentQrDto>(`${base}/${DASHBOARD_PATHS.paymentQr}`),
    ])
      .then(([s, c, st, h, qr]) => {
        if (cancelled) return;
        setServices(s);
        setChairs(c);
        setStaff(st);
        setHours(h);
        setPaymentQr(qr);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  const loading = services === null || chairs === null || staff === null || hours === null || paymentQr === null;

  // `isActive`, not merely present: this must agree exactly with the backend's activation gate,
  // which counts only active services. A checklist that ticks a step the server then rejects is
  // worse than no checklist.
  const hasService = (services ?? []).some((s) => s.isActive);
  const hasChair = (chairs ?? []).some((c) => c.status === ChairStatus.ACTIVE);
  const hasBarber = (staff ?? []).some((s) => s.status === StaffMemberStatus.ACTIVE);
  // Advisory only — deliberately NOT part of `readyToOpen` or the backend activation gate. A shop
  // with no open days is still a perfectly valid walk-in/queue-only shop; it simply cannot take
  // online bookings, which the step text says plainly.
  const hasOpenDay = (hours ?? []).some((h) => !h.isClosed);
  // Also advisory only, same reasoning as hasOpenDay — mirrors BookingsService.create's real gate
  // (PAYMENT_QR_REQUIRED for APP/WEB bookings; WALK_IN is never blocked), so a walk-in-only shop
  // can open with no QR configured at all.
  const hasPaymentQr = Boolean(paymentQr?.paymentQrImageUrl);
  // Opening is the last core step by design: a shop that becomes publicly discoverable with no
  // services, no chairs or no barbers is a dead end for the customer who finds it — they can
  // reach the page but there is nothing to book and nobody to seat them.
  const readyToOpen = hasService && hasChair && hasBarber;

  useEffect(() => {
    // Only meaningful once all three lists have actually loaded — before that every flag is
    // false purely because the lists are null, which is "unknown", not "not ready".
    if (!loading) {
      onReadyChange?.({
        hasActiveService: hasService,
        hasActiveChair: hasChair,
        hasActiveStaff: hasBarber,
      });
    }
  }, [loading, hasService, hasChair, hasBarber, onReadyChange]);

  if (failed) return null;

  const coreSteps: ChecklistStep[] = [
    { label: "Register your shop", done: true, href: null, why: "" },
    {
      label: "Add your services",
      done: hasService,
      href: `/dashboard/salons/${salonId}/services`,
      why: "Customers pick a service when they book or join the queue — without one there's nothing to choose.",
    },
    {
      label: "Add your chairs",
      done: hasChair,
      href: `/dashboard/salons/${salonId}/chairs`,
      why: "Chairs set how many customers you can serve at once. With none, nobody can be seated.",
    },
    {
      label: "Add your staff",
      done: hasBarber,
      href: `/dashboard/salons/${salonId}/staff`,
      why: "Your staff help run the live queue and can use their own login when contact details are configured.",
    },
    {
      label: "Open your shop",
      done: status === SalonStatus.ACTIVE,
      href: null,
      why: readyToOpen
        ? "Everything's ready — open your shop below to let customers find you."
        : "Finish the required steps above first, then open your shop below. Opening it now would show customers a shop that can't take them yet.",
    },
  ];

  const onlineBookingSteps: ChecklistStep[] = [
    {
      label: "Set your opening hours (Optional — required only for online bookings)",
      done: hasOpenDay,
      href: `/dashboard/salons/${salonId}/hours`,
      why: "Customers can only book appointments during your opening hours. You can skip this if you want to use FastQue only for walk-ins and the live queue.",
    },
    {
      label: "Add a payment QR (Optional — required only for online bookings)",
      done: hasPaymentQr,
      href: `/dashboard/salons/${salonId}/payment-qr`,
      why: "Shown to a customer paying for an app/website booking so they can scan and pay you directly. You can skip this for walk-ins; no payment is made to FastQue by uploading the QR.",
    },
  ];

  const coreDoneCount = coreSteps.filter((s) => s.done).length;
  const allCoreDone = coreDoneCount === coreSteps.length;

  function renderSteps(steps: ChecklistStep[]) {
    return (
      <ul className={styles.checklist}>
        {steps.map((step) => (
          <li key={step.label} className={styles.checklistItem}>
            <span aria-hidden="true" style={{ lineHeight: 1.4 }}>{step.done ? "✅" : "⬜"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className={`${styles.checklistLabel} ${step.done ? styles.checklistLabelDone : styles.checklistLabelPending}`}>
                {step.label}
                <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                  {step.done ? " — done" : " — not done yet"}
                </span>
              </span>
              {!step.done && !loading && (
                <div className={styles.checklistWhy}>
                  {step.why}
                  {step.href && (
                    <>
                      {" "}
                      <Link href={step.href}>Do it now →</Link>
                    </>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className={styles.dividerSection}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 className={styles.sectionHeading} style={{ margin: 0 }}>Shop setup</h2>
        <span className={styles.hint} style={{ marginTop: 0 }}>
          {loading ? "Checking…" : `${coreDoneCount} of ${coreSteps.length} required steps done`}
        </span>
      </div>

      {allCoreDone && !loading && (
        <p style={{ color: "var(--bc-success)", fontSize: 14, marginBottom: 0, marginTop: 10 }}>
          🎉 Your core shop setup is complete. Optional online-booking features can be added anytime.
        </p>
      )}

      {renderSteps(coreSteps)}

      <div style={{ marginTop: 28, paddingTop: 22, borderTop: "1px solid var(--bc-border)" }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Optional online-booking setup</h3>
        <p className={styles.hint} style={{ marginTop: 6, marginBottom: 0 }}>
          These steps are not required to register or open your shop. Add them only if you want customers to book and pay through the app or website.
        </p>
        {renderSteps(onlineBookingSteps)}
      </div>
    </section>
  );
}
