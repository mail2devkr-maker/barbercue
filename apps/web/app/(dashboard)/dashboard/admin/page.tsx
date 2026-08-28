"use client";

import { useEffect, useMemo, useState } from "react";
import { ADMIN_PATHS, SalonStatus, type PlatformAdminOverviewDto } from "@barbercue/shared";
import { useAuth } from "../../../../lib/auth-context";
import { apiFetch, ApiError } from "../../../../lib/api";
import { Button } from "../../../../components/ui/Button";
import styles from "./admin.module.css";

function contact(email: string | null, phone: string | null): string {
  return email ?? phone ?? "Not recorded";
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function AdminDashboardPage() {
  const { user, logout } = useAuth();
  const [data, setData] = useState<PlatformAdminOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [shopStatus, setShopStatus] = useState<"ALL" | SalonStatus>("ALL");

  useEffect(() => {
    let cancelled = false;
    apiFetch<PlatformAdminOverviewDto>(`${ADMIN_PATHS.admin}/${ADMIN_PATHS.overview}`)
      .then((overview) => {
        if (!cancelled) setData(overview);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : "Could not load platform monitoring.");
      });
    return () => { cancelled = true; };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const shops = useMemo(() => (data?.shops ?? []).filter((shop) =>
    (shopStatus === "ALL" || shop.status === shopStatus) &&
    (!normalizedQuery || `${shop.name} ${shop.publicId} ${shop.ownerEmail ?? ""} ${shop.ownerPhone ?? ""}`.toLowerCase().includes(normalizedQuery)),
  ), [data, normalizedQuery, shopStatus]);
  const staff = useMemo(() => (data?.staff ?? []).filter((member) =>
    !normalizedQuery || `${member.displayName} ${member.salonName} ${member.salonPublicId} ${member.email ?? ""} ${member.phone ?? ""}`.toLowerCase().includes(normalizedQuery),
  ), [data, normalizedQuery]);
  const customers = useMemo(() => (data?.customers ?? []).filter((customer) =>
    !normalizedQuery || `${customer.email ?? ""} ${customer.phone ?? ""} ${customer.id}`.toLowerCase().includes(normalizedQuery),
  ), [data, normalizedQuery]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Role-protected operations</p>
          <h1>Platform monitoring</h1>
          <p>Read-only visibility across BarberCue. Signed in as {user?.email ?? "platform admin"}.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void logout()}>Log out</Button>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {!data && !error && <p className={styles.loading} role="status">Loading platform activity…</p>}

      {data && (
        <>
          <section className={styles.metrics} aria-label="Platform totals">
            {Object.entries({
              Shops: data.counts.shops,
              Owners: data.counts.owners,
              Staff: data.counts.staff,
              Customers: data.counts.customers,
              Bookings: data.counts.bookings,
              "Live queue": data.counts.liveQueueEntries,
              "Active Premium": data.counts.activePremiumSubscriptions,
            }).map(([label, value]) => (
              <article key={label}><strong>{value}</strong><span>{label}</span></article>
            ))}
          </section>

          <section className={styles.filters} aria-label="Monitoring filters">
            <div>
              <label htmlFor="admin-search">Search shops, IDs, people or contact</label>
              <input id="admin-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Shop ID, salon, email, phone…" />
            </div>
            <div>
              <label htmlFor="admin-shop-status">Shop status</label>
              <select id="admin-shop-status" value={shopStatus} onChange={(event) => setShopStatus(event.target.value as "ALL" | SalonStatus)}>
                <option value="ALL">All statuses</option>
                <option value={SalonStatus.PENDING}>Pending</option>
                <option value={SalonStatus.ACTIVE}>Active</option>
                <option value={SalonStatus.SUSPENDED}>Suspended</option>
              </select>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><h2>Shops</h2><span>{shops.length} shown · latest 100</span></div>
            <div className={styles.tableWrap}>
              <table><thead><tr><th>Shop</th><th>Status</th><th>Owner</th><th>Operations</th><th>Plan</th></tr></thead>
                <tbody>{shops.map((shop) => <tr key={shop.id}>
                  <td><strong>{shop.name}</strong><small>{shop.publicId}</small></td>
                  <td><span className={styles.status}>{shop.status}</span></td>
                  <td>{contact(shop.ownerEmail, shop.ownerPhone)}</td>
                  <td>{shop.staffCount} staff · {shop.bookingCount} bookings · {shop.liveQueueCount} live</td>
                  <td>{shop.subscriptionStatus}</td>
                </tr>)}</tbody>
              </table>
            </div>
            {shops.length === 0 && <p className={styles.empty}>No shops match these filters.</p>}
          </section>

          <div className={styles.twoColumn}>
            <section className={styles.section}>
              <div className={styles.sectionHeader}><h2>Staff</h2><span>{staff.length} shown</span></div>
              <ul className={styles.peopleList}>{staff.map((member) => <li key={member.id}>
                <div><strong>{member.displayName}</strong><small>{member.salonName} · {member.salonPublicId}</small></div>
                <div><span className={styles.status}>{member.status}</span><small>{contact(member.email, member.phone)}</small></div>
              </li>)}</ul>
              {staff.length === 0 && <p className={styles.empty}>No staff match this search.</p>}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}><h2>Customers</h2><span>{customers.length} shown</span></div>
              <ul className={styles.peopleList}>{customers.map((customer) => <li key={customer.id}>
                <div><strong>{contact(customer.email, customer.phone)}</strong><small>{customer.bookingCount} bookings · {customer.queueEntryCount} queue visits</small></div>
                <div><span className={styles.status}>{customer.status}</span><small>{customer.isPremium ? "Premium" : "Standard"}</small></div>
              </li>)}</ul>
              {customers.length === 0 && <p className={styles.empty}>No customers match this search.</p>}
            </section>
          </div>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><h2>Recent bookings</h2><span>Latest 50</span></div>
            <div className={styles.activityGrid}>{data.recentBookings.map((booking) => <article key={booking.id}>
              <strong>{booking.salonName} · {booking.serviceName}</strong>
              <span>{booking.status} · {dateTime(booking.slotStart)}</span>
              <small>{contact(booking.customerEmail, booking.customerPhone)}</small>
            </article>)}</div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><h2>Live & recent queue activity</h2><span>Latest 50</span></div>
            <div className={styles.activityGrid}>{data.recentQueue.map((entry) => <article key={entry.id}>
              <strong>{entry.salonName} · Token #{entry.tokenNumber}</strong>
              <span>{entry.status} · {dateTime(entry.joinedAt)}{entry.serviceName ? ` · ${entry.serviceName}` : ""}</span>
              <small>{entry.assignedStaffName ?? "Unassigned"}{entry.assignedChairLabel ? ` · ${entry.assignedChairLabel}` : ""}</small>
            </article>)}</div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><h2>Customer Premium</h2><span>Latest 50 subscriptions</span></div>
            <div className={styles.activityGrid}>{data.premiumSubscriptions.map((subscription) => <article key={subscription.id}>
              <strong>{subscription.planName} · {subscription.status}</strong>
              <span>Period ends {dateTime(subscription.periodEnd)}</span>
              <small>{contact(subscription.customerEmail, subscription.customerPhone)}</small>
            </article>)}</div>
            {data.premiumSubscriptions.length === 0 && <p className={styles.empty}>No Premium subscriptions recorded.</p>}
          </section>

          <p className={styles.generated}>Snapshot generated {dateTime(data.generatedAt)}. Refresh the page for a new read-only snapshot.</p>
        </>
      )}
    </main>
  );
}
