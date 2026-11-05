"use client";

import { useCallback, useEffect, useState } from "react";
import { ADMIN_PATHS, Role, type AdminLiveQueueDto } from "@barbercue/shared";
import { useAuth } from "../../../../../lib/auth-context";
import { apiFetch, ApiError } from "../../../../../lib/api";
import { Button, LinkButton } from "../../../../../components/ui/Button";
import {
  waitedMinutes,
  waitText,
} from "../../../../../components/admin/live-queue-format";
import styles from "../admin.module.css";

const POLL_MS = 15_000;

/**
 * Live Queue Monitoring (admin OPERATIONS): every shop with customers in the queue right now, split
 * into waiting / called / in service, longest wait first. Counts only - no customer is ever shown.
 * Refreshes every 15 seconds while the page is visible.
 */
export default function AdminLiveQueuePage() {
  const { user } = useAuth();
  const canManage =
    !!user &&
    (user.roles.includes(Role.PLATFORM_ADMIN) ||
      user.roles.includes(Role.CO_FOUNDER));
  const [data, setData] = useState<AdminLiveQueueDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setData(
        await apiFetch<AdminLiveQueueDto>(
          `${ADMIN_PATHS.admin}/${ADMIN_PATHS.liveQueue}`,
        ),
      );
      setError(null);
      setNow(Date.now());
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not load the live queue.",
      );
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Operations · counts only</p>
          <h1>Live queue monitoring</h1>
          <p>
            Shops with customers in the queue right now, longest wait first.
            Updates every 15 seconds.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
      </header>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className={styles.loading} role="status">
          Loading the live queue…
        </p>
      )}

      {data && (
        <>
          <section className={styles.metrics} aria-label="Live queue totals">
            {Object.entries({
              "Shops with a queue": data.totals.shops,
              Waiting: data.totals.waiting,
              Called: data.totals.called,
              "In service": data.totals.inService,
            }).map(([label, value]) => (
              <article key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </article>
            ))}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>Shops</h2>
              <span>{data.shops.length} shown</span>
            </div>
            {data.shops.length === 0 ? (
              <p className={styles.empty}>
                No customer is in any queue right now.
              </p>
            ) : (
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Shop</th>
                      <th>Waiting</th>
                      <th>Called</th>
                      <th>In service</th>
                      <th>Active chairs</th>
                      <th>Longest wait</th>
                      {canManage && <th>Open</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.shops.map((s) => {
                      const minutes = waitedMinutes(s.oldestWaitingSince, now);
                      return (
                        <tr key={s.id}>
                          <td>
                            <strong>{s.name}</strong>
                            <small>
                              {s.publicId}
                              {s.city ? ` · ${s.city}` : ""}
                            </small>
                          </td>
                          <td>{s.waiting}</td>
                          <td>{s.called}</td>
                          <td>{s.inService}</td>
                          <td>{s.activeChairs}</td>
                          <td>
                            <span
                              className={
                                minutes !== null && minutes >= 30
                                  ? styles.status
                                  : undefined
                              }
                            >
                              {waitText(minutes)}
                            </span>
                          </td>
                          {canManage && (
                            <td>
                              <LinkButton
                                href={`/dashboard/salons/${s.id}/queue`}
                                variant="secondary"
                              >
                                Live Queue
                              </LinkButton>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className={styles.generated}>
            Snapshot {new Date(data.generatedAt).toLocaleTimeString("en-IN")}.
          </p>
        </>
      )}
    </main>
  );
}
