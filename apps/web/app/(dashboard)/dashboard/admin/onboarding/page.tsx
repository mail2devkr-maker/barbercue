"use client";

import { useCallback, useEffect, useState } from "react";
import { ADMIN_PATHS, Role, type AdminOnboardingDto } from "@barbercue/shared";
import { useAuth } from "../../../../../lib/auth-context";
import { apiFetch, ApiError } from "../../../../../lib/api";
import { Button, LinkButton } from "../../../../../components/ui/Button";
import {
  ONBOARDING_STEPS,
  stageLabel,
  conversion,
} from "../../../../../components/admin/onboarding-format";
import styles from "../admin.module.css";

const WINDOWS = [30, 90, 365] as const;

/**
 * New Shop Onboarding (admin SHOPS): shops registered in the chosen window and how far each got -
 * verified, configured, live, first customer. Shop names and setup counts only.
 */
export default function AdminOnboardingPage() {
  const { user } = useAuth();
  const canManage =
    !!user &&
    (user.roles.includes(Role.PLATFORM_ADMIN) ||
      user.roles.includes(Role.CO_FOUNDER));
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(90);
  const [data, setData] = useState<AdminOnboardingDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    try {
      setData(
        await apiFetch<AdminOnboardingDto>(
          `${ADMIN_PATHS.admin}/${ADMIN_PATHS.onboarding}?days=${d}`,
        ),
      );
      setError(null);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not load onboarding.",
      );
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(days), 0);
    return () => window.clearTimeout(t);
  }, [days, load]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Shops · onboarding</p>
          <h1>New shop onboarding</h1>
          <p>
            Shops registered in the last {days} days and how far each got:
            verified, set up, open, first customer.
          </p>
        </div>
        <div
          style={{ display: "flex", gap: 8 }}
          role="group"
          aria-label="Window"
        >
          {WINDOWS.map((d) => (
            <Button
              key={d}
              type="button"
              variant={d === days ? "primary" : "outline"}
              aria-pressed={d === days}
              onClick={() => setDays(d)}
            >
              {d} days
            </Button>
          ))}
        </div>
      </header>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className={styles.loading} role="status">
          Loading onboarding…
        </p>
      )}

      {data && (
        <>
          <section className={styles.metrics} aria-label="Onboarding funnel">
            {ONBOARDING_STEPS.map((stage, i) => (
              <article key={stage}>
                <strong>{data.funnel[stage]}</strong>
                <span>
                  {stageLabel(stage)}
                  {i > 0
                    ? ` · ${conversion(data.funnel[stage], data.funnel.REGISTERED)}`
                    : ""}
                </span>
              </article>
            ))}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>Shops</h2>
              <span>{data.shops.length} shown · newest first</span>
            </div>
            {data.shops.length === 0 ? (
              <p className={styles.empty}>No shop registered in this window.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Shop</th>
                      <th>Registered</th>
                      <th>Stage</th>
                      <th>Verification</th>
                      <th>Setup (services · chairs · staff)</th>
                      <th>First customer</th>
                      {canManage && <th>Open</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.shops.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.name}</strong>
                          <small>
                            {s.publicId}
                            {s.city ? ` · ${s.city}` : ""}
                          </small>
                        </td>
                        <td>
                          {new Date(s.registeredAt).toLocaleDateString(
                            "en-IN",
                            { timeZone: "Asia/Kolkata" },
                          )}
                          <small>{s.daysSinceRegistered} days ago</small>
                        </td>
                        <td>
                          <span className={styles.status}>
                            {stageLabel(s.stage)}
                          </span>
                        </td>
                        <td>
                          {s.verification === "NONE"
                            ? "Not submitted"
                            : s.verification.replace(/_/g, " ").toLowerCase()}
                        </td>
                        <td>
                          {s.services} · {s.chairs} · {s.staff}
                        </td>
                        <td>
                          {s.firstCustomerAt
                            ? new Date(s.firstCustomerAt).toLocaleDateString(
                                "en-IN",
                                { timeZone: "Asia/Kolkata" },
                              )
                            : "Not yet"}
                        </td>
                        {canManage && (
                          <td>
                            <LinkButton
                              href={`/dashboard/salons/${s.id}`}
                              variant="secondary"
                            >
                              Manage
                            </LinkButton>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
