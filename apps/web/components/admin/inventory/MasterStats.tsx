"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ADMIN_PATHS, INVENTORY_UPLOAD_PATHS as P, type InventoryMasterStatsDto } from "@barbercue/shared";
import { apiFetch } from "../../../lib/api";
import ui from "../../owner/owner.module.css";
import css from "./admin-inventory.module.css";

/** Inventory master statistics: catalog size, global vs shop-only, data gaps and upload health. */
export function MasterStats() {
  const [data, setData] = useState<InventoryMasterStatsDto | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    apiFetch<InventoryMasterStatsDto>(`${ADMIN_PATHS.admin}/${P.masterStats}`)
      .then((d) => (typeof d?.totalProducts === "number" ? setData(d) : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);
  if (failed) return null;
  if (!data) return <div className={`${ui.skeleton} ${css.skeletonSmall}`} />;
  const tiles: Array<[string, number, string?]> = [
    ["Master products", data.totalProducts, "/dashboard/admin/inventory/catalog?status="],
    ["Global products", data.globalProducts, "/dashboard/admin/inventory/catalog?status=VERIFIED&visibility=GLOBAL"],
    ["Shop-specific products", data.shopProducts, "/dashboard/admin/inventory/catalog?status=&visibility=SHOP"],
    ["Test-data products", data.testDataProducts, "/dashboard/admin/inventory/catalog?status=&testData=true"],
    ["Awaiting review", data.pendingReview, "/dashboard/admin/inventory/catalog?status=PENDING"],
    ["Missing barcodes", data.missingBarcodes, "/dashboard/admin/inventory/catalog?status=&missingBarcode=true"],
    ["Salons using inventory", data.salonsUsingInventory],
    ["Failed uploads", data.failedUploads, "/dashboard/admin/inventory/uploads"],
    ["Pending uploads", data.pendingUploads, "/dashboard/admin/inventory/uploads"],
    ["Open change requests", data.openChangeRequests, "/dashboard/admin/inventory/change-requests"],
  ];
  return (
    <section className={ui.card} aria-label="Master catalog statistics">
      <div className={ui.cardHead}>
        <div>
          <h2 className={ui.cardTitle}>Product master</h2>
          <div className={ui.cardSub}>The shared FastQue catalog and its uploads.</div>
        </div>
        <Link className={css.verify} style={{ display: "inline-flex", alignItems: "center" }} href="/dashboard/admin/inventory/upload">Upload Product Database</Link>
      </div>
      <div className={css.summaryGrid} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
        {tiles.map(([label, value, href]) =>
          href ? (
            <Link key={label} href={href} className={css.stat} style={{ color: "inherit", textDecoration: "none" }}>
              <span className={css.statValue}>{value}</span>
              <span className={css.statLabel}>{label}</span>
            </Link>
          ) : (
            <div key={label} className={css.stat}>
              <span className={css.statValue}>{value}</span>
              <span className={css.statLabel}>{label}</span>
            </div>
          ),
        )}
      </div>
      {data.recentImports.length > 0 && (
        <>
          <h3 className={ui.cardTitle} style={{ marginTop: 14, fontSize: "0.95rem" }}>Recent imports</h3>
          <ul className={css.top}>
            {data.recentImports.map((j) => (
              <li key={j.id}>
                <span>{j.fileName} <small>· {new Date(j.createdAt).toLocaleString()}</small></span>
                <small>{j.status.toLowerCase().replace(/_/g, " ")} · {j.createdCount} created · {j.linkedCount} shop links</small>
              </li>
            ))}
          </ul>
        </>
      )}
      {data.categories.length > 0 && (
        <p className={ui.hint} style={{ marginTop: 10 }}>Categories: {data.categories.map((c) => `${c.category} (${c.products})`).join(" · ")}</p>
      )}
    </section>
  );
}
