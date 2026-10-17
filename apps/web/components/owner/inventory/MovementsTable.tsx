"use client";

import type { InventoryMovementDto } from "@barbercue/shared";
import { kindLabel, moneyText, movementTone, signedQuantity, trimDecimal } from "../../../lib/inventory";
import { Badge, EmptyState } from "../parts";
import ui from "../owner.module.css";

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * The stock ledger as the server recorded it. Every figure (change, cost, balance after) is the server's string; nothing here is
 * recalculated, and an entry that was recorded is never edited.
 */
export function MovementsTable({ items, currency, emptyTitle = "No stock movements yet", showProduct = true }: { items: InventoryMovementDto[]; currency: string | null; emptyTitle?: string; showProduct?: boolean }) {
  if (items.length === 0) return <EmptyState title={emptyTitle}>Entries appear here as soon as stock is recorded.</EmptyState>;
  return (
    <div className={ui.tableWrap}>
      <table className={ui.table}>
        <caption className={ui.cardSub}>Newest first, in your device&apos;s time</caption>
        <thead>
          <tr>
            <th>When</th>
            {showProduct && <th>Product</th>}
            <th>Type</th>
            <th className={ui.num}>Change</th>
            <th className={ui.num}>Cost each</th>
            <th className={ui.num}>Stock after</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id}>
              <td title={m.recordedAt}>{when(m.recordedAt)}</td>
              {showProduct && <td>{m.productName}{m.sku ? <span className={ui.cardSub}> ({m.sku})</span> : null}</td>}
              <td><Badge tone={movementTone(m.kind, m.quantityDelta)}>{kindLabel(m.kind)}</Badge></td>
              <td className={ui.num}>{signedQuantity(m.quantityDelta)}</td>
              <td className={ui.num}>{m.unitCost === null ? "—" : moneyText(m.unitCost, currency)}</td>
              <td className={ui.num}>{trimDecimal(m.stockAfter)}</td>
              <td className={ui.cardSub}>
                {[m.supplier?.name, m.reason, m.reference ? `Ref ${m.reference}` : null].filter(Boolean).join(" · ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
