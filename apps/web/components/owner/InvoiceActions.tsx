"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { InvoiceDetailDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { Btn, BtnLink } from "./parts";
import ui from "./owner.module.css";

/**
 * "Create invoice" / "View invoice" for ONE completed visit (a booking, or a standalone Live Queue
 * visit). It first asks whether an invoice already exists, so the button is honest about what a click
 * will do; issuing is idempotent on the server, so a double-click can never create two. If the shop
 * has not set up its business profile yet, the error explains exactly where to do that.
 */
export function InvoiceAction({
  salonId,
  bookingId,
  queueEntryId,
  small = true,
}: {
  salonId: string;
  bookingId?: string | null;
  queueEntryId?: string | null;
  small?: boolean;
}) {
  const router = useRouter();
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const sourceQuery = bookingId ? `bookingId=${bookingId}` : `queueEntryId=${queueEntryId}`;
  const [existing, setExisting] = useState<InvoiceDetailDto | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; needsProfile: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<InvoiceDetailDto | null>(`${base}/invoices/by-source?${sourceQuery}`)
      .then((inv) => !cancelled && setExisting(inv))
      .catch(() => !cancelled && setExisting(null));
    return () => {
      cancelled = true;
    };
  }, [base, sourceQuery]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const inv = await apiFetch<InvoiceDetailDto>(`${base}/invoices`, {
        method: "POST",
        headers: { "Idempotency-Key": newIdempotencyKey() },
        body: JSON.stringify(bookingId ? { bookingId } : { queueEntryId }),
      });
      setExisting(inv);
      router.push(`/dashboard/salons/${salonId}/invoices?open=${inv.id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not create the invoice.";
      setError({ message, needsProfile: err instanceof ApiError && (err.code === "BILLING_PROFILE_REQUIRED" || err.code === "BILLING_TAX_NOT_CONFIGURED") });
    } finally {
      setBusy(false);
    }
  }

  if (existing === undefined) return null;
  return (
    <>
      {existing ? (
        <BtnLink small={small} href={`/dashboard/salons/${salonId}/invoices?open=${existing.id}`} icon="receipt">
          Invoice {existing.number}
        </BtnLink>
      ) : (
        <Btn small={small} icon="receipt" disabled={busy} onClick={() => void create()}>
          {busy ? "Creating…" : "Create invoice"}
        </Btn>
      )}
      {error && (
        <span className={ui.hint} role="alert" style={{ color: "var(--os-bad-ink)", fontWeight: 600 }}>
          {error.message}{" "}
          {error.needsProfile && (
            <Link href={`/dashboard/salons/${salonId}/invoices?tab=billing`} style={{ color: "inherit", textDecoration: "underline" }}>
              Open billing settings
            </Link>
          )}
        </span>
      )}
    </>
  );
}
