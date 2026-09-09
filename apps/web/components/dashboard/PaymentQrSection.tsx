"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_PATHS, salonPhotoUrlSchema, setSalonUpiSchema } from "@barbercue/shared";
import type { SalonPaymentQrDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import styles from "./dashboard.module.css";

/**
 * FastQue Credits / Wallet V1 — owner-facing counterpart to BookingErrorCode.PAYMENT_QR_REQUIRED:
 * BookingsService.create refuses to create an ONLINE (APP/WEB-sourced) booking at a salon with no
 * QR configured here. WALK_IN bookings are never gated, so a shop that only serves walk-ins can
 * ignore this entirely — the banner below only warns, it never blocks anything on its own.
 *
 * Extracted from the settings page (Part 1, shop-onboarding mission) so the exact same component —
 * same GET/PUT/upload/DELETE calls against SalonPaymentQrService, same validation, same storage —
 * can also be rendered as its own setup-wizard step (see the payment-qr route) without duplicating
 * any of this logic. Nothing about the component's own behavior changed in the extraction.
 */
export function PaymentQrSection({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.paymentQr}`;
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [linkUrl, setLinkUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [upiVpa, setUpiVpa] = useState("");
  const [upiPayeeName, setUpiPayeeName] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<SalonPaymentQrDto>(base)
      .then((result) => {
        if (!cancelled) {
          setCurrent(result.paymentQrImageUrl);
          setUpiVpa(result.upiVpa ?? "");
          setUpiPayeeName(result.upiPayeeName ?? "");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load your payment QR.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salonId]);

  async function saveLink() {
    const parsed = salonPhotoUrlSchema.safeParse(linkUrl.trim());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the QR image link.");
      return;
    }
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const result = await apiFetch<SalonPaymentQrDto>(base, {
        method: "PUT",
        body: JSON.stringify({ url: parsed.data }),
      });
      setCurrent(result.paymentQrImageUrl);
      setLinkUrl("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the payment QR.");
    } finally {
      setSaving(false);
    }
  }

  async function saveUpi() {
    const parsed = setSalonUpiSchema.safeParse({ upiVpa, upiPayeeName });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setError(null); setSaved(false); setSaving(true);
    try {
      const result = await apiFetch<SalonPaymentQrDto>(base, { method: "PATCH", body: JSON.stringify(parsed.data) });
      setUpiVpa(result.upiVpa ?? ""); setUpiPayeeName(result.upiPayeeName ?? ""); setSaved(true);
    } catch (err) { setError(err instanceof ApiError ? err.message : "Could not save UPI details."); }
    finally { setSaving(false); }
  }

  async function uploadFile() {
    if (!file) {
      setError("Please choose a QR code image to upload.");
      return;
    }
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const result = await apiFetch<SalonPaymentQrDto>(`${base}/${DASHBOARD_PATHS.photoUpload}`, {
        method: "POST",
        body: form,
      });
      setCurrent(result.paymentQrImageUrl);
      setFile(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload the payment QR.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setError(null);
    setSaved(false);
    setRemoving(true);
    try {
      await apiFetch(base, { method: "DELETE" });
      setCurrent(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the payment QR.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className={styles.dividerSection}>
      <h2 className={styles.sectionHeading}>Payment QR</h2>
      <p style={{ color: "var(--bc-muted)", fontSize: 14, marginBottom: 12 }}>
        Shown to a customer paying for a booking made through the app or website, so they can scan
        and pay you directly. Required before a customer can book online at all — a booking made in
        person at your shop never needs this.
      </p>
      {error && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</p>}
      {current === undefined && !error && <p className={styles.loadingText}>Loading…</p>}
      {current !== undefined && (
        <>
          <fieldset disabled={saving} style={{ display: "grid", gap: 8, minWidth: 0, marginBottom: 16 }}>
            <legend>Optional direct UPI payment</legend>
            <p>Enter the UPI ID belonging to the same account as your QR, and its business/payee name. Verify both carefully. Leave UPI ID blank for QR-only payment.</p>
            <label htmlFor="shop-upi-vpa">UPI ID / VPA</label>
            <input id="shop-upi-vpa" value={upiVpa} maxLength={255} autoCapitalize="none" spellCheck={false} placeholder="merchant@bank"
              onChange={(e) => { setUpiVpa(e.target.value); setSaved(false); }} style={{ minWidth: 0, padding: 10 }} />
            <label htmlFor="shop-upi-payee">UPI payee / business name</label>
            <input id="shop-upi-payee" value={upiPayeeName} maxLength={100}
              onChange={(e) => { setUpiPayeeName(e.target.value); setSaved(false); }} style={{ minWidth: 0, padding: 10 }} />
            <Button type="button" onClick={() => void saveUpi()}>Save UPI details</Button>
          </fieldset>
          {current ? (
            <div style={{ marginBottom: 14 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- an owner-linked or uploaded
                  QR image, same reasoning as SalonPhotosService's own external-URL contract. */}
              <img
                src={current}
                alt="Your shop's payment QR code"
                style={{ width: 160, height: 160, objectFit: "contain", border: "1px solid var(--bc-border)", borderRadius: 8, background: "#fff" }}
              />
              <div style={{ marginTop: 8 }}>
                <Button type="button" variant="outline" onClick={() => void remove()} disabled={removing}>
                  {removing ? "Removing…" : "Remove QR code"}
                </Button>
              </div>
            </div>
          ) : (
            <p style={{ color: "#B36B00", fontSize: 14, marginBottom: 12 }}>
              No payment QR configured yet — online bookings are blocked at this shop until you add
              one.
            </p>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <input
              type="url"
              placeholder="https://example.com/my-upi-qr.png"
              value={linkUrl}
              onChange={(e) => {
                setLinkUrl(e.target.value);
                setSaved(false);
              }}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--bc-border)", minWidth: 280, flex: 1 }}
            />
            <Button type="button" variant="secondary" onClick={() => void saveLink()} disabled={saving || !linkUrl.trim()}>
              {saving ? "Saving…" : "Link QR code image"}
            </Button>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setSaved(false);
              }}
            />
            <Button type="button" variant="secondary" onClick={() => void uploadFile()} disabled={saving || !file}>
              {saving ? "Saving…" : "Upload QR code"}
            </Button>
          </div>

          {saved && (
            <p role="status" style={{ color: "var(--bc-success)", fontSize: 13, marginTop: 8 }}>
              Saved.
            </p>
          )}
        </>
      )}
    </section>
  );
}
