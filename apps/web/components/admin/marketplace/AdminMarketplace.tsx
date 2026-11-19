"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Role,
  SHOP_ORDER_STATUS_LABEL,
  type AdminShopListingDto,
  type AdminShopStatsDto,
  type InventoryPageDto,
  type ShopAnalyticsDto,
  type ShopListingStatus,
  type ShopOrderDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import ui from "../../owner/owner.module.css";
import css from "../inventory/admin-inventory.module.css";

const inr = (v: string | number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(v))}`;
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message || fallback : fallback);

/**
 * Admin → Marketplace: statistics, listing approvals (only approved listings are sold),
 * all shop orders, and sales. Product master + uploads stay under Inventory.
 */
export function AdminMarketplace() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const canManage = !!user?.roles.some((r) => r === Role.PLATFORM_ADMIN || r === Role.CO_FOUNDER);
  const tab = (params.get("tab") ?? "overview") as "overview" | "listings" | "orders";
  const go = (t: string) => router.replace(`${pathname}${t === "overview" ? "" : `?tab=${t}`}`);
  return (
    <main className={ui.grid} aria-labelledby="mk-title">
      <div className={ui.pageHead}>
        <div>
          <div className={ui.eyebrow}>Marketplace</div>
          <h1 id="mk-title" className={ui.pageTitle}>Marketplace</h1>
          <p className={ui.pageSub}>Salons sell products from their own inventory; listings go live only after approval here. Orders are collected and paid at the salon.</p>
        </div>
        <div className={ui.rowWrap}>
          <Link className={css.tab} style={{ display: "inline-flex", alignItems: "center" }} href="/dashboard/admin/inventory/upload">Product database upload</Link>
          <a className={css.verify} style={{ display: "inline-flex", alignItems: "center" }} href="/shop" target="_blank" rel="noopener">Open Marketplace ↗</a>
        </div>
      </div>
      <div className={ui.rowWrap} role="tablist">
        {(["overview", "listings", "orders"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`${css.tab} ${tab === t ? css.tabOn : ""}`} onClick={() => go(t)}>
            {t === "overview" ? "Overview" : t === "listings" ? "Listing approvals" : "All orders"}
          </button>
        ))}
      </div>
      {tab === "listings" ? <Listings canManage={canManage} /> : tab === "orders" ? <Orders canManage={canManage} /> : <Overview />}
    </main>
  );
}

function Overview() {
  const [stats, setStats] = useState<AdminShopStatsDto | null>(null);
  const [sales, setSales] = useState<ShopAnalyticsDto | null>(null);
  const [period, setPeriod] = useState<"day" | "week" | "month">("month");
  useEffect(() => {
    apiFetch<AdminShopStatsDto>("admin/shop/stats").then(setStats).catch(() => undefined);
  }, []);
  useEffect(() => {
    apiFetch<ShopAnalyticsDto>(`admin/shop/analytics?period=${period}`).then(setSales).catch(() => undefined);
  }, [period]);
  if (!stats) return <div className={`${ui.skeleton} ${css.skeletonSmall}`} />;
  const tiles: Array<[string, string | number]> = [
    ["Live listings", stats.listings.APPROVED],
    ["Waiting for approval", stats.listings.PENDING_APPROVAL],
    ["Selling salons", stats.sellingSalons],
    ["New orders", stats.orders.PLACED],
    ["Ready for pickup", stats.orders.READY_FOR_PICKUP],
    ["Completed orders", stats.completedOrders],
    ["Gross sales (all time)", inr(stats.grossSales)],
    ["Low-stock listings", stats.lowStockListings],
  ];
  return (
    <>
      <section className={ui.card} aria-label="Marketplace statistics">
        <div className={css.summaryGrid}>
          {tiles.map(([label, value]) => (
            <div key={label} className={css.stat}><span className={css.statValue}>{value}</span><span className={css.statLabel}>{label}</span></div>
          ))}
        </div>
        <p className={ui.hint} style={{ marginTop: 10 }}>Commission rate: {Number(stats.commissionPercent)}% (set with SHOP_COMMISSION_PERCENT on the backend).</p>
      </section>
      <section className={ui.card} aria-label="Sales">
        <div className={ui.cardHead}>
          <h2 className={ui.cardTitle}>Sales</h2>
          <div className={ui.rowWrap}>
            {(["day", "week", "month"] as const).map((p) => (
              <button key={p} type="button" className={`${css.tab} ${period === p ? css.tabOn : ""}`} onClick={() => setPeriod(p)}>{p === "day" ? "Today" : p === "week" ? "7 days" : "30 days"}</button>
            ))}
          </div>
        </div>
        {sales && (
          <div className={css.summaryGrid}>
            {([["Gross", inr(sales.grossSales)], ["Orders", sales.orders], ["Units sold", sales.unitsSold], ["Avg order", inr(sales.averageOrderValue)], ["Commission", inr(sales.commission)], ["Seller net", inr(sales.netProceeds)], ["Cancelled/expired", sales.cancelledOrders], ["Refunds", inr(sales.refunds)]] as Array<[string, string | number]>).map(([l, v]) => (
              <div key={l} className={css.stat}><span className={css.statValue}>{v}</span><span className={css.statLabel}>{l}</span></div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Listings({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState<ShopListingStatus | "">("PENDING_APPROVAL");
  const [items, setItems] = useState<AdminShopListingDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch<InventoryPageDto<AdminShopListingDto>>(`admin/shop/listings?limit=100${status ? `&status=${status}` : ""}`).then((p) => setItems(p.items)).catch((err) => setError(errorText(err, "Could not load listings.")));
  }, [status]);
  useEffect(load, [load]);
  async function review(l: AdminShopListingDto, action: "APPROVE" | "REJECT" | "PAUSE") {
    let note: string | undefined;
    if (action === "REJECT") {
      const reason = window.prompt(`Why is "${l.productName}" rejected? The salon sees this.`);
      if (!reason?.trim()) return;
      note = reason.trim();
    }
    try {
      await apiFetch(`admin/shop/listings/${l.id}`, { method: "PATCH", body: JSON.stringify({ action, ...(note ? { note } : {}) }) });
      load();
    } catch (err) {
      setError(errorText(err, "That did not go through."));
    }
  }
  return (
    <section className={ui.card} aria-label="Listings">
      <div className={ui.rowWrap}>
        {(["PENDING_APPROVAL", "APPROVED", "PAUSED", "REJECTED", ""] as const).map((s) => (
          <button key={s || "all"} type="button" className={`${css.tab} ${status === s ? css.tabOn : ""}`} onClick={() => setStatus(s)}>
            {s === "" ? "All" : s === "PENDING_APPROVAL" ? "To approve" : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      {error && <p className={`${ui.banner} ${ui.bannerError}`} role="alert">{error}</p>}
      {!items ? <div className={`${ui.skeleton} ${css.skeletonSmall}`} /> : items.length === 0 ? <p className={ui.hint}>Nothing here.</p> : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Product</th><th>Salon</th><th className={ui.num}>Price</th><th className={ui.num}>Free stock</th><th>Status</th><th><span className={ui.srOnly}>Actions</span></th></tr></thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id}>
                  <td>{l.productName} {l.isTestData && <span className={css.badgeTest}>TEST DATA</span>}<div className={ui.cardSub}>{l.barcode ?? "no barcode"}</div></td>
                  <td>{l.salon.name}</td>
                  <td className={ui.num}>{inr(l.price)}{l.compareAtPrice && <div className={ui.cardSub}><s>{inr(l.compareAtPrice)}</s></div>}</td>
                  <td className={ui.num}>{l.availableQuantity}</td>
                  <td>{l.status.replace(/_/g, " ").toLowerCase()}{l.reviewNote && <div className={ui.cardSub}>{l.reviewNote}</div>}</td>
                  <td className={css.actions}>
                    {canManage && l.status !== "APPROVED" && <button type="button" className={css.verify} onClick={() => void review(l, "APPROVE")}>Approve</button>}
                    {canManage && l.status !== "REJECTED" && <button type="button" className={ui.cardLink} onClick={() => void review(l, "REJECT")}>Reject</button>}
                    {canManage && l.status === "APPROVED" && <button type="button" className={ui.cardLink} onClick={() => void review(l, "PAUSE")}>Pause</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Orders({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<ShopOrderDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch<InventoryPageDto<ShopOrderDto>>("admin/shop/orders?limit=100").then((p) => setItems(p.items)).catch((err) => setError(errorText(err, "Could not load orders.")));
  }, []);
  useEffect(load, [load]);
  async function cancel(o: ShopOrderDto) {
    const reason = window.prompt(`Cancel ${o.orderNumber}? Reason (the customer and salon see this):`);
    if (!reason?.trim()) return;
    try {
      await apiFetch(`admin/shop/orders/${o.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      load();
    } catch (err) {
      setError(errorText(err, "That did not go through."));
    }
  }
  return (
    <section className={ui.card} aria-label="Orders">
      {error && <p className={`${ui.banner} ${ui.bannerError}`} role="alert">{error}</p>}
      {!items ? <div className={`${ui.skeleton} ${css.skeletonSmall}`} /> : items.length === 0 ? <p className={ui.hint}>No shop orders yet.</p> : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Order</th><th>Salon</th><th>Customer</th><th className={ui.num}>Total</th><th>Status</th><th><span className={ui.srOnly}>Actions</span></th></tr></thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id}>
                  <td>{o.orderNumber}<div className={ui.cardSub}>{new Date(o.placedAt).toLocaleString()}</div></td>
                  <td>{o.salon.name}</td>
                  <td>{o.contactName}</td>
                  <td className={ui.num}>{inr(o.total)}</td>
                  <td>{SHOP_ORDER_STATUS_LABEL[o.status]}<div className={ui.cardSub}>{o.paymentStatus.replace(/_/g, " ").toLowerCase()}</div></td>
                  <td>{canManage && o.allowedTransitions.includes("CANCELLED") && <button type="button" className={ui.cardLink} onClick={() => void cancel(o)}>Cancel</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
