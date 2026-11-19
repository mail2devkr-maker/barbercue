"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  SHOP_ORDER_STATUS_LABEL,
  type InventoryPageDto,
  type OwnerSellableProductDto,
  type ShopAnalyticsDto,
  type ShopOrderDto,
  type ShopOrderStatus,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../lib/api";
import { Badge, Banner, Btn, Card, Dialog, Field, Kpi, Skeleton } from "../parts";
import ui from "../owner.module.css";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message || fallback : fallback);
const inr = (v: string | number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(v))}`;
const LISTING_TONE = { APPROVED: "ok", PENDING_APPROVAL: "warn", REJECTED: "bad", PAUSED: "neutral", DRAFT: "neutral" } as const;
const LISTING_LABEL = { APPROVED: "Live", PENDING_APPROVAL: "Waiting for FastQue approval", REJECTED: "Rejected", PAUSED: "Paused", DRAFT: "Draft" } as const;
const NEXT_ACTION: Partial<Record<ShopOrderStatus, Array<{ to: ShopOrderStatus; label: string; primary?: boolean }>>> = {
  PLACED: [{ to: "ACCEPTED", label: "Accept", primary: true }, { to: "CANCELLED", label: "Decline" }],
  ACCEPTED: [{ to: "PREPARING", label: "Start preparing" }, { to: "READY_FOR_PICKUP", label: "Ready for pickup", primary: true }, { to: "CANCELLED", label: "Cancel" }],
  PREPARING: [{ to: "READY_FOR_PICKUP", label: "Ready for pickup", primary: true }, { to: "CANCELLED", label: "Cancel" }],
  READY_FOR_PICKUP: [{ to: "COMPLETED", label: "Collected & paid", primary: true }, { to: "CANCELLED", label: "Not collected" }],
};
const ORDER_TABS: Array<{ value: ShopOrderStatus | ""; label: string }> = [
  { value: "PLACED", label: "New" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "PREPARING", label: "Preparing" },
  { value: "READY_FOR_PICKUP", label: "Ready for pickup" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "", label: "All" },
];

/**
 * Owner → Sell on FastQue: put products from the shop's own inventory on Marketplace (price, offer,
 * per-order limit), run the shop's online orders, and see sales. Stock always comes from Inventory.
 */
export function SellOnFastQue({ salonId }: { salonId: string }) {
  const [tab, setTab] = useState<"products" | "orders" | "analytics">("products");
  const base = `dashboard/salons/${salonId}/shop`;
  return (
    <main className={ui.grid} aria-label="Sell on FastQue">
      <div className={ui.pageHead}>
        <div>
          <div className={ui.eyebrow}>Shop</div>
          <h1 className={ui.pageTitle}>Sell on FastQue</h1>
          <p className={ui.pageSub}>List products from your inventory on Marketplace. Customers reserve online and collect and pay at your salon. Stock and cost always come from Inventory.</p>
        </div>
        <div className={ui.rowWrap}>
          <a href="/shop" target="_blank" rel="noopener" className={`${ui.btn} ${ui.btnSecondary}`}>Open Marketplace ↗</a>
        </div>
      </div>
      <div className={ui.tabs} role="tablist" aria-label="Sell on FastQue sections">
        {(["products", "orders", "analytics"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`${ui.tab} ${tab === t ? ui.tabActive : ""}`} onClick={() => setTab(t)}>
            {t === "products" ? "My products" : t === "orders" ? "Orders" : "Sales"}
          </button>
        ))}
      </div>
      {tab === "products" ? <Listings base={base} salonId={salonId} /> : tab === "orders" ? <Orders base={base} /> : <Analytics base={base} />}
    </main>
  );
}

function Listings({ base, salonId }: { base: string; salonId: string }) {
  const [rows, setRows] = useState<OwnerSellableProductDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<OwnerSellableProductDto | null>(null);
  const load = useCallback(() => {
    apiFetch<OwnerSellableProductDto[]>(`${base}/sellable`).then(setRows).catch((err) => setError(errorText(err, "Could not load your products.")));
  }, [base]);
  useEffect(load, [load]);

  async function setStatus(p: OwnerSellableProductDto, action: "PAUSE" | "RESUME" | "SUBMIT") {
    try {
      await apiFetch(`${base}/listings/${p.listing!.id}`, { method: "PATCH", body: JSON.stringify({ action }) });
      setNotice(action === "PAUSE" ? `${p.name} is paused.` : `${p.name} updated.`);
      load();
    } catch (err) {
      setError(errorText(err, "That did not go through."));
    }
  }

  if (!rows) return <Skeleton height={240} />;
  const sellable = rows.filter((r) => r.globalProductId);
  const unlinked = rows.length - sellable.length;
  return (
    <Card title="My products" sub="Only products linked to the FastQue catalog (barcode) and counted in pieces/packs can be sold. New listings go live after a quick FastQue check.">
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <div role="status"><Banner tone="ok">{notice}</Banner></div>}
      {rows.length === 0 ? (
        <p className={ui.hint}>
          Your inventory is empty. Add products from the <Link href={`/dashboard/salons/${salonId}/inventory/catalog`}>FastQue product catalog</Link>, record stock, then list them here.
        </p>
      ) : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Product</th><th className={ui.num}>In stock</th><th className={ui.num}>Held by orders</th><th className={ui.num}>Shop price</th><th>Status</th><th><span className={ui.srOnly}>Actions</span></th></tr></thead>
            <tbody>
              {sellable.map((p) => (
                <tr key={p.inventoryProductId}>
                  <td>{p.name}<div className={ui.cardSub}>{p.barcode ? `Barcode ${p.barcode} · ` : ""}{p.usage === "RETAIL" ? "Retail shelf" : "Professional shelf"}</div></td>
                  <td className={ui.num}>{Number(p.stockOnHand)}</td>
                  <td className={ui.num}>{p.reserved}</td>
                  <td className={ui.num}>{p.listing ? <>{inr(p.listing.price)}{p.listing.compareAtPrice && <div className={ui.cardSub}><s>{inr(p.listing.compareAtPrice)}</s></div>}</> : "—"}</td>
                  <td>
                    {p.listing ? <Badge tone={LISTING_TONE[p.listing.status]}>{LISTING_LABEL[p.listing.status]}</Badge> : <Badge>Not listed</Badge>}
                    {p.listing?.reviewNote && <div className={ui.cardSub}>FastQue: {p.listing.reviewNote}</div>}
                    {p.listing?.status === "APPROVED" && Number(p.stockOnHand) - p.reserved <= 0 && <div className={ui.cardSub}>Shows as out of stock</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Btn small variant={p.listing ? "quiet" : "primary"} onClick={() => setEditing(p)}>{p.listing ? "Edit" : "Sell online"}</Btn>
                    {p.listing?.status === "APPROVED" && <Btn small variant="quiet" onClick={() => void setStatus(p, "PAUSE")}>Pause</Btn>}
                    {p.listing?.status === "PAUSED" && <Btn small variant="quiet" onClick={() => void setStatus(p, "RESUME")}>Resume</Btn>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unlinked > 0 && <p className={ui.hint}>{unlinked} product{unlinked === 1 ? " is" : "s are"} not linked to the FastQue catalog yet, so they can’t be sold online. Link them by scanning their barcode in Inventory → Scan / Add stock.</p>}
      {editing && (
        <ListingDialog
          base={base}
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setNotice(msg);
            load();
          }}
        />
      )}
    </Card>
  );
}

function ListingDialog({ base, product, onClose, onSaved }: { base: string; product: OwnerSellableProductDto; onClose: () => void; onSaved: (msg: string) => void }) {
  const [price, setPrice] = useState(product.listing?.price ?? product.sellingPrice ?? "");
  const [compareAt, setCompareAt] = useState(product.listing?.compareAtPrice ?? "");
  const [maxPerOrder, setMax] = useState(String(product.listing?.maxPerOrder ?? 5));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const p = Number(price);
    const c = compareAt === "" ? null : Number(compareAt);
    const m = Number(maxPerOrder);
    if (!(p > 0)) return setError("Enter a selling price above ₹0.");
    if (c !== null && !(c >= p)) return setError("The original (strike-through) price must be at least the selling price.");
    if (!Number.isInteger(m) || m < 1 || m > 50) return setError("Limit per order must be 1 to 50.");
    setBusy(true);
    try {
      await apiFetch(`${base}/listings`, {
        method: "PUT",
        body: JSON.stringify({ inventoryProductId: product.inventoryProductId, price: Math.round(p * 100) / 100, compareAtPrice: c === null ? null : Math.round(c * 100) / 100, maxPerOrder: m, pickupEnabled: true }),
      });
      onSaved(product.listing ? `${product.name} updated.` : `${product.name} sent to FastQue for approval. It goes live once approved.`);
    } catch (err) {
      setError(errorText(err, "Could not save."));
      setBusy(false);
    }
  }
  return (
    <Dialog title={`${product.listing ? "Edit" : "Sell"} ${product.name}`} onClose={onClose}>
      <div className={ui.grid}>
        <Field label="Selling price (₹)"><input className={ui.input} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="Original price for the offer badge (₹, optional)" hint="Shown struck through. Leave empty for no offer."><input className={ui.input} inputMode="decimal" value={compareAt} onChange={(e) => setCompareAt(e.target.value)} /></Field>
        <Field label="Most a customer can buy per order"><input className={ui.input} inputMode="numeric" value={maxPerOrder} onChange={(e) => setMax(e.target.value)} /></Field>
        <p className={ui.hint}>Fulfilment: pickup at your salon, paid at the salon. You have {Number(product.stockOnHand)} in stock; customers can only order what’s free.</p>
        {error && <Banner tone="error">{error}</Banner>}
        <div className={ui.rowWrap}>
          <Btn variant="primary" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</Btn>
          <Btn onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Dialog>
  );
}

function Orders({ base }: { base: string }) {
  const [status, setStatus] = useState<ShopOrderStatus | "">("PLACED");
  const [items, setItems] = useState<ShopOrderDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch<InventoryPageDto<ShopOrderDto>>(`${base}/orders?limit=50${status ? `&status=${status}` : ""}`)
      .then((p) => setItems(p.items))
      .catch((err) => setError(errorText(err, "Could not load orders.")));
  }, [base, status]);
  useEffect(load, [load]);

  async function move(o: ShopOrderDto, to: ShopOrderStatus) {
    let note: string | undefined;
    let paidAtSalon: boolean | undefined;
    if (to === "CANCELLED") {
      const reason = window.prompt("Reason (the customer sees this):", o.status === "PLACED" ? "Out of stock" : "");
      if (reason === null) return;
      note = reason.trim() || undefined;
    }
    if (to === "COMPLETED") {
      if (!window.confirm(`Confirm ${o.contactName} collected the order and paid ${inr(o.total)} at the salon? Stock will be reduced.`)) return;
      paidAtSalon = true;
    }
    setBusy(o.id);
    try {
      await apiFetch(`${base}/orders/${o.id}/transition`, { method: "POST", body: JSON.stringify({ to, ...(note ? { note } : {}), ...(paidAtSalon ? { paidAtSalon } : {}) }) });
      load();
    } catch (err) {
      setError(errorText(err, "That did not go through."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Orders" sub="New orders hold the stock for 24 hours; accept them before then or they expire.">
      <div className={ui.rowWrap} role="tablist" aria-label="Order status">
        {ORDER_TABS.map((t) => (
          <button key={t.label} type="button" role="tab" aria-selected={status === t.value} className={`${ui.tab} ${status === t.value ? ui.tabActive : ""}`} onClick={() => setStatus(t.value)}>{t.label}</button>
        ))}
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {!items ? <Skeleton height={160} /> : items.length === 0 ? <p className={ui.hint}>No orders here.</p> : (
        <div className={ui.grid} style={{ marginTop: 12 }}>
          {items.map((o) => (
            <div key={o.id} className={`${ui.card} ${ui.cardTight}`}>
              <div className={ui.cardHead}>
                <div>
                  <strong>{o.orderNumber}</strong> · {o.contactName} · <a href={`tel:${o.contactPhone}`}>{o.contactPhone}</a>
                  <div className={ui.cardSub}>{new Date(o.placedAt).toLocaleString()} · {SHOP_ORDER_STATUS_LABEL[o.status]}{o.status === "PLACED" ? ` · accept by ${new Date(o.acceptBy).toLocaleString()}` : ""}</div>
                </div>
                <strong>{inr(o.total)}</strong>
              </div>
              <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
                {o.items.map((i) => <li key={`${i.productId}-${i.unitPrice}`}>{i.quantity} × {i.name} @ {inr(i.unitPrice)}</li>)}
              </ul>
              {o.note && <p className={ui.cardSub}>Note: {o.note}</p>}
              <div className={ui.rowWrap}>
                {(NEXT_ACTION[o.status] ?? []).filter((a) => o.allowedTransitions.includes(a.to)).map((a) => (
                  <Btn key={a.to} small variant={a.primary ? "primary" : "secondary"} disabled={busy === o.id} onClick={() => void move(o, a.to)}>{a.label}</Btn>
                ))}
                {o.status === "PLACED" && !o.allowedTransitions.length && <Badge tone="bad">Expired</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Analytics({ base }: { base: string }) {
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  const [data, setData] = useState<ShopAnalyticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<ShopAnalyticsDto>(`${base}/analytics?period=${period}`).then(setData).catch((err) => setError(errorText(err, "Could not load sales.")));
  }, [base, period]);
  return (
    <Card title="Sales" sub="Completed (collected) orders only. Commission is FastQue’s configured rate.">
      <div className={ui.rowWrap} role="tablist" aria-label="Period">
        {(["day", "week", "month"] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={period === p} className={`${ui.tab} ${period === p ? ui.tabActive : ""}`} onClick={() => setPeriod(p)}>{p === "day" ? "Today" : p === "week" ? "7 days" : "30 days"}</button>
        ))}
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {!data ? <Skeleton height={160} /> : (
        <>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", marginTop: 12 }}>
            <Kpi label="Gross sales" value={inr(data.grossSales)} icon="rupee" tone="ok" />
            <Kpi label="Orders" value={data.orders} icon="receipt" foot={`${data.completedOrders} completed · ${data.cancelledOrders} cancelled/expired`} />
            <Kpi label="Products sold" value={data.unitsSold} icon="tag" />
            <Kpi label="Average order" value={inr(data.averageOrderValue)} icon="chart" />
            <Kpi label={`Commission (${Number(data.commissionPercent)}%)`} value={inr(data.commission)} icon="card" />
            <Kpi label="Net proceeds" value={inr(data.netProceeds)} icon="rupee" tone="info" foot={`Refunds ${inr(data.refunds)} · discounts ${inr(data.discounts)}`} />
          </div>
          <h3 className={ui.cardTitle} style={{ marginTop: 16 }}>Best sellers</h3>
          {data.bestSellers.length === 0 ? <p className={ui.hint}>No completed sales in this period.</p> : (
            <ul>{data.bestSellers.map((b) => <li key={b.productId}>{b.name} — {b.units} sold · {inr(b.revenue)}</li>)}</ul>
          )}
        </>
      )}
    </Card>
  );
}
