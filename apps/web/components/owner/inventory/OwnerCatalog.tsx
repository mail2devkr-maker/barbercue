"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  CATALOG_PATHS,
  INVENTORY_UPLOAD_PATHS as P,
  type CatalogChangeRequestDto,
  type InventoryPageDto,
  type OwnerCatalogProductDto,
  type OwnerInventorySummaryDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../lib/api";
import { inventoryBase } from "../../../lib/use-inventory-lookups";
import { moneyText, quantityText } from "../../../lib/inventory";
import { ProductCodes, productIdFromQr } from "../../inventory/ProductCodes";
import { Badge, Banner, Btn, Card, Dialog, Field, Kpi, Skeleton } from "../parts";
import { BarcodeScanner } from "./BarcodeScanner";
import ui from "../owner.module.css";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message || fallback : fallback);
const TYPE_LABEL: Record<string, string> = {
  STOCK_IN: "Stock in",
  STOCK_OUT: "Stock out",
  SERVICE_CONSUMPTION: "Used in service",
  ADJUSTMENT: "Count adjustment",
  RETURN: "Returned",
  DAMAGE: "Damaged",
  EXPIRY: "Expired",
};

/**
 * Owner → Inventory → Product catalog. The FastQue master list (global products plus this shop's
 * own products) — search, scan a barcode or a FastQue QR, and add a product to the shop's inventory
 * with zero stock. Owners never edit the master; they send FastQue a correction request instead.
 */
export function OwnerCatalog({ salonId }: { salonId: string }) {
  const base = `${inventoryBase(salonId)}/${CATALOG_PATHS.catalog}`;
  const [summary, setSummary] = useState<OwnerInventorySummaryDto | null>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);
  const [items, setItems] = useState<OwnerCatalogProductDto[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<OwnerCatalogProductDto | null>(null);
  const [requesting, setRequesting] = useState<{ product: OwnerCatalogProductDto | null; barcode: string | null } | null>(null);
  const [codesFor, setCodesFor] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [requests, setRequests] = useState<CatalogChangeRequestDto[]>([]);

  const loadSummary = useCallback(() => {
    apiFetch<OwnerInventorySummaryDto>(`${inventoryBase(salonId)}/${P.ownerSummary}`).then(setSummary).catch(() => undefined);
    apiFetch<CatalogChangeRequestDto[]>(`${base}/${P.ownerChangeRequests}`).then(setRequests).catch(() => undefined);
  }, [salonId, base]);

  const load = useCallback(
    async (after: string | null) => {
      const query = new URLSearchParams({ limit: "30", ...(q.trim() ? { q: q.trim() } : {}), ...(category ? { category } : {}), ...(onlyNew ? { notInInventory: "true" } : {}), ...(after ? { cursor: after } : {}) });
      try {
        const page = await apiFetch<InventoryPageDto<OwnerCatalogProductDto> & { categories: string[] }>(`${base}/${P.browse}?${query}`);
        setItems((prev) => (after && prev ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setCategories(page.categories);
        setError(null);
      } catch (err) {
        setError(errorText(err, "Could not load the catalog."));
      }
    },
    [base, q, category, onlyNew],
  );

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);
  useEffect(() => {
    const t = setTimeout(() => void load(null), 250);
    return () => clearTimeout(t);
  }, [load]);

  const scanned = q.trim();
  const looksLikeCode = /^\d{8,14}$/.test(scanned) || !!productIdFromQr(scanned);

  return (
    <div className={ui.grid}>
      {summary && (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
          <Kpi label="Active products" value={summary.activeProducts} icon="tag" />
          <Kpi label="Low stock" value={summary.lowStock} icon="alert" tone={summary.lowStock ? "warn" : undefined} href={`/dashboard/salons/${salonId}/inventory/low-stock`} />
          <Kpi label="Out of stock" value={summary.outOfStock} icon="alert" tone={summary.outOfStock ? "warn" : undefined} />
          <Kpi label="Stock value" value={moneyText(summary.stockValue, "INR")} icon="rupee" foot="at average cost" />
          <Kpi label="From FastQue catalog" value={summary.catalogLinked} icon="store" tone="info" />
        </div>
      )}

      <Card
        title="FastQue product catalog"
        sub="Products every FastQue shop can use, plus products FastQue set up only for your shop. Adding one puts it in your inventory with zero stock — then record stock in, usage and counts as usual."
        action={<Btn small onClick={() => setScanning((s) => !s)}>{scanning ? "Close scanner" : "Scan barcode"}</Btn>}
      >
        {scanning && (
          <div className={ui.mt12}>
            <BarcodeScanner
              busy={false}
              onDetected={(code) => {
                setQ(code);
                setScanning(false);
              }}
            />
          </div>
        )}
        <div className={ui.rowWrap} style={{ marginTop: 12 }}>
          <input className={ui.input} style={{ maxWidth: 320 }} placeholder="Search name, brand or barcode" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the catalog" />
          <select className={ui.input} style={{ maxWidth: 220 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> Not in my inventory yet
          </label>
        </div>
        {error && <div className={ui.mt12}><Banner tone="error">{error}</Banner></div>}
        {notice && <div className={ui.mt12} role="status"><Banner tone="ok">{notice}</Banner></div>}
        {!items ? (
          <div className={ui.mt12}><Skeleton height={160} /></div>
        ) : items.length === 0 ? (
          <div className={ui.mt12}>
            {looksLikeCode ? (
              <Banner tone="warn">
                <strong>Product not found.</strong> No FastQue catalog product has {productIdFromQr(scanned) ? "this QR code" : `barcode ${scanned}`}.{" "}
                <a href={`/dashboard/salons/${salonId}/inventory/scan`}>Add it from Scan / Add stock</a> (it stays with your shop until FastQue verifies it), or{" "}
                <button type="button" className={ui.cardLink} onClick={() => setRequesting({ product: null, barcode: scanned })}>ask FastQue to add it</button>.
              </Banner>
            ) : (
              <p className={ui.hint}>No catalog products match.</p>
            )}
          </div>
        ) : (
          <div className={`${ui.tableWrap} ${ui.mt12}`}>
            <table className={ui.table}>
              <thead>
                <tr><th>Product</th><th>Category</th><th>Barcode</th><th>Size</th><th>In my inventory</th><th><span className={ui.srOnly}>Actions</span></th></tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <Fragment key={p.id}>
                    <tr>
                      <td>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <span style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", display: "grid", placeItems: "center", background: "rgba(127,127,127,.12)", flex: "0 0 auto" }}>
                            {p.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- catalog photos are arbitrary URLs
                              <img src={p.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                              <span aria-hidden="true">📦</span>
                            )}
                          </span>
                          <div>
                            <strong>{p.name}</strong>
                            <div className={ui.cardSub}>
                              {p.brand ?? ""} {p.visibility === "SHOP" && <Badge tone="info">Your shop only</Badge>} {p.isTestData && <Badge tone="warn">Test data</Badge>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>{[p.category, p.subcategory].filter(Boolean).join(" › ") || "—"}</td>
                      <td>{p.barcodes.map((b) => b.display).join(", ") || "—"}</td>
                      <td>{p.variant ?? (p.packSize && p.packUnit ? quantityText(p.packSize, p.packUnit) : "—")}</td>
                      <td>
                        {p.inMyInventory.length === 0
                          ? <Badge>Not added</Badge>
                          : p.inMyInventory.map((i) => (
                              <div key={i.inventoryProductId}>
                                <Badge tone="ok">{i.usage === "RETAIL" ? "Retail" : "Professional"}</Badge> {Number(i.stockOnHand)} in stock
                              </div>
                            ))}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Btn small variant={p.inMyInventory.length ? "secondary" : "primary"} onClick={() => setAdding(p)}>{p.inMyInventory.length ? "Add other shelf" : "Add to my inventory"}</Btn>{" "}
                        <button type="button" className={ui.cardLink} onClick={() => setCodesFor(codesFor === p.id ? null : p.id)} aria-expanded={codesFor === p.id}>Codes</button>{" "}
                        <button type="button" className={ui.cardLink} onClick={() => setRequesting({ product: p, barcode: p.barcodes[0]?.display ?? null })}>Report a mistake</button>
                      </td>
                    </tr>
                    {codesFor === p.id && (
                      <tr>
                        <td colSpan={6}><ProductCodes productId={p.id} barcodes={p.barcodes} /></td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cursor && <div className={ui.mt12}><Btn onClick={() => void load(cursor)}>Load more</Btn></div>}
      </Card>

      {summary && (
        <Card title="Recent stock entries" sub="Every stock change is a recorded entry; quantities never change silently.">
          {summary.recentTransactions.length === 0 ? (
            <p className={ui.hint}>No stock entries yet.</p>
          ) : (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead><tr><th>When</th><th>Product</th><th>Type</th><th className={ui.num}>Change</th><th className={ui.num}>Stock after</th></tr></thead>
                <tbody>
                  {summary.recentTransactions.map((t) => (
                    <tr key={t.id}>
                      <td>{new Date(t.recordedAt).toLocaleString()}</td>
                      <td>{t.productName}</td>
                      <td>{TYPE_LABEL[t.transactionType] ?? t.transactionType}</td>
                      <td className={ui.num}>{Number(t.quantityDelta) > 0 ? "+" : ""}{Number(t.quantityDelta)}</td>
                      <td className={ui.num}>{Number(t.stockAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {summary.consumption30d.length > 0 && (
            <p className={ui.hint} style={{ marginTop: 10 }}>
              Used in services (30 days): {summary.consumption30d.map((c) => `${c.productName} ${quantityText(c.quantity, c.unit)}`).join(" · ")}
            </p>
          )}
        </Card>
      )}

      {requests.length > 0 && (
        <Card title="My correction requests">
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            {requests.map((r) => (
              <li key={r.id}>
                <strong>{r.product?.name ?? `Barcode ${r.barcode}`}</strong> — {r.message} <Badge tone={r.status === "OPEN" ? "warn" : r.status === "RESOLVED" ? "ok" : "neutral"}>{r.status.toLowerCase()}</Badge>
                {r.resolutionNote && <div className={ui.cardSub}>FastQue: {r.resolutionNote}</div>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {adding && (
        <AddDialog
          base={base}
          product={adding}
          onClose={() => setAdding(null)}
          onAdded={(created) => {
            setNotice(created ? `"${adding.name}" is now in your inventory with 0 in stock. Record stock in from Scan / Add stock or Purchases.` : `"${adding.name}" was already in your inventory on that shelf.`);
            setAdding(null);
            void load(null);
            loadSummary();
          }}
        />
      )}
      {requesting && (
        <RequestDialog
          base={base}
          product={requesting.product}
          barcode={requesting.barcode}
          onClose={() => setRequesting(null)}
          onSent={() => {
            setNotice("Thanks — FastQue will review your request.");
            setRequesting(null);
            loadSummary();
          }}
        />
      )}
    </div>
  );
}

function AddDialog({ base, product, onClose, onAdded }: { base: string; product: OwnerCatalogProductDto; onClose: () => void; onAdded: (created: boolean) => void }) {
  const taken = new Set(product.inMyInventory.map((i) => i.usage));
  const [usage, setUsage] = useState<"PROFESSIONAL" | "RETAIL">(taken.has("PROFESSIONAL") ? "RETAIL" : "PROFESSIONAL");
  const [sellingPrice, setSellingPrice] = useState("");
  const [minStock, setMinStock] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    const price = sellingPrice.trim() ? Number(sellingPrice) : null;
    const min = minStock.trim() ? Number(minStock) : undefined;
    if ((price !== null && !(price >= 0)) || (min !== undefined && !(min >= 0))) return setError("Prices and minimum stock must be 0 or more.");
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ created: boolean }>(`${base}/${P.add}`, {
        method: "POST",
        body: JSON.stringify({ globalProductId: product.id, usage, ...(price !== null ? { sellingPrice: Math.round(price * 100) / 100 } : {}), ...(min !== undefined ? { reorderThreshold: Math.round(min * 1000) / 1000 } : {}) }),
      });
      onAdded(r.created);
    } catch (err) {
      setError(errorText(err, "Could not add the product."));
      setBusy(false);
    }
  }
  return (
    <Dialog title={`Add ${product.name}`} onClose={onClose}>
      <div className={ui.grid}>
        <Field label="Used for">
          <select className={ui.input} value={usage} onChange={(e) => setUsage(e.target.value as "PROFESSIONAL" | "RETAIL")}>
            <option value="PROFESSIONAL" disabled={taken.has("PROFESSIONAL")}>Services (professional use)</option>
            <option value="RETAIL" disabled={taken.has("RETAIL")}>Selling to customers (retail)</option>
          </select>
        </Field>
        <Field label="Selling price (₹, optional)">
          <input className={ui.input} inputMode="decimal" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} />
        </Field>
        <Field label="Warn me when stock is at or below (optional)">
          <input className={ui.input} inputMode="decimal" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
        </Field>
        <p className={ui.hint}>Starts with 0 in stock. Cost and quantity come from your stock-in entries.</p>
        {error && <Banner tone="error">{error}</Banner>}
        <div className={ui.rowWrap}>
          <Btn variant="primary" onClick={() => void submit()} disabled={busy}>{busy ? "Adding…" : "Add to my inventory"}</Btn>
          <Btn onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Dialog>
  );
}

function RequestDialog({ base, product, barcode, onClose, onSent }: { base: string; product: OwnerCatalogProductDto | null; barcode: string | null; onClose: () => void; onSent: () => void }) {
  const [message, setMessage] = useState(product ? "" : `Please add the product with barcode ${barcode ?? ""} to the FastQue catalog.`);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (message.trim().length < 5) return setError("Tell FastQue what needs changing.");
    setBusy(true);
    try {
      await apiFetch(`${base}/${P.ownerChangeRequests}`, {
        method: "POST",
        body: JSON.stringify({
          ...(product ? { globalProductId: product.id } : {}),
          ...(barcode ? { barcode } : {}),
          message: message.trim(),
          ...(name.trim() ? { proposedFields: { name: name.trim() } } : {}),
        }),
      });
      onSent();
    } catch (err) {
      setError(errorText(err, "Could not send the request."));
      setBusy(false);
    }
  }
  return (
    <Dialog title={product ? `Report a mistake: ${product.name}` : "Ask FastQue to add a product"} onClose={onClose}>
      <div className={ui.grid}>
        <p className={ui.hint}>The shared catalog is maintained by FastQue, so shops cannot edit it directly.</p>
        <Field label={product ? "What is wrong?" : "Product details"}>
          <textarea className={ui.input} rows={4} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <Field label="Correct product name (optional)">
          <input className={ui.input} maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {error && <Banner tone="error">{error}</Banner>}
        <div className={ui.rowWrap}>
          <Btn variant="primary" onClick={() => void submit()} disabled={busy}>{busy ? "Sending…" : "Send to FastQue"}</Btn>
          <Btn onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Dialog>
  );
}
