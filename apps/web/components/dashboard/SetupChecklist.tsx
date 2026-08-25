"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChairStatus, DASHBOARD_PATHS, SalonStatus, StaffMemberStatus } from "@barbercue/shared";
import type {
  SalonChairDto,
  SalonServiceDto,
  SalonSetupReadinessDto,
  SalonStaffDto,
} from "@barbercue/shared";
import { apiFetch } from "../../lib/api";

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
 * Counts come from the three Phase 11 list endpoints the owner already has access to; there is no
 * dedicated "setup progress" endpoint and adding one would mean a backend route whose only job is
 * to re-count rows three pages away can already count. Three GETs for one salon on one page is a
 * fair trade for not inventing an endpoint (and not an N+1 — this renders for a single salon).
 *
 * Steps 2-4 mirror the backend's real activation gate (SalonActivationService.assertReadyToOpen),
 * which refuses to move a PENDING salon to ACTIVE without an active service, chair and staff
 * member. This is the friendly, ahead-of-time version of that rule — the server is the authority,
 * so the two count the same things in the same way and the owner is never ticked off for a step
 * the server will then reject.
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
  // A failed count must not render as "not done" — that would nag an owner who has already
  // finished the step. On error the whole checklist hides instead.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<SalonServiceDto[]>(`${base}/${DASHBOARD_PATHS.services}`),
      apiFetch<SalonChairDto[]>(`${base}/${DASHBOARD_PATHS.chairs}`),
      apiFetch<SalonStaffDto[]>(`${base}/${DASHBOARD_PATHS.staff}`),
    ])
      .then(([s, c, st]) => {
        if (cancelled) return;
        setServices(s);
        setChairs(c);
        setStaff(st);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  const loading = services === null || chairs === null || staff === null;

  // `isActive`, not merely present: this must agree exactly with the backend's activation gate,
  // which counts only active services. A checklist that ticks a step the server then rejects is
  // worse than no checklist.
  const hasService = (services ?? []).some((s) => s.isActive);
  const hasChair = (chairs ?? []).some((c) => c.status === ChairStatus.ACTIVE);
  const hasBarber = (staff ?? []).some((s) => s.status === StaffMemberStatus.ACTIVE);
  // Opening is the last step by design: a shop that becomes publicly discoverable with no
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

  const steps: ChecklistStep[] = [
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
      label: "Add your barbers",
      done: hasBarber,
      href: `/dashboard/salons/${salonId}/staff`,
      why: "Your barbers run the live queue from their own login.",
    },
    {
      label: "Open your shop",
      done: status === SalonStatus.ACTIVE,
      href: null,
      why: readyToOpen
        ? "Everything's ready — open your shop below to let customers find you."
        : "Finish the steps above first, then open your shop below. Opening it now would show customers a shop that can't take them yet.",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  return (
    <section style={{ marginTop: 8, paddingTop: 20, borderTop: "1px solid #E7E0D3" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Shop setup</h2>
        <span style={{ fontSize: 13, color: "#6B6357" }}>
          {loading ? "Checking…" : `${doneCount} of ${steps.length} done`}
        </span>
      </div>

      {allDone && !loading && (
        <p style={{ color: "#2E7D32", fontSize: 14, marginBottom: 0 }}>
          🎉 You&apos;re all set — your shop is open and ready for customers.
        </p>
      )}

      <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "flex", flexDirection: "column", gap: 10 }}>
        {steps.map((step) => (
          <li key={step.label} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span aria-hidden="true" style={{ lineHeight: 1.4 }}>{step.done ? "✅" : "⬜"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 15, color: step.done ? "#6B6357" : "#1C1A17", fontWeight: step.done ? 400 : 600 }}>
                {step.label}
                <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                  {step.done ? " — done" : " — not done yet"}
                </span>
              </span>
              {!step.done && !loading && (
                <div style={{ fontSize: 13, color: "#6B6357", marginTop: 2 }}>
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
    </section>
  );
}
