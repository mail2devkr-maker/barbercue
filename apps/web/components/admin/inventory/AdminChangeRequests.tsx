"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ADMIN_PATHS,
  INVENTORY_UPLOAD_PATHS as P,
  Role,
  type CatalogChangeRequestDto,
  type InventoryPageDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import ui from "../../owner/owner.module.css";
import css from "./admin-inventory.module.css";

const BASE = `${ADMIN_PATHS.admin}/${P.changeRequests}`;

/** Owners can't edit the master catalog; they ask FastQue here and an admin resolves the request. */
export function AdminChangeRequests() {
  const { user } = useAuth();
  const canManage = !!user?.roles.some((r) => r === Role.PLATFORM_ADMIN || r === Role.CO_FOUNDER);
  const [status, setStatus] = useState<"OPEN" | "RESOLVED" | "REJECTED" | "">("OPEN");
  const [items, setItems] = useState<CatalogChangeRequestDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<InventoryPageDto<CatalogChangeRequestDto>>(`${BASE}?limit=50${status ? `&status=${status}` : ""}`)
      .then((page) => {
        setItems(page.items);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load requests."));
  }, [status]);
  useEffect(load, [load]);

  async function resolve(r: CatalogChangeRequestDto, next: "RESOLVED" | "REJECTED") {
    const note = window.prompt(next === "RESOLVED" ? "What was changed? (optional)" : "Why is this request declined?") ?? undefined;
    if (next === "REJECTED" && !note?.trim()) return;
    try {
      await apiFetch(`${BASE}/${r.id}`, { method: "PATCH", body: JSON.stringify({ status: next, ...(note?.trim() ? { note: note.trim() } : {}) }) });
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not go through.");
    }
  }

  return (
    <main className={ui.grid} aria-labelledby="cr-title">
      <div className={ui.pageHead}>
        <div>
          <div className={ui.eyebrow}>Inventory Management</div>
          <h1 id="cr-title" className={ui.pageTitle}>Owner change requests</h1>
          <p className={ui.pageSub}>Corrections salon owners asked for on master products (owners cannot edit the shared catalog). Make the change in Product Master, then mark the request resolved.</p>
        </div>
      </div>
      <section className={ui.card} aria-label="Requests">
        <div className={ui.rowWrap}>
          {(["OPEN", "RESOLVED", "REJECTED", ""] as const).map((s) => (
            <button key={s || "all"} type="button" className={`${css.tab} ${status === s ? css.tabOn : ""}`} onClick={() => setStatus(s)}>
              {s === "" ? "All" : s === "OPEN" ? "Open" : s === "RESOLVED" ? "Resolved" : "Declined"}
            </button>
          ))}
        </div>
        {error && <p className={`${ui.banner} ${ui.bannerError}`} role="alert">{error}</p>}
        {!items ? (
          <div className={`${ui.skeleton} ${css.skeletonSmall}`} />
        ) : items.length === 0 ? (
          <p className={ui.hint}>No requests here.</p>
        ) : (
          <ul className={css.products}>
            {items.map((r) => (
              <li key={r.id} className={css.productRow} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                <div className={css.productInfo}>
                  <strong>{r.product ? r.product.name : `Barcode ${r.barcode}`}</strong>
                  <span className={ui.cardSub}>
                    {r.salon.name} · {new Date(r.createdAt).toLocaleString()}
                    {r.product?.barcode ? ` · barcode ${r.product.barcode}` : ""}
                  </span>
                  <span>{r.message}</span>
                  {r.proposedFields && Object.keys(r.proposedFields).length > 0 && (
                    <span className={ui.cardSub}>Suggested: {Object.entries(r.proposedFields).map(([k, v]) => `${k} → ${v}`).join(" · ")}</span>
                  )}
                  {r.resolutionNote && <span className={ui.cardSub}>Note: {r.resolutionNote}</span>}
                </div>
                <div className={css.rowActions}>
                  <span className={`${css.status} ${r.status === "OPEN" ? css.statusPENDING : r.status === "RESOLVED" ? css.statusVERIFIED : css.statusREJECTED}`}>{r.status.toLowerCase()}</span>
                  {canManage && r.status === "OPEN" && (
                    <>
                      <button type="button" className={css.verify} onClick={() => void resolve(r, "RESOLVED")}>Mark resolved</button>
                      <button type="button" className={ui.cardLink} onClick={() => void resolve(r, "REJECTED")}>Decline</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
