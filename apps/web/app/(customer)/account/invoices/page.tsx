"use client";

import { useEffect, useState } from "react";
import type { InvoiceListDto, InvoiceSummaryDto } from "@barbercue/shared";
import { apiFetch, apiFetchBlob, ApiError } from "../../../../lib/api";
import { Card } from "../../../../components/ui/Card";
import { Button } from "../../../../components/ui/Button";
import { formatMoney, triggerBlobDownload } from "../../../../components/owner/format";
import styles from "../bookings/bookings.module.css";

const STATUS: Record<string, string> = { UNPAID: "Unpaid", PARTIALLY_PAID: "Partly paid", PAID: "Paid", REFUNDED: "Refunded" };

// A customer's own invoices: only invoices issued to THEIR account for their own completed
// services. The API filters by the signed-in user, so another customer's invoice can never be
// listed or downloaded from here. "Paid" is what the shop recorded; it is not a payment receipt
// from FastQue.
export default function MyInvoicesPage() {
  const [items, setItems] = useState<InvoiceSummaryDto[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load(cursor?: string) {
    return apiFetch<InvoiceListDto>(`invoices/mine${cursor ? `?cursor=${cursor}` : ""}`)
      .then((page) => {
        setItems((cur) => (cursor && cur ? [...cur, ...page.items] : page.items));
        setNext(page.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your invoices."));
  }
  useEffect(() => {
    void load();
  }, []);

  async function download(invoice: InvoiceSummaryDto) {
    setBusyId(invoice.id);
    setError(null);
    try {
      const { blob, filename } = await apiFetchBlob(`invoices/mine/${invoice.id}/pdf`);
      triggerBlobDownload(blob, filename ?? `${invoice.number}.pdf`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not download this invoice.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 style={{ margin: "0 0 4px" }}>Invoices</h1>
      <p style={{ margin: "0 0 16px", color: "var(--bc-muted)" }}>Invoices shops have issued to you for completed services.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {items === null && !error && <p>Loading…</p>}
      {items && items.length === 0 && <Card><p>No invoices yet. A shop issues one after your service is complete.</p></Card>}
      {items?.map((inv) => (
        <Card key={inv.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <strong>{inv.number}</strong>
              <div style={{ color: "var(--bc-muted)", fontSize: 14 }}>
                {new Date(inv.issuedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · {STATUS[inv.paymentStatus] ?? inv.paymentStatus}
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <strong>{formatMoney(inv.total, inv.currency)}</strong>
              <Button type="button" variant="outline" disabled={busyId === inv.id} onClick={() => void download(inv)}>
                {busyId === inv.id ? "Preparing…" : "Download PDF"}
              </Button>
            </div>
          </div>
        </Card>
      ))}
      {next && <Button type="button" variant="outline" onClick={() => void load(next)}>Load more</Button>}
    </div>
  );
}
