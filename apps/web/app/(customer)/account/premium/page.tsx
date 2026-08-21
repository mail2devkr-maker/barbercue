"use client";

import { useEffect, useState } from "react";
import { PREMIUM_PATHS } from "@barbercue/shared";
import type { AiCreditBalanceDto, CustomerPremiumPlanDto, PremiumEntitlementDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../lib/api";
import { Card } from "../../../../components/ui/Card";
import styles from "./premium.module.css";

// New page — Premium subscription plans + current entitlement/credit status. No real payment
// provider exists yet (see ARCHITECTURE.md), so the "purchase" action is honestly represented as
// coming soon rather than a button that pretends to charge the customer or silently grants
// Premium on click. Plan data comes entirely from GET premium/plans (single authoritative source
// — CustomerPremiumPlan table), never hard-coded here.
export default function PremiumPlansPage() {
  const [plans, setPlans] = useState<CustomerPremiumPlanDto[]>([]);
  const [entitlement, setEntitlement] = useState<PremiumEntitlementDto | null>(null);
  const [credits, setCredits] = useState<AiCreditBalanceDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<CustomerPremiumPlanDto[]>(`${PREMIUM_PATHS.premium}/${PREMIUM_PATHS.plans}`),
      apiFetch<PremiumEntitlementDto>(`${PREMIUM_PATHS.premium}/${PREMIUM_PATHS.me}`),
      apiFetch<AiCreditBalanceDto>(`${PREMIUM_PATHS.premium}/${PREMIUM_PATHS.credits}`),
    ])
      .then(([plansResult, entitlementResult, creditsResult]) => {
        if (cancelled) return;
        setPlans(plansResult);
        setEntitlement(entitlementResult);
        setCredits(creditsResult);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load Premium plans.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Premium</h1>
      <p className={styles.pageSubtitle}>
        Get AI Style Advisor credits and preview new hairstyles on your own photo before you book.
      </p>

      {entitlement?.isPremium && (
        <Card raised className={styles.statusCard}>
          <p className={styles.statusPlan}>
            You&apos;re on the <strong>{entitlement.planName}</strong> plan.
          </p>
          {entitlement.periodEnd && (
            <p className={styles.statusMeta}>
              Renews {new Date(entitlement.periodEnd).toLocaleDateString()}
            </p>
          )}
          {credits && (
            <p className={styles.statusMeta}>
              AI Style Credits remaining: <strong>{credits.available}</strong> of {credits.allocated}
            </p>
          )}
        </Card>
      )}

      {loading && <p className={styles.noteText}>Loading plans…</p>}
      {error && <p className={styles.errorText}>{error}</p>}

      {!loading && !error && (
        <div className={styles.planGrid}>
          {plans.map((plan) => (
            <Card key={plan.id} raised={plan.isPopular} className={styles.planCard}>
              {plan.isPopular && <span className={styles.popularBadge}>MOST POPULAR</span>}
              <p className={styles.planName}>{plan.name}</p>
              <p className={styles.planPrice}>
                ₹{plan.priceInr}
                <span className={styles.planPeriod}>/year</span>
              </p>
              <ul className={styles.planFeatures}>
                <li>{plan.aiCreditsPerYear} AI Style Credits/year</li>
                <li>AI Style Advisor</li>
                <li>Standard BarberCue features</li>
              </ul>
              <div className={styles.planAction}>
                {entitlement?.planId === plan.id ? (
                  <span className={styles.currentPlanNote}>Your current plan</span>
                ) : (
                  <span className={styles.comingSoonNote}>Online payment is coming soon</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
