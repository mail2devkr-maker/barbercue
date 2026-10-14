"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_PATHS, StaffMemberStatus, createQueueCustomerSchema } from "@barbercue/shared";
import type { DashboardQueueDto, QueueEntryDetailDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { Banner, Btn, Dialog, Field } from "./parts";
import ui from "./owner.module.css";

/**
 * "New Live Queue customer": adds someone who is standing in the shop (and may have no FastQue
 * account) to the Live Queue right now. This is NOT an appointment - a scheduled in-shop
 * appointment is a different action ("New in-shop appointment") with its own form - and no
 * account is created: the name (and, only if the customer agrees, the phone) lives on the entry.
 */
export function NewQueueCustomerDialog({
  salonId,
  onClose,
  onCreated,
}: {
  salonId: string;
  onClose: () => void;
  onCreated: (entry: QueueEntryDetailDto) => void;
}) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const [snapshot, setSnapshot] = useState<DashboardQueueDto | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<DashboardQueueDto>(`${base}/${DASHBOARD_PATHS.queue}`)
      .then((s) => !cancelled && setSnapshot(s))
      .catch(() => {
        /* the form still works without the pickers */
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = createQueueCustomerSchema.safeParse({
      name,
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      contactConsent: consent,
      ...(serviceId ? { serviceId } : {}),
      ...(staffId ? { preferredStaffId: staffId } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the details and try again.");
      return;
    }
    setBusy(true);
    try {
      const entry = await apiFetch<QueueEntryDetailDto>(`${base}/queue/customers`, {
        method: "POST",
        headers: { "Idempotency-Key": newIdempotencyKey() },
        body: JSON.stringify(parsed.data),
      });
      onCreated(entry);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add this customer.");
    } finally {
      setBusy(false);
    }
  }

  const barbers = (snapshot?.staffRoster ?? []).filter((s) => s.status === StaffMemberStatus.ACTIVE);
  return (
    <Dialog title="New Live Queue customer" onClose={onClose}>
      <p className={ui.cardSub} style={{ marginTop: -6, marginBottom: 14 }}>
        For someone who is here now and wants the next free barber. Need a set time instead? Create an in-shop appointment.
      </p>
      <form onSubmit={submit} noValidate>
        {error && <Banner tone="error">{error}</Banner>}
        <div className={ui.formGrid}>
          <Field label="Customer name" htmlFor="nq-name">
            <input id="nq-name" className={ui.input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required maxLength={60} />
          </Field>
          <Field label="Mobile number (optional)" htmlFor="nq-phone" hint="Only saved if the customer agrees to be contacted.">
            <input id="nq-phone" className={ui.input} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" placeholder="98765 43210" />
          </Field>
          <Field label="Service" htmlFor="nq-service" hint="Needed before a barber can be assigned automatically.">
            <select id="nq-service" className={ui.select} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Choose later</option>
              {(snapshot?.services ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Preferred barber (optional)" htmlFor="nq-staff">
            <select id="nq-staff" className={ui.select} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Any available barber</option>
              {barbers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {phone.trim() && (
          <label className={`${ui.checkRow} ${ui.mt12}`}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>The customer agreed that the shop may save their number and contact them about this visit.</span>
          </label>
        )}
        <div className={ui.dialogActions}>
          <Btn variant="quiet" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" type="submit" disabled={busy} icon="plus">
            {busy ? "Adding…" : "Add to Live Queue"}
          </Btn>
        </div>
      </form>
    </Dialog>
  );
}
