"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OwnerOverviewDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Icon, type IconName } from "./icons";
import { Banner, Card } from "./parts";
import ui from "./owner.module.css";

const LINKS: ReadonlyArray<{ path: string; label: string; sub: string; icon: IconName }> = [
  { path: "services", label: "Manage services", sub: "Names, prices and durations", icon: "tag" },
  { path: "staff", label: "Manage staff", sub: "Invite barbers, hours, access", icon: "team" },
  { path: "chairs", label: "Manage chairs", sub: "Seats available for customers", icon: "chair" },
  { path: "hours", label: "Working hours", sub: "When customers can book", icon: "clock" },
  { path: "payment-qr", label: "Online Booking Payment QR", sub: "Optional — lets online customers pay you directly", icon: "qr" },
  { path: "invoices?tab=billing", label: "Billing profile", sub: "Business name, tax and invoice numbers", icon: "receipt" },
  { path: "photos", label: "Shop photos", sub: "Cover and gallery", icon: "store" },
  { path: "verification", label: "Verification", sub: "Show customers your shop is reviewed", icon: "check" },
];

/**
 * Real, working shop controls: the customer-facing phone visibility, plus links to every setup
 * area. (There is no booking-policy editor in FastQue yet - the platform's default cancellation
 * policy applies - so none is offered rather than showing a control that does nothing.)
 */
export function ShopControls({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const [showPhone, setShowPhone] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch<OwnerOverviewDto>(`${base}/overview`)
      .then((o) => setShowPhone(o.settings.showPhoneToCustomers))
      .catch(() => setShowPhone(null));
  }, [base]);

  async function toggle() {
    if (showPhone === null) return;
    setError(null);
    setSaved(false);
    const next = !showPhone;
    try {
      await apiFetch(`${base}/contact-visibility`, { method: "PATCH", body: JSON.stringify({ showPhoneToCustomers: next }) });
      setShowPhone(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this setting.");
    }
  }

  return (
    <div className={ui.stackSm} style={{ marginTop: 18 }}>
      <Card title="Shop controls" sub="Everything you set up, in one place">
        <div className={ui.quickGrid}>
          {LINKS.map((l) => (
            <Link key={l.path} className={ui.quickTile} href={`/dashboard/salons/${salonId}/${l.path}`}>
              <Icon name={l.icon} />
              <span>
                {l.label}
                <span className={ui.quickSub}>{l.sub}</span>
              </span>
            </Link>
          ))}
        </div>
      </Card>
      {showPhone !== null && (
        <Card title="Customer contact">
          {error && <Banner tone="error">{error}</Banner>}
          {saved && <Banner tone="ok">Saved.</Banner>}
          <div className={ui.toggleRow}>
            <div>
              <div className={ui.listTitle} style={{ whiteSpace: "normal" }}>Show my shop&apos;s phone number to customers</div>
              <div className={ui.cardSub}>
                When on, customers see a “Call shop” button on their booking and your public page so they can ask about rescheduling, cancellations or charges. Turn it off if you do not want calls.
              </div>
            </div>
            <button type="button" role="switch" aria-checked={showPhone} aria-label="Show my shop's phone number to customers" className={`${ui.switch} ${showPhone ? ui.switchOn : ""}`} onClick={() => void toggle()} />
          </div>
        </Card>
      )}
    </div>
  );
}
