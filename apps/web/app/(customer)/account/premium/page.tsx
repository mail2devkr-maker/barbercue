"use client";

import { useEffect, useState } from "react";
import { PREMIUM_PATHS } from "@barbercue/shared";
import type { AiCreditBalanceDto, CustomerPremiumPlanDto, PremiumEntitlementDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../lib/api";
import { Card } from "../../../../components/ui/Card";
import { LinkButton } from "../../../../components/ui/Button";
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
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>BARBERCUE PREMIUM</p>
          <h1 className={styles.pageTitle}>Plan the look before the chair.</h1>
          <p className={styles.pageSubtitle}>
            Premium plans include AI Style Advisor credits. Preview generation remains subject to the current image-service availability.
          </p>
        </div>
        <LinkButton href="/style-advisor" variant="outline" className={styles.styleLink}>
          Open Style Advisor
        </LinkButton>
      </header>

      {entitlement?.isPremium && (
        <Card raised className={styles.statusCard}>
          <div>
            <p className={styles.statusEyebrow}>CURRENT PLAN</p>
            <p className={styles.statusPlan}>{entitlement.planName}</p>
            {entitlement.periodEnd && (
              <p className={styles.statusMeta}>Renews {new Date(entitlement.periodEnd).toLocaleDateString()}</p>
            )}
          </div>
          {credits && (
            <div className={styles.creditBalance}>
              <strong>{credits.available}</strong>
              <span>of {credits.allocated} AI credits remaining</span>
            </div>
          )}
        </Card>
      )}

      <div className={styles.sectionHeader}>
        <h2>Choose what fits</h2>
        <p>Plan availability and prices below come directly from BarberCue.</p>
      </div>

      {loading && (
        <div className={styles.loadingGrid} role="status" aria-label="Loading Premium plans">
          <div className={styles.loadingCard}><span /><span /><span /></div>
          <div className={styles.loadingCard}><span /><span /><span /></div>
        </div>
      )}
      {error && <p className={styles.errorText} role="alert">{error} Refresh the page to try again.</p>}

      {!loading && !error && (
        <div className={styles.planGrid}>
          {plans.map((plan) => (
            <Card key={plan.id} raised={plan.isPopular} className={styles.planCard}>
              {plan.isPopular && <span className={styles.popularBadge}>MOST POPULAR</span>}
              <h3 className={styles.planName}>{plan.name}</h3>
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
          {plans.length === 0 && (
            <Card className={styles.emptyCard}>
              <h3>No Premium plans are available right now.</h3>
              <p>Please check again later. Your current BarberCue account remains unchanged.</p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
