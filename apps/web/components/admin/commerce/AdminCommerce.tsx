"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { COMMERCE_PERMISSIONS, COMMERCE_STATUS_LABEL, type CommerceOrderDto, type CommerceOrderStatus, type CommercePermission } from "@barbercue/shared";
import { apiFetch, apiFetchBlob, ApiError } from "../../../lib/api";
import { newIdempotencyKey } from "../../../lib/idempotency";
import ui from "../../owner/owner.module.css";
import css from "../inventory/admin-inventory.module.css";
import c from "./admin-commerce.module.css";

const API = "admin/commerce";
type Row = Record<string, unknown> & { id: string };
type Page = { items: Row[]; total: number; page: number; pageSize: number };
const inr = (v: unknown) => (v == null ? "—" : `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(v))}`);
const day = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "—");
const err = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");
const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o);
const str = (o: unknown, path: string) => {
  const v = get(o, path);
  return v == null ? "" : String(v);
};

const TABS: ReadonlyArray<readonly [string, string, CommercePermission]> = [
  ["overview", "Overview", "view"],
  ["products", "Products & Pricing", "view"],
  ["inventory", "Inventory", "view"],
  ["warehouses", "Warehouses", "view"],
  ["suppliers", "Suppliers", "procurement"],
  ["procurement", "Procurement", "procurement"],
  ["orders", "Orders", "orders"],
  ["shipping", "Shipping", "orders"],
  ["cod", "COD", "finance"],
  ["returns", "Returns", "support"],
  ["promotions", "Promotions", "view"],
  ["serviceability", "Serviceability", "view"],
  ["reports", "Reports", "view"],
  ["insights", "AI Insights", "view"],
  ["quality", "Data quality", "view"],
  ["settings", "Settings", "settings"],
];

function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!path) return;
    apiFetch<T>(`${API}/${path}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(err(e)));
  }, [path]);
  useEffect(() => load(), [load]);
  return { data, error, load };
}
async function send(path: string, body: unknown, method: "POST" | "PUT" = "POST", keyed = false) {
  return apiFetch(`${API}/${path}`, { method, headers: keyed ? { "Idempotency-Key": newIdempotencyKey() } : {}, body: JSON.stringify(body) });
}

// ---------- Small building blocks ----------

interface Field {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "checkbox" | "select" | "list";
  options?: ReadonlyArray<readonly [string, string]>;
  optional?: boolean;
  hint?: string;
}
/** One form renderer for every admin form; empty optional fields are sent as null. */
function Form({ fields, initial, submit, label, onDone }: { fields: Field[]; initial?: Record<string, unknown>; submit: (v: Record<string, unknown>) => Promise<unknown>; label: string; onDone: () => void }) {
  const [v, setV] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.map((f) => [f.key, initial?.[f.key] ?? (f.type === "checkbox" ? false : f.type === "select" ? (f.options?.[0]?.[0] ?? "") : "")])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      for (const f of fields) {
        const x = v[f.key];
        if (f.type === "checkbox") body[f.key] = !!x;
        else if (f.type === "list") body[f.key] = String(x ?? "").split(/[\s,]+/).filter(Boolean);
        else if (x === "" || x == null) {
          if (f.optional) body[f.key] = null;
        } else if (f.type === "number") body[f.key] = Number(x);
        else body[f.key] = String(x);
      }
      await submit(body);
      onDone();
    } catch (ex) {
      setError(err(ex));
      setBusy(false);
    }
  }
  return (
    <form className={c.form} onSubmit={(e) => void go(e)}>
      {fields.map((f) => (
        <label key={f.key} className={f.type === "checkbox" ? c.check : c.field}>
          {f.type === "checkbox" ? (
            <>
              <input type="checkbox" checked={!!v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.checked })} /> {f.label}
            </>
          ) : (
            <>
              {f.label}
              {f.type === "select" ? (
                <select value={String(v[f.key] ?? "")} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}>
                  {f.options?.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              ) : (
                <input type={f.type === "number" || f.type === "date" ? f.type : "text"} step="any" required={!f.optional && f.type !== "list"} value={Array.isArray(v[f.key]) ? (v[f.key] as string[]).join(", ") : String(v[f.key] ?? "")} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
              )}
              {f.hint && <small>{f.hint}</small>}
            </>
          )}
        </label>
      ))}
      {error && <p className={c.error} role="alert">{error}</p>}
      <div className={ui.rowWrap}>
        <button type="submit" className={css.verify} disabled={busy}>{busy ? "Saving…" : label}</button>
        <button type="button" className={css.tab} onClick={onDone}>Close</button>
      </div>
    </form>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className={ui.hint}>{empty}</p>;
  return (
    <div className={c.tableWrap}>
      <table className={c.table}>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((x, j) => <td key={j}>{x}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={ui.card} aria-label={title}>
      <div className={ui.cardHead}><h2 className={ui.cardTitle}>{title}</h2>{action}</div>
      {children}
    </section>
  );
}
function Stats({ items }: { items: Array<[string, ReactNode]> }) {
  return <div className={css.summaryGrid}>{items.map(([l, v]) => <div key={l} className={css.stat}><span className={css.statValue}>{v}</span><span className={css.statLabel}>{l}</span></div>)}</div>;
}
function Busy({ error }: { error: string | null }) {
  return error ? <p className={c.error} role="alert">{error}</p> : <div className={`${ui.skeleton} ${css.skeletonSmall}`} />;
}
/** A paged list with search and an optional status filter. */
function List({ title, path, statuses, head, row, empty, action, reloadKey }: { title: string; path: string; statuses?: ReadonlyArray<readonly [string, string]>; head: string[]; row: (r: Row, reload: () => void) => ReactNode[]; empty: string; action?: ReactNode; reloadKey?: number }) {
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState(statuses?.[0]?.[0] ?? "");
  const [page, setPage] = useState(1);
  const { data, error, load } = useLoad<Page>(`${path}?page=${page}&limit=25${q ? `&q=${encodeURIComponent(q)}` : ""}${status ? `&status=${status}` : ""}`);
  useEffect(() => {
    if (reloadKey) load();
  }, [reloadKey, load]);
  const pages = data ? Math.ceil(data.total / data.pageSize) : 0;
  return (
    <Card title={title} action={action}>
      <form className={ui.rowWrap} onSubmit={(e) => { e.preventDefault(); setPage(1); setQ(typed.trim()); }}>
        <input className={c.input} aria-label={`Search ${title}`} placeholder="Search" value={typed} onChange={(e) => setTyped(e.target.value)} />
        {statuses && <select className={c.input} aria-label="Status" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>{statuses.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
        <button type="submit" className={css.tab}>Search</button>
      </form>
      {!data ? <Busy error={error} /> : <Table head={head} rows={data.items.map((r) => row(r, load))} empty={empty} />}
      {pages > 1 && (
        <div className={ui.rowWrap}>
          <button type="button" className={css.tab} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className={ui.hint}>Page {page} of {pages}</span>
          <button type="button" className={css.tab} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </Card>
  );
}
const ALL = ["", "All"] as const;

// ---------- Page ----------

export function AdminCommerce() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const { data, error } = useLoad<{ permissions: CommercePermission[] }>("me");
  const can = (p: CommercePermission) => !!data?.permissions.includes(p);
  const tabs = TABS.filter((t) => can(t[2]));
  const wanted = params.get("tab") ?? "overview";
  const tab = tabs.find((t) => t[0] === wanted)?.[0] ?? null;
  return (
    <main className={ui.grid} aria-labelledby="fc-title">
      <div className={ui.pageHead}>
        <div>
          <div className={ui.eyebrow}>FastQue Commerce</div>
          <h1 id="fc-title" className={ui.pageTitle}>FastQue Commerce</h1>
          <p className={ui.pageSub}>Products FastQue sells and delivers itself, with Cash on Delivery. Salon listings and pickup orders stay under Marketplace.</p>
        </div>
      </div>
      {!data ? (
        error ? <p className={c.error} role="alert">{error === "Not available." ? "FastQue Commerce is switched off on the server." : error}</p> : <Busy error={null} />
      ) : !tabs.length ? (
        <p className={c.error}>Your account has no FastQue Commerce permission. A platform admin can grant one under Settings.</p>
      ) : (
        <>
          <div className={ui.rowWrap} role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={`${css.tab} ${tab === id ? css.tabOn : ""}`} onClick={() => router.replace(id === "overview" ? path : `${path}?tab=${id}`)}>{label}</button>
            ))}
          </div>
          {!tab && <p className={c.error}>You do not have permission to open this tab.</p>}
          {tab === "overview" && <Overview />}
          {tab === "reports" && <Overview detailed exportable={can("orders")} />}
          {tab === "products" && <Products canEdit={can("catalog")} />}
          {tab === "inventory" && <Inventory canEdit={can("warehouse")} />}
          {tab === "warehouses" && <Warehouses canEdit={can("warehouse")} />}
          {tab === "suppliers" && <Suppliers canPay={can("finance")} />}
          {tab === "procurement" && <Procurement can={can} />}
          {(tab === "orders" || tab === "shipping") && <Orders key={tab} shipping={tab === "shipping"} />}
          {tab === "cod" && <Cod />}
          {tab === "returns" && <Returns canRefund={can("finance")} />}
          {tab === "promotions" && <Promotions canEdit={can("catalog")} />}
          {tab === "serviceability" && <Zones canEdit={can("delivery")} />}
          {tab === "insights" && <Insights />}
          {tab === "quality" && <Quality canEdit={can("settings")} />}
          {tab === "settings" && <Settings />}
        </>
      )}
    </main>
  );
}

// ---------- Overview & reports ----------

interface OverviewDto {
  orders: { placed: number; open: number; delivered: number; cancelled: number; returnedToOrigin: number };
  gmv: string;
  averageOrder: string | null;
  unitsSold: number;
  customers: { buying: number; repeat: number };
  operations: Record<string, string | null>;
  daily: Array<{ day: string; orders: number; sales: string }>;
  byProduct: Group[];
  byCategory: Group[];
  byBrand: Group[];
  byCity: Group[];
  salonMarketplace: { completedOrders: number; salesAtSalons: string };
  finance: Record<string, string | null> | null;
}
type Group = { name: string; units: number; sales: string };
function Overview({ detailed, exportable }: { detailed?: boolean; exportable?: boolean }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = `${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;
  const { data, error } = useLoad<OverviewDto>(`overview?limit=25${range}`);
  async function download() {
    const { blob } = await apiFetchBlob(`${API}/export/orders?limit=25${range}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fastque-orders.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  if (!data) return <Busy error={error} />;
  const max = Math.max(1, ...data.daily.map((d) => Number(d.sales)));
  const groups: Array<[string, Group[]]> = [["Products", data.byProduct], ["Categories", data.byCategory], ["Brands", data.byBrand], ["Cities", data.byCity]];
  return (
    <>
      <Card
        title="FastQue direct sales"
        action={
          <div className={ui.rowWrap}>
            <input className={c.input} type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className={c.input} type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
            {exportable && <button type="button" className={css.tab} onClick={() => void download()}>Export CSV</button>}
          </div>
        }
      >
        <p className={ui.hint}>{from || to ? "Chosen dates" : "Last 30 days"}. Sales = orders placed, without cancelled and undelivered ones.</p>
        <Stats
          items={[
            ["Sales (incl. delivery)", inr(data.gmv)],
            ["Orders", data.orders.placed],
            ["Open", data.orders.open],
            ["Delivered", data.orders.delivered],
            ["Cancelled", data.orders.cancelled],
            ["Returned to origin", data.orders.returnedToOrigin],
            ["Average order", data.averageOrder ? inr(data.averageOrder) : "—"],
            ["Units", data.unitsSold],
            ["Customers (repeat)", `${data.customers.buying} (${data.customers.repeat})`],
          ]}
        />
      </Card>
      {data.finance && (
        <Card title="Profit and cash">
          <p className={ui.hint}>Net revenue counts delivered orders only, without GST and refunds.</p>
          <Stats
            items={[
              ["Net revenue", inr(data.finance.netRevenue)],
              ["Cost of goods", inr(data.finance.costOfGoods)],
              ["Gross profit", inr(data.finance.grossProfit)],
              ["Gross margin", data.finance.grossMarginPercent ? `${data.finance.grossMarginPercent}%` : "—"],
              ["Contribution", inr(data.finance.contribution)],
              ["Courier & COD fees", inr(data.finance.courierAndCodFees)],
              ["Packaging", inr(data.finance.packaging)],
              ["Refunds", inr(data.finance.refunds)],
              ["Stock value", inr(data.finance.inventoryValue)],
              ["COD outstanding", inr(data.finance.codOutstanding)],
              ["Owed to suppliers", inr(data.finance.supplierOutstanding)],
            ]}
          />
        </Card>
      )}
      <Card title="Daily sales">
        {data.daily.length === 0 ? <p className={ui.hint}>No orders in this period.</p> : (
          <div className={c.bars} role="img" aria-label={data.daily.map((d) => `${d.day}: ${inr(d.sales)}`).join(", ")}>
            {data.daily.map((d) => <div key={d.day} title={`${d.day}: ${inr(d.sales)}, ${d.orders} orders`} style={{ height: `${Math.max(3, (Number(d.sales) / max) * 100)}%` }} />)}
          </div>
        )}
      </Card>
      <Card title="Salon marketplace (not FastQue revenue)">
        <Stats items={[["Completed pickup orders", data.salonMarketplace.completedOrders], ["Paid at salons", inr(data.salonMarketplace.salesAtSalons)]]} />
      </Card>
      {detailed && (
        <>
          <Card title="Operations">
            <Stats items={[["Hours to ship", data.operations.hoursToShip ?? "—"], ["Hours to deliver", data.operations.hoursToDeliver ?? "—"], ["Cancellation rate", data.operations.cancellationRate ? `${data.operations.cancellationRate}%` : "—"], ["Return-to-origin rate", data.operations.rtoRate ? `${data.operations.rtoRate}%` : "—"]]} />
          </Card>
          {groups.map(([t, rows]) => (
            <Card key={t} title={t}><Table head={["Name", "Units", "Sales"]} rows={rows.map((r) => [r.name, r.units, inr(r.sales)])} empty="No sales in this period." /></Card>
          ))}
        </>
      )}
    </>
  );
}

// ---------- Products ----------

const LISTING_FIELDS: Field[] = [
  { key: "sku", label: "SKU" },
  { key: "mrp", label: "MRP ₹" },
  { key: "price", label: "Selling price ₹" },
  { key: "promoPrice", label: "Promotional price ₹", optional: true },
  { key: "status", label: "Status", type: "select", options: [["DRAFT", "Draft"], ["ACTIVE", "On sale"], ["PAUSED", "Paused"]] },
  { key: "maxPerOrder", label: "Max per order", type: "number" },
  { key: "weightGrams", label: "Weight (g)", type: "number" },
  { key: "reorderLevel", label: "Reorder level", type: "number" },
  { key: "safetyStock", label: "Safety stock", type: "number" },
  { key: "returnWindowDays", label: "Return window (days)", type: "number" },
  { key: "returnable", label: "Returnable", type: "checkbox" },
  { key: "codEligible", label: "Cash on Delivery", type: "checkbox" },
  { key: "expiryTracked", label: "Expiry-tracked", type: "checkbox" },
  { key: "featured", label: "Featured", type: "checkbox" },
];
function Products({ canEdit }: { canEdit: boolean }) {
  const [edit, setEdit] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Row[]>([]);
  const [pick, setPick] = useState<Row | null>(null);
  const [n, setN] = useState(0);
  const done = () => {
    setEdit(null);
    setPick(null);
    setAdding(false);
    setN((x) => x + 1);
  };
  const save = (globalProductId: string, id?: string) => async (v: Record<string, unknown>) => {
    const body = { ...v, globalProductId };
    const go = (extra = {}) => send(id ? `listings/${id}` : "listings", { ...body, ...extra }, id ? "PUT" : "POST");
    try {
      await go();
    } catch (e) {
      if (e instanceof ApiError && e.code === "COMMERCE_BELOW_COST" && window.confirm(`${e.message}`)) return go({ confirmBelowCost: true });
      throw e;
    }
  };
  return (
    <>
      {canEdit && adding && (
        <Card title="Add a product from the common catalog">
          {!pick ? (
            <>
              <form className={ui.rowWrap} onSubmit={(e) => { e.preventDefault(); apiFetch<Row[]>(`${API}/catalog?q=${encodeURIComponent(q)}`).then(setFound).catch(() => setFound([])); }}>
                <input className={c.input} aria-label="Search catalog" placeholder="Name, brand or barcode" value={q} onChange={(e) => setQ(e.target.value)} />
                <button type="submit" className={css.tab}>Search</button>
                <button type="button" className={css.tab} onClick={() => setAdding(false)}>Close</button>
              </form>
              <Table head={["Product", "Brand", "Category", ""]} rows={found.map((p) => [`${str(p, "name")} ${str(p, "variantText")}`, str(p, "brand"), str(p, "category"), <button key="b" type="button" className={css.tab} onClick={() => setPick(p)}>Choose</button>])} empty="Search for a verified catalog product. New products are added under Inventory → Product Master." />
            </>
          ) : (
            <>
              <p><strong>{str(pick, "name")}</strong></p>
              <Form fields={LISTING_FIELDS} initial={{ mrp: str(pick, "mrp"), status: "DRAFT", maxPerOrder: 5, weightGrams: 500, reorderLevel: 0, safetyStock: 0, returnWindowDays: 7, returnable: true, codEligible: true, expiryTracked: true }} submit={save(pick.id)} label="Add product" onDone={done} />
            </>
          )}
        </Card>
      )}
      {edit && <Card title={`Edit ${str(edit, "globalProduct.name")}`}><Form key={edit.id} fields={LISTING_FIELDS} initial={edit} submit={save(str(edit, "globalProductId"), edit.id)} label="Save" onDone={done} /></Card>}
      <List
        title="FastQue products"
        path="listings"
        reloadKey={n}
        statuses={[ALL, ["ACTIVE", "On sale"], ["DRAFT", "Draft"], ["PAUSED", "Paused"]]}
        action={canEdit ? <button type="button" className={css.verify} onClick={() => setAdding(true)}>Add product</button> : null}
        head={["Product", "SKU", "Price", "Available", "Margin", "Status", ""]}
        empty="No FastQue products yet."
        row={(r) => [
          <span key="n"><strong>{str(r, "globalProduct.name")}</strong> {str(r, "globalProduct.variantText")}<br /><small>{str(r, "globalProduct.brand")}</small></span>,
          str(r, "sku"),
          `${inr(r.priceNow)} (MRP ${inr(r.mrp)})`,
          str(r, "available"),
          r.marginPercent ? `${str(r, "marginPercent")}%` : "—",
          str(r, "status"),
          canEdit ? <button key="e" type="button" className={css.tab} onClick={() => setEdit(r)}>Edit</button> : null,
        ]}
      />
    </>
  );
}

// ---------- Inventory & warehouses ----------

function useOptions(path: string, label: (r: Row) => string) {
  const [o, setO] = useState<Array<readonly [string, string]>>([]);
  useEffect(() => {
    apiFetch<Row[] | Page>(`${API}/${path}`)
      .then((d) => setO((Array.isArray(d) ? d : d.items).map((r) => [r.id, label(r)] as const)))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- label is a pure formatter
  }, [path]);
  return o;
}
const productLabel = (r: Row) => `${str(r, "globalProduct.name")} · ${str(r, "sku")}`;
function Inventory({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState<"add" | null>(null);
  const [adjust, setAdjust] = useState<Row | null>(null);
  const [moves, setMoves] = useState<Row[] | null>(null);
  const [n, setN] = useState(0);
  const products = useOptions("listings?limit=100", productLabel);
  const warehouses = useOptions("warehouses", (r) => `${str(r, "code")} · ${str(r, "name")}`);
  const done = () => {
    setOpen(null);
    setAdjust(null);
    setN((x) => x + 1);
  };
  return (
    <>
      {open === "add" && (
        <Card title="Add stock">
          {!products.length || !warehouses.length ? <p className={ui.hint}>Add a product and a warehouse first.</p> : (
            <Form
              fields={[
                { key: "listingId", label: "Product", type: "select", options: products },
                { key: "warehouseId", label: "Warehouse", type: "select", options: warehouses },
                { key: "batchNumber", label: "Batch number" },
                { key: "quantity", label: "Quantity", type: "number" },
                { key: "unitCost", label: "Unit cost ₹" },
                { key: "manufacturedOn", label: "Made on", type: "date", optional: true },
                { key: "expiresOn", label: "Expires on", type: "date", optional: true },
                { key: "storageLocation", label: "Shelf", optional: true },
              ]}
              submit={(v) => send("stock", v, "POST", true)}
              label="Add stock"
              onDone={done}
            />
          )}
        </Card>
      )}
      {adjust && (
        <Card title={`Adjust batch ${str(adjust, "batchNumber")}`}>
          <Form
            fields={[
              { key: "kind", label: "What happened", type: "select", options: [["ADJUSTMENT", "Count correction (+/−)"], ["DAMAGE", "Damaged"], ["EXPIRE", "Expired"], ["QUARANTINE_IN", "Put in quarantine"], ["QUARANTINE_OUT", "Release from quarantine"]] },
              { key: "quantity", label: "Quantity", type: "number" },
              { key: "note", label: "Reason" },
            ]}
            submit={(v) => send(`batches/${adjust.id}/adjust`, v, "POST", true)}
            label="Record"
            onDone={done}
          />
          <Form
            fields={[{ key: "toWarehouseId", label: "Transfer to", type: "select", options: warehouses }, { key: "quantity", label: "Quantity", type: "number" }]}
            submit={(v) => send(`batches/${adjust.id}/transfer`, v, "POST", true)}
            label="Transfer"
            onDone={done}
          />
        </Card>
      )}
      {moves && <Card title="Stock history" action={<button type="button" className={css.tab} onClick={() => setMoves(null)}>Close</button>}><Table head={["When", "What", "On hand", "Reserved", "Quarantine", "Damaged", "Reference", "Note"]} rows={moves.map((m) => [new Date(str(m, "createdAt")).toLocaleString("en-IN"), str(m, "kind"), str(m, "onHandDelta"), str(m, "reservedDelta"), str(m, "quarantineDelta"), str(m, "damagedDelta"), str(m, "reference"), str(m, "note")])} empty="No movements." /></Card>}
      <List
        title="Batches"
        path="batches"
        reloadKey={n}
        statuses={[ALL, ["NEAR_EXPIRY", "Expiring in 90 days"], ["QUARANTINE", "In quarantine"]]}
        action={canEdit ? <button type="button" className={css.verify} onClick={() => setOpen("add")}>Add stock</button> : null}
        head={["Product", "Batch", "Warehouse", "Expires", "On hand", "Reserved", "Quarantine", "Damaged", "Expired", "Cost", ""]}
        empty="No stock yet."
        row={(r) => [
          `${str(r, "listing.globalProduct.name")} · ${str(r, "listing.sku")}`,
          str(r, "batchNumber"),
          str(r, "warehouse.code"),
          day(r.expiresOn),
          str(r, "onHand"),
          str(r, "reserved"),
          str(r, "quarantined"),
          str(r, "damaged"),
          str(r, "expired"),
          r.unitCost ? inr(r.unitCost) : "—",
          canEdit ? (
            <span key="a" className={ui.rowWrap}>
              <button type="button" className={css.tab} onClick={() => setAdjust(r)}>Adjust</button>
              <button type="button" className={css.tab} onClick={() => void apiFetch<Row[]>(`${API}/batches/${r.id}/movements`).then(setMoves).catch(() => undefined)}>History</button>
            </span>
          ) : null,
        ]}
      />
    </>
  );
}

/** A plain list whose rows open one form (warehouses, zones, coupons, suppliers). */
function Crud({ title, path, fields, head, row, empty, canEdit, initial, extra }: { title: string; path: string; fields: Field[]; head: string[]; row: (r: Row) => ReactNode[]; empty: string; canEdit: boolean; initial?: Record<string, unknown>; extra?: (r: Row, reload: () => void) => ReactNode }) {
  const { data, error, load } = useLoad<Row[]>(path);
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const done = () => {
    setEdit(null);
    load();
  };
  return (
    <>
      {edit && (
        <Card title={edit === "new" ? `New: ${title}` : "Edit"}>
          <Form key={edit === "new" ? "new" : edit.id} fields={fields} initial={edit === "new" ? initial : edit} submit={(v) => send(edit === "new" ? path : `${path}/${edit.id}`, v, edit === "new" ? "POST" : "PUT")} label="Save" onDone={done} />
        </Card>
      )}
      <Card title={title} action={canEdit ? <button type="button" className={css.verify} onClick={() => setEdit("new")}>Add</button> : null}>
        {!data ? <Busy error={error} /> : (
          <Table head={[...head, ""]} empty={empty} rows={data.map((r) => [...row(r), <span key="x" className={ui.rowWrap}>{canEdit && <button type="button" className={css.tab} onClick={() => setEdit(r)}>Edit</button>}{extra?.(r, load)}</span>])} />
        )}
      </Card>
    </>
  );
}
function Warehouses({ canEdit }: { canEdit: boolean }) {
  return (
    <Crud
      title="Warehouses"
      path="warehouses"
      canEdit={canEdit}
      initial={{ isActive: true }}
      fields={[{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "address", label: "Address", optional: true }, { key: "city", label: "City", optional: true }, { key: "state", label: "State", optional: true }, { key: "pincode", label: "PIN", optional: true }, { key: "isActive", label: "Active", type: "checkbox" }]}
      head={["Code", "Name", "City", "Active"]}
      row={(r) => [str(r, "code"), str(r, "name"), str(r, "city"), r.isActive ? "Yes" : "No"]}
      empty="No warehouses yet."
    />
  );
}
function Zones({ canEdit }: { canEdit: boolean }) {
  const warehouses = useOptions("warehouses", (r) => str(r, "name"));
  return (
    <Crud
      key={warehouses.length}
      title="Delivery zones"
      path="zones"
      canEdit={canEdit}
      initial={{ isActive: true, codEligible: true, priority: 100, minDays: 2, maxDays: 5, warehouseId: warehouses[0]?.[0] }}
      fields={[
        { key: "name", label: "Name" },
        { key: "warehouseId", label: "Ships from", type: "select", options: warehouses },
        { key: "pinRules", label: "PIN codes", type: "list", hint: "Full PINs, or the first digits for a whole area (e.g. 2013)." },
        { key: "blockedPins", label: "Not delivered (full PINs)", type: "list" },
        { key: "deliveryCharge", label: "Delivery charge ₹" },
        { key: "freeAbove", label: "Free above ₹", optional: true },
        { key: "minOrderAmount", label: "Minimum order ₹", optional: true },
        { key: "maxCodAmount", label: "COD limit ₹", optional: true },
        { key: "maxWeightGrams", label: "Max weight (g)", type: "number", optional: true },
        { key: "minDays", label: "Days (from)", type: "number" },
        { key: "maxDays", label: "Days (to)", type: "number" },
        { key: "priority", label: "Priority (1 = first)", type: "number" },
        { key: "codEligible", label: "Cash on Delivery", type: "checkbox" },
        { key: "isActive", label: "Active", type: "checkbox" },
      ]}
      head={["Zone", "PINs", "Charge", "Days", "COD", "Active"]}
      row={(r) => [str(r, "name"), (r.pinRules as string[]).slice(0, 6).join(", ") + ((r.pinRules as string[]).length > 6 ? "…" : ""), inr(r.deliveryCharge), `${str(r, "minDays")}–${str(r, "maxDays")}`, r.codEligible ? "Yes" : "No", r.isActive ? "Yes" : "No"]}
      empty="No zones yet. FastQue delivers nowhere until a zone is added."
    />
  );
}
function Promotions({ canEdit }: { canEdit: boolean }) {
  return (
    <Crud
      title="Coupons"
      path="coupons"
      canEdit={canEdit}
      initial={{ isActive: true, kind: "PERCENT", value: "10", minOrder: "0", perCustomer: 1 }}
      fields={[
        { key: "code", label: "Code" },
        { key: "kind", label: "Type", type: "select", options: [["PERCENT", "Percent"], ["FIXED", "Fixed ₹"], ["FREE_DELIVERY", "Free delivery"]] },
        { key: "value", label: "Value" },
        { key: "maxDiscount", label: "Max discount ₹", optional: true },
        { key: "minOrder", label: "Minimum order ₹" },
        { key: "brand", label: "Only brand", optional: true },
        { key: "category", label: "Only category", optional: true },
        { key: "usageLimit", label: "Total uses", type: "number", optional: true },
        { key: "perCustomer", label: "Uses per customer", type: "number" },
        { key: "description", label: "Description", optional: true },
        { key: "firstOrderOnly", label: "First order only", type: "checkbox" },
        { key: "isActive", label: "Active", type: "checkbox" },
      ]}
      head={["Code", "Type", "Value", "Used", "Active"]}
      row={(r) => [str(r, "code"), str(r, "kind"), str(r, "value"), str(r, "used"), r.isActive ? "Yes" : "No"]}
      empty="No coupons yet. Promotional prices are set on each product."
    />
  );
}

// ---------- Suppliers & procurement ----------

function Suppliers({ canPay }: { canPay: boolean }) {
  const [pay, setPay] = useState<Row | null>(null);
  const [price, setPrice] = useState<Row | null>(null);
  const products = useOptions("listings?limit=100", productLabel);
  return (
    <>
      {pay && <Card title={`Record a payment to ${str(pay, "name")}`}><Form fields={[{ key: "amount", label: "Amount ₹" }, { key: "paidOn", label: "Paid on", type: "date" }, { key: "reference", label: "Reference", optional: true }]} submit={(v) => send(`suppliers/${pay.id}/payments`, v, "POST", true)} label="Record payment" onDone={() => setPay(null)} /></Card>}
      {price && <Card title={`Price from ${str(price, "name")}`}><Form fields={[{ key: "listingId", label: "Product", type: "select", options: products }, { key: "unitCost", label: "Unit cost ₹" }, { key: "minQty", label: "Minimum quantity", type: "number" }]} initial={{ minQty: 1, listingId: products[0]?.[0] }} submit={(v) => send(`suppliers/${price.id}/products`, v, "PUT")} label="Save price" onDone={() => setPrice(null)} /></Card>}
      <Crud
        key={`${pay?.id}${price?.id}`}
        title="Suppliers and distributors"
        path="suppliers"
        canEdit
        initial={{ isActive: true, creditDays: 0 }}
        fields={[{ key: "name", label: "Company" }, { key: "contactName", label: "Contact", optional: true }, { key: "phone", label: "Phone", optional: true }, { key: "email", label: "Email", optional: true }, { key: "gstin", label: "GSTIN", optional: true }, { key: "address", label: "Address", optional: true }, { key: "creditDays", label: "Credit days", type: "number" }, { key: "leadTimeDays", label: "Lead time (days)", type: "number", optional: true }, { key: "notes", label: "Notes", optional: true }, { key: "isActive", label: "Active", type: "checkbox" }]}
        head={["Company", "Products", "Billed", "Outstanding", "Fulfilled", "Rejected"]}
        row={(r) => [str(r, "name"), (r.products as unknown[]).length, inr(r.billed), inr(r.outstanding), r.fulfilmentRate ? `${str(r, "fulfilmentRate")}%` : "—", r.rejectionRate ? `${str(r, "rejectionRate")}%` : "—"]}
        extra={(r) => (
          <>
            <button type="button" className={css.tab} onClick={() => setPrice(r)}>Set price</button>
            {canPay && <button type="button" className={css.tab} onClick={() => setPay(r)}>Record payment</button>}
          </>
        )}
        empty="No suppliers yet."
      />
    </>
  );
}
function Procurement({ can }: { can: (p: CommercePermission) => boolean }) {
  const [adding, setAdding] = useState(false);
  const [receive, setReceive] = useState<Row | null>(null);
  const [n, setN] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const suppliers = useOptions("suppliers", (r) => str(r, "name"));
  const warehouses = useOptions("warehouses", (r) => str(r, "name"));
  const products = useOptions("listings?limit=100", productLabel);
  const done = () => {
    setAdding(false);
    setReceive(null);
    setN((x) => x + 1);
  };
  const act = (id: string, action: string, reload: () => void) =>
    send(`purchase-orders/${id}/action`, { action })
      .then(() => {
        setError(null);
        reload();
      })
      .catch((e) => setError(err(e)));
  type Item = { id: string; quantity: number; accepted: number; listing: { sku: string; globalProduct: { name: string } } };
  return (
    <>
      {error && <p className={c.error} role="alert">{error}</p>}
      {adding && (
        <Card title="New purchase order">
          {!suppliers.length || !warehouses.length || !products.length ? <p className={ui.hint}>Add a supplier, a warehouse and a product first.</p> : (
            <Form
              fields={[{ key: "supplierId", label: "Supplier", type: "select", options: suppliers }, { key: "warehouseId", label: "Deliver to", type: "select", options: warehouses }, { key: "listingId", label: "Product", type: "select", options: products }, { key: "quantity", label: "Quantity", type: "number" }, { key: "unitCost", label: "Unit cost ₹" }, { key: "expectedOn", label: "Expected", type: "date", optional: true }, { key: "note", label: "Note", optional: true }]}
              submit={({ listingId, quantity, unitCost, ...v }) => send("purchase-orders", { ...v, items: [{ listingId, quantity, unitCost }] })}
              label="Create draft"
              onDone={done}
            />
          )}
        </Card>
      )}
      {receive && (
        <Card title={`Receive ${str(receive, "number")}`}>
          {(receive.items as Item[]).filter((i) => i.accepted < i.quantity).map((i) => (
            <div key={i.id}>
              <strong>{i.listing.globalProduct.name}</strong> · {i.quantity - i.accepted} expected
              <Form
                fields={[{ key: "accepted", label: "Accepted after quality check", type: "number" }, { key: "rejected", label: "Rejected (damaged / wrong / expired)", type: "number" }, { key: "batchNumber", label: "Batch" }, { key: "expiresOn", label: "Expires on", type: "date", optional: true }, { key: "invoiceNumber", label: "Supplier invoice", optional: true }]}
                initial={{ accepted: i.quantity - i.accepted, rejected: 0 }}
                submit={({ invoiceNumber, ...l }) => send(`purchase-orders/${receive.id}/receive`, { invoiceNumber, lines: [{ poItemId: i.id, ...l }] }, "POST", true)}
                label="Receive"
                onDone={done}
              />
            </div>
          ))}
        </Card>
      )}
      <List
        title="Purchase orders"
        path="purchase-orders"
        reloadKey={n}
        statuses={[ALL, ...["DRAFT", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"].map((x) => [x, x.toLowerCase().replace("_", " ")] as const)]}
        action={<button type="button" className={css.verify} onClick={() => setAdding(true)}>New purchase order</button>}
        head={["Number", "Supplier", "Items", "Total", "Status", ""]}
        empty="No purchase orders yet."
        row={(r, reload) => [
          str(r, "number"),
          str(r, "supplier.name"),
          (r.items as Item[]).map((i) => `${i.accepted}/${i.quantity} ${i.listing.globalProduct.name}`).join(", "),
          inr(r.total),
          str(r, "status"),
          <span key="a" className={ui.rowWrap}>
            {r.status === "DRAFT" && can("finance") && <button type="button" className={css.verify} onClick={() => void act(r.id, "APPROVE", reload)}>Approve</button>}
            {r.status === "APPROVED" && <button type="button" className={css.verify} onClick={() => void act(r.id, "ORDER", reload)}>Mark ordered</button>}
            {["ORDERED", "PARTIALLY_RECEIVED"].includes(str(r, "status")) && can("warehouse") && <button type="button" className={css.verify} onClick={() => setReceive(r)}>Receive</button>}
            {["DRAFT", "APPROVED", "ORDERED"].includes(str(r, "status")) && <button type="button" className={css.tab} onClick={() => void act(r.id, "CANCEL", reload)}>Cancel</button>}
          </span>,
        ]}
      />
    </>
  );
}

// ---------- Orders, COD, returns ----------

function Orders({ shipping }: { shipping: boolean }) {
  const [id, setId] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const list: CommerceOrderStatus[] = shipping ? ["PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERY_FAILED", "RETURN_TO_ORIGIN"] : (Object.keys(COMMERCE_STATUS_LABEL) as CommerceOrderStatus[]);
  return (
    <>
      {id && <OrderPanel key={id} id={id} onClose={() => setId(null)} onChanged={() => setN((x) => x + 1)} />}
      <List
        title={shipping ? "Shipping and delivery" : "Orders"}
        path="orders"
        reloadKey={n}
        statuses={[...(shipping ? [] : [ALL]), ...list.map((x) => [x, COMMERCE_STATUS_LABEL[x]] as const)]}
        head={["Order", "Placed", "Customer", "Deliver to", "Total", "Status", "Payment", ""]}
        empty="No orders here."
        row={(r) => [str(r, "orderNumber"), new Date(str(r, "placedAt")).toLocaleString("en-IN"), `${str(r, "contactName")} · ${str(r, "contactPhone")}`, `${str(r, "shippingAddress.city")} ${str(r, "shippingAddress.pincode")}`, inr(r.total), COMMERCE_STATUS_LABEL[r.status as CommerceOrderStatus], str(r, "paymentStatus"), <button key="o" type="button" className={css.tab} onClick={() => setId(r.id)}>Open</button>]}
      />
    </>
  );
}
function OrderPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data: o, error, load } = useLoad<CommerceOrderDto>(`orders/${id}`);
  const [ship, setShip] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!o) return <Busy error={error} />;
  const done = () => {
    setShip(false);
    load();
    onChanged();
  };
  const move = (to: CommerceOrderStatus) => {
    if (to === "SHIPPED") return setShip(true);
    const note = ["CANCELLED", "DELIVERY_FAILED", "RETURN_TO_ORIGIN"].includes(to) ? window.prompt("Reason") : "";
    if (note === null) return;
    void send(`orders/${id}/transition`, { to, ...(note ? (to === "CANCELLED" ? { note } : { note }) : {}) })
      .then(() => {
        setProblem(null);
        done();
      })
      .catch((e) => setProblem(err(e)));
  };
  const a = o.shippingAddress;
  return (
    <Card title={`${o.orderNumber} · ${o.statusLabel}`} action={<div className={ui.rowWrap}><button type="button" className={css.tab} onClick={() => window.print()}>Print packing slip</button><button type="button" className={css.tab} onClick={onClose}>Close</button></div>}>
      <div className={c.slip}>
        <p><strong>Deliver to:</strong> {a.name}, {[a.line1, a.line2, a.landmark, a.city, a.state, a.pincode].filter(Boolean).join(", ")} · {o.contactPhone}</p>
        {o.instructions && <p>Instructions: {o.instructions}</p>}
        <Table head={["Product", "SKU", "Qty", "Price", "Total"]} rows={o.items.map((i) => [i.name, i.sku, i.quantity, inr(i.unitPrice), inr(i.lineTotal)])} empty="" />
        <p>Products {inr(o.subtotal)} − discount {inr(o.discountTotal)} + delivery {inr(o.deliveryCharge)} = <strong>{inr(o.total)}</strong> · {o.paymentLabel}</p>
        <p className={ui.hint}>Packing slip only. It is not a courier label.</p>
      </div>
      {problem && <p className={c.error} role="alert">{problem}</p>}
      <div className={ui.rowWrap}>{o.allowedTransitions.map((t) => <button key={t} type="button" className={t === "CANCELLED" ? css.tab : css.verify} onClick={() => move(t)}>{COMMERCE_STATUS_LABEL[t]}</button>)}</div>
      {ship && (
        <Form
          fields={[{ key: "courier", label: "Courier (or FastQue delivery)" }, { key: "trackingNumber", label: "Tracking number", optional: true }, { key: "trackingUrl", label: "Tracking link (https)", optional: true }, { key: "weightGrams", label: "Weight (g)", type: "number", optional: true }, { key: "courierCost", label: "Courier cost ₹" }, { key: "codFee", label: "COD fee ₹" }, { key: "expectedOn", label: "Expected", type: "date", optional: true }]}
          initial={{ courierCost: "0", codFee: "0" }}
          submit={(shipment) => send(`orders/${id}/transition`, { to: "SHIPPED", shipment })}
          label="Dispatch"
          onDone={done}
        />
      )}
      <h3>History</h3>
      <Table head={["When", "Status", "Note"]} rows={o.events.map((e) => [new Date(e.at).toLocaleString("en-IN"), e.label, e.note ?? ""])} empty="" />
    </Card>
  );
}
function Cod() {
  const [entry, setEntry] = useState<Row | null>(null);
  const [n, setN] = useState(0);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error && <p className={c.error} role="alert">{error}</p>}
      {entry && (
        <Card title={`Cash for ${str(entry, "orderNumber")}`}>
          <Form
            fields={[{ key: "kind", label: "Entry", type: "select", options: [["COLLECTED", "Cash collected from customer"], ["SETTLED", "Courier settlement received"], ["ADJUSTMENT", "Adjustment (needs a second person)"]] }, { key: "amount", label: "Amount ₹ (before deductions)" }, { key: "deductions", label: "Courier deductions ₹" }, { key: "occurredOn", label: "Date", type: "date" }, { key: "reference", label: "Reference", optional: true }, { key: "note", label: "Note", optional: true }]}
            initial={{ kind: "COLLECTED", amount: str(entry, "due"), deductions: "0", occurredOn: new Date().toISOString().slice(0, 10) }}
            submit={(v) => send(`orders/${entry.id}/cod`, v, "POST", true)}
            label="Record"
            onDone={() => { setEntry(null); setN((x) => x + 1); }}
          />
        </Card>
      )}
      <List
        title="Cash on Delivery"
        path="cod"
        reloadKey={n}
        statuses={[ALL, ["COD_PENDING", "Not collected"], ["COD_COLLECTED", "Collected, unsettled"], ["PARTIALLY_SETTLED", "Partly settled"], ["SETTLEMENT_PENDING", "Waiting for sign-off"], ["RECONCILED", "Reconciled"], ["REFUNDED_OFFLINE", "Refunded"]]}
        head={["Order", "Courier", "Delivered", "Due", "Collected", "Settled", "Deductions", "Net", "Outstanding", "Status", ""]}
        empty="No delivered orders here."
        row={(r, reload) => [
          str(r, "orderNumber"),
          str(r, "courier"),
          day(r.deliveredAt),
          inr(r.due),
          inr(r.collected),
          inr(r.settled),
          inr(r.deductions),
          inr(r.netReceived),
          inr(r.outstanding),
          str(r, "paymentStatus"),
          <span key="a" className={ui.rowWrap}>
            {r.paymentStatus !== "RECONCILED" && <button type="button" className={css.tab} onClick={() => setEntry(r)}>Record</button>}
            {r.paymentStatus === "SETTLEMENT_PENDING" && <button type="button" className={css.verify} onClick={() => void send(`orders/${r.id}/reconcile`, {}).then(() => { setError(null); reload(); }).catch((e) => setError(err(e)))}>Sign off</button>}
          </span>,
        ]}
      />
    </>
  );
}
const RETURN_NEXT: Record<string, string[]> = { REQUESTED: ["APPROVED", "REJECTED"], APPROVED: ["RECEIVED", "REJECTED"], RECEIVED: ["INSPECTED"], INSPECTED: ["REFUNDED", "REPLACED"], REFUNDED: ["CLOSED"], REPLACED: ["CLOSED"] };
function Returns({ canRefund }: { canRefund: boolean }) {
  const [error, setError] = useState<string | null>(null);
  type RItem = { id: string; quantity: number; orderItem: { productName: string } };
  function act(r: Row, to: string, reload: () => void) {
    const body: Record<string, unknown> = { to };
    if (to === "REJECTED") {
      const note = window.prompt("Why? The customer sees this.");
      if (!note?.trim()) return;
      body.note = note.trim();
    }
    if (to === "INSPECTED" && r.reason !== "MISSING")
      body.dispositions = (r.items as RItem[]).map((i) => ({ returnItemId: i.id, disposition: window.confirm(`${i.quantity} × ${i.orderItem.productName}: sealed, unexpired and fit to sell again? Cancel = write off.`) ? "RESTOCK" : "DAMAGED" }));
    if (to === "REFUNDED") {
      const ref = window.prompt("Reference of the refund you paid (UPI / bank)");
      if (!ref?.trim()) return;
      body.refundReference = ref.trim();
    }
    void send(`returns/${r.id}`, body)
      .then(() => {
        setError(null);
        reload();
      })
      .catch((e) => setError(err(e)));
  }
  return (
    <>
      {error && <p className={c.error} role="alert">{error}</p>}
      <List
        title="Returns and replacements"
        path="returns"
        statuses={[ALL, ...["REQUESTED", "APPROVED", "RECEIVED", "INSPECTED", "REFUNDED", "REPLACED", "REJECTED", "CLOSED"].map((x) => [x, x.toLowerCase()] as const)]}
        head={["Return", "Order", "Products", "Reason", "Wants", "Status", ""]}
        empty="No returns."
        row={(r, reload) => [
          str(r, "number"),
          `${str(r, "order.orderNumber")} · ${str(r, "order.contactPhone")}`,
          (r.items as RItem[]).map((i) => `${i.quantity} × ${i.orderItem.productName}`).join(", "),
          `${str(r, "reason")} ${str(r, "details")}`,
          str(r, "resolution"),
          str(r, "status"),
          <span key="a" className={ui.rowWrap}>
            {(RETURN_NEXT[str(r, "status")] ?? [])
              .filter((t) => (t !== "REFUNDED" || (r.resolution === "REFUND" && canRefund)) && (t !== "REPLACED" || r.resolution === "REPLACEMENT"))
              .map((t) => <button key={t} type="button" className={css.tab} onClick={() => act(r, t, reload)}>{t.toLowerCase()}</button>)}
          </span>,
        ]}
      />
    </>
  );
}

// ---------- Insights, data quality, settings ----------

function Insights() {
  const { data, error } = useLoad<Array<{ kind: string; product: string; message: string; basis: string }>>("insights");
  if (!data) return error ? <p className={c.error}>{error.includes("not found") ? "Insights are switched off (FASTQUE_COMMERCE_AI_ENABLED)." : error}</p> : <Busy error={null} />;
  return (
    <Card title="Recommendations">
      <p className={ui.hint}>Calculated from recorded stock, sales and prices with fixed rules. Nothing is changed or ordered automatically.</p>
      <Table head={["Type", "About", "Suggestion", "Based on"]} rows={data.map((i) => [i.kind.replace("_", " "), i.product, i.message, i.basis])} empty="Nothing to suggest from the data so far." />
    </Card>
  );
}
interface QualityDto {
  counts: Record<string, number>;
  suspect: Array<{ id: string; name: string; brand: string | null; externalRef: string | null; dataSource: string }>;
}
function Quality({ canEdit }: { canEdit: boolean }) {
  const { data, error, load } = useLoad<QualityDto>("data-quality");
  const [picked, setPicked] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  if (!data) return <Busy error={error} />;
  const labels: Record<string, string> = { noSeller: "Without a seller", noImage: "Without images", noDescription: "Without description", noBarcode: "Without barcode", listedNoStock: "On sale, no stock", unapprovedSalonListings: "Salon listings to approve", expiredStillOnHand: "Expired batches on hand", markedTest: "Marked as test data" };
  function mark() {
    if (!window.confirm(`Mark ${picked.length} product(s) as test data? They disappear from the public shop, search and sitemap. Nothing is deleted and it can be undone.`)) return;
    void send("data-quality/test-data", { productIds: picked.slice(0, 200), isTestData: true })
      .then(() => {
        setPicked([]);
        load();
      })
      .catch((e) => setProblem(err(e)));
  }
  return (
    <>
      <Card title="Product data quality"><Stats items={Object.entries(data.counts).map(([k, v]) => [labels[k] ?? k, v])} /></Card>
      <Card title="Looks like sample data, but is not marked" action={canEdit && picked.length > 0 ? <button type="button" className={css.verify} onClick={mark}>Mark {picked.length} as test data</button> : null}>
        <p className={ui.hint}>Found by brand or source wording (mock, test, sample, demo). Check each one; a real brand may match.</p>
        {problem && <p className={c.error}>{problem}</p>}
        {canEdit && data.suspect.length > 0 && <button type="button" className={css.tab} onClick={() => setPicked(picked.length ? [] : data.suspect.slice(0, 200).map((x) => x.id))}>{picked.length ? "Clear" : "Select all"}</button>}
        <Table head={["", "Product", "Brand", "Reference", "Source"]} rows={data.suspect.map((p) => [canEdit ? <input key="c" type="checkbox" aria-label={`Select ${p.name}`} checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} /> : null, p.name, p.brand, p.externalRef, p.dataSource])} empty="Nothing suspicious." />
      </Card>
    </>
  );
}
function Settings() {
  const seller = useLoad<Row>("seller");
  const grants = useLoad<Array<{ userId: string; email: string | null; roles: string[]; permissions: string[] }>>("grants");
  const [saved, setSaved] = useState(0);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Card title="Seller details shown to customers">
        {!seller.data ? <Busy error={seller.error} /> : (
          <Form
            key={saved}
            fields={[{ key: "displayName", label: "Shop name" }, { key: "legalName", label: "Legal name", optional: true }, { key: "gstin", label: "GSTIN", optional: true }, { key: "address", label: "Address", optional: true }, { key: "supportEmail", label: "Support email", optional: true }, { key: "supportPhone", label: "Support phone", optional: true }, { key: "grievance", label: "Grievance officer", optional: true }, { key: "returnPolicy", label: "Return policy", optional: true }]}
            initial={seller.data}
            submit={(v) => send("seller", v, "PUT")}
            label="Save"
            onDone={() => { seller.load(); setSaved((x) => x + 1); }}
          />
        )}
        <p className={ui.hint}>Legal name, GSTIN and address are needed before documents can serve as GST tax invoices. Confirm requirements with your accountant.</p>
      </Card>
      <Card title="Staff permissions">
        {error && <p className={c.error}>{error}</p>}
        {!grants.data ? <Busy error={grants.error} /> : (
          <Table
            head={["Person", ...COMMERCE_PERMISSIONS.filter((p) => p !== "settings")]}
            rows={grants.data.map((g) => [
              `${g.email ?? g.userId} (${g.roles.join(", ")})`,
              ...COMMERCE_PERMISSIONS.filter((p) => p !== "settings").map((p) => (
                <input key={p} type="checkbox" aria-label={`${p} for ${g.email ?? g.userId}`} checked={g.permissions.includes(p)} onChange={(e) => void send("grants", { userId: g.userId, permission: p, granted: e.target.checked }, "PUT").then(() => { setError(null); grants.load(); }).catch((x) => setError(err(x)))} />
              )),
            ])}
            empty="No other internal admins. Platform admins always have every permission."
          />
        )}
      </Card>
    </>
  );
}
