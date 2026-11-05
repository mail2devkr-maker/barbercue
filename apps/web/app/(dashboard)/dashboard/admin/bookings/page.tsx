"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ADMIN_PATHS,
  BookingStatus,
  Role,
  type AdminBookingRowDto,
  type AdminBookingsPageDto,
} from "@barbercue/shared";
import { useAuth } from "../../../../../lib/auth-context";
import { apiFetch, ApiError } from "../../../../../lib/api";
import { Button, LinkButton } from "../../../../../components/ui/Button";
import {
  adminBookingsQuery,
  istDateTime,
  type AdminBookingsFilters,
} from "../../../../../components/admin/all-bookings-query";
import styles from "../admin.module.css";

const EMPTY: AdminBookingsFilters = { shop: "", status: "", from: "", to: "" };

/**
 * All Bookings (admin BOOKINGS): every shop's bookings, newest appointment first, 50 at a time.
 * Privacy-safe: no customer or guest details are ever sent; a shop's own Bookings page has them.
 */
export default function AdminAllBookingsPage() {
  const { user } = useAuth();
  const canManage =
    !!user &&
    (user.roles.includes(Role.PLATFORM_ADMIN) ||
      user.roles.includes(Role.CO_FOUNDER));
  const [draft, setDraft] = useState<AdminBookingsFilters>(EMPTY);
  const [filters, setFilters] = useState<AdminBookingsFilters>(EMPTY);
  const [rows, setRows] = useState<AdminBookingRowDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (f: AdminBookingsFilters, cursor?: string) => {
    setLoading(true);
    try {
      const page = await apiFetch<AdminBookingsPageDto>(
        `${ADMIN_PATHS.admin}/${ADMIN_PATHS.allBookings}${adminBookingsQuery(f, cursor)}`,
      );
      setRows((cur) => (cursor && cur ? [...cur, ...page.items] : page.items));
      setNext(page.nextCursor);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load bookings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(filters), 0);
    return () => window.clearTimeout(t);
  }, [filters, load]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Bookings · all shops</p>
          <h1>All bookings</h1>
          <p>
            Every shop&apos;s bookings, newest appointment first. Customer
            details stay on each shop&apos;s own Bookings page.
          </p>
        </div>
      </header>

      <form
        className={styles.filters}
        aria-label="Booking filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...draft });
        }}
      >
        <div>
          <label htmlFor="ab-shop">Shop name or BC-SHOP id</label>
          <input
            id="ab-shop"
            type="search"
            value={draft.shop}
            onChange={(e) => setDraft({ ...draft, shop: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="ab-status">Status</label>
          <select
            id="ab-status"
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            <option value="">All statuses</option>
            {Object.values(BookingStatus).map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ab-from">Appointment from</label>
          <input
            id="ab-from"
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="ab-to">to</label>
          <input
            id="ab-to"
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <Button type="submit" variant="primary">
            Apply
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft(EMPTY);
              setFilters(EMPTY);
            }}
          >
            Clear
          </Button>
        </div>
      </form>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!rows && !error && (
        <p className={styles.loading} role="status">
          Loading bookings…
        </p>
      )}

      {rows && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Bookings</h2>
            <span>{rows.length} shown</span>
          </div>
          {rows.length === 0 ? (
            <p className={styles.empty}>No bookings match these filters.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Appointment (IST)</th>
                    <th>Shop</th>
                    <th>Service</th>
                    <th>Status</th>
                    <th>Source</th>
                    {canManage && <th>Open</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id}>
                      <td>{istDateTime(b.slotStart)}</td>
                      <td>
                        <strong>{b.shop.name}</strong>
                        <small>{b.shop.publicId}</small>
                      </td>
                      <td>
                        {b.serviceName}
                        {b.offerTitle ? (
                          <small>Offer: {b.offerTitle}</small>
                        ) : null}
                      </td>
                      <td>
                        <span className={styles.status}>{b.status}</span>
                        {b.cancelledBy ? (
                          <small>by {b.cancelledBy.toLowerCase()}</small>
                        ) : null}
                      </td>
                      <td>
                        {b.source}
                        {b.guest ? <small>guest (no account)</small> : null}
                      </td>
                      {canManage && (
                        <td>
                          <LinkButton
                            href={`/dashboard/salons/${b.shop.id}/bookings`}
                            variant="secondary"
                          >
                            Shop bookings
                          </LinkButton>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {next && (
            <p style={{ marginTop: 12 }}>
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => void load(filters, next)}
              >
                {loading ? "Loading…" : "Load more"}
              </Button>
            </p>
          )}
        </section>
      )}
    </main>
  );
}
