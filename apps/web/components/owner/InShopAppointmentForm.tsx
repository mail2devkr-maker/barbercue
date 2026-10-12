"use client";

import { useEffect, useMemo, useState } from "react";
import { DASHBOARD_PATHS, createInShopBookingSchema } from "@barbercue/shared";
import type { DashboardQueueDto, InShopBookingDto, SalonServiceDto, SalonTimezoneResultDto, StaffOptionDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { formatMoney, formatShopDate, formatShopTime } from "./format";
import { Banner, Btn, BtnLink, Card, EmptyState, Field, PageHead } from "./parts";
import { SlotPicker } from "./SlotPicker";
import ui from "./owner.module.css";

interface ServiceChoice {
  id: string;
  name: string;
  durationMinutes: number | null;
  price: number | null;
}

/**
 * "New in-shop appointment": a scheduled booking an operator makes for someone who contacted the
 * shop directly. It is the real booking engine (same availability, capacity and barber checks), but
 * with no FastQue account, no online payment hold and no payment QR requirement - any charge is
 * settled at the shop and invoiced afterwards. A phone number is stored only with the customer's
 * consent.
 */
export function InShopAppointmentForm({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const [services, setServices] = useState<ServiceChoice[] | null>(null);
  const [currency, setCurrency] = useState<string | null>("INR");
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [barbers, setBarbers] = useState<StaffOptionDto[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [staffId, setStaffId] = useState("");
  const [slot, setSlot] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<InShopBookingDto | null>(null);
  const [attemptKey, setAttemptKey] = useState(() => newIdempotencyKey());

  useEffect(() => {
    let cancelled = false;
    // Owners get prices/durations; a barber (who may also create appointments) falls back to names.
    apiFetch<SalonServiceDto[]>(`${base}/${DASHBOARD_PATHS.services}`)
      .then((list) => {
        if (cancelled) return;
        setServices(list.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes, price: s.price })));
        setCurrency(list[0]?.currency ?? "INR");
      })
      .catch(() =>
        apiFetch<DashboardQueueDto>(`${base}/${DASHBOARD_PATHS.queue}`)
          .then((q) => !cancelled && setServices(q.services.map((s) => ({ id: s.id, name: s.name, durationMinutes: null, price: null }))))
          .catch(() => !cancelled && setServices([])),
      );
    apiFetch<SalonTimezoneResultDto>(`${base}/${DASHBOARD_PATHS.timezone}`)
      .then((tz) => !cancelled && setTimeZone(tz.timezone ?? null))
      .catch(() => {
        /* slots then render in the device zone; availability itself is still the shop's */
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  const serviceKey = selected.join(",");
  useEffect(() => {
    if (!serviceKey) {
      setBarbers([]);
      return;
    }
    let cancelled = false;
    apiFetch<StaffOptionDto[]>(`salons/${salonId}/booking/staff?serviceIds=${serviceKey}`)
      .then((list) => {
        if (cancelled) return;
        setBarbers(list);
        if (staffId && !list.some((b) => b.id === staffId)) setStaffId("");
      })
      .catch(() => !cancelled && setBarbers([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- staffId is validated against the new list
  }, [salonId, serviceKey]);

  const chosen = useMemo(() => (services ?? []).filter((s) => selected.includes(s.id)), [services, selected]);
  const totalMinutes = chosen.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
  const totalPrice = chosen.reduce((sum, s) => sum + (s.price ?? 0), 0);

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setSlot(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = createInShopBookingSchema.safeParse({
      guestName: name,
      ...(phone.trim() ? { guestPhone: phone.trim() } : {}),
      contactConsent: consent,
      serviceIds: selected,
      slotStart: slot ?? "",
      ...(staffId ? { preferredStaffId: staffId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.path[0] === "slotStart" ? "Choose a date and a free time." : (issue?.message ?? "Check the details and try again."));
      return;
    }
    setBusy(true);
    try {
      const booking = await apiFetch<InShopBookingDto>(`${base}/bookings/in-shop`, {
        method: "POST",
        headers: { "Idempotency-Key": attemptKey },
        body: JSON.stringify(parsed.data),
      });
      setCreated(booking);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the appointment.");
      // A rejected attempt may be retried with the same key only if nothing was created; a new
      // attempt after the user changes something gets a fresh key.
      setAttemptKey(newIdempotencyKey());
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <>
        <PageHead title="Appointment created" />
        <Card>
          <Banner tone="ok">The in-shop appointment is booked and now appears in Bookings and the Calendar.</Banner>
          <dl className={ui.kv}>
            <dt>Customer</dt>
            <dd>{created.guestName}</dd>
            {created.guestPhone && (
              <>
                <dt>Mobile</dt>
                <dd>{created.guestPhone}</dd>
              </>
            )}
            <dt>When</dt>
            <dd>
              {formatShopDate(created.slotStart, timeZone, true)} at {formatShopTime(created.slotStart, timeZone)}
            </dd>
            <dt>Services</dt>
            <dd>{created.serviceNames.join(" + ")}</dd>
            <dt>Barber</dt>
            <dd>{created.staffName ?? "Any available barber"}</dd>
            <dt>Reference</dt>
            <dd>{created.id.slice(0, 8).toUpperCase()}</dd>
          </dl>
          <div className={`${ui.rowWrap} ${ui.mt16}`}>
            <BtnLink variant="primary" href={`/dashboard/salons/${salonId}/bookings`} icon="calendar">
              View bookings
            </BtnLink>
            <BtnLink href={`/dashboard/salons/${salonId}/schedule`} icon="calendarGrid">
              Open calendar
            </BtnLink>
            <Btn
              onClick={() => {
                setCreated(null);
                setName("");
                setPhone("");
                setConsent(false);
                setSelected([]);
                setStaffId("");
                setSlot(null);
                setNote("");
                setAttemptKey(newIdempotencyKey());
              }}
            >
              Create another
            </Btn>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Bookings"
        title="New in-shop appointment"
        sub="For a customer who walked in or phoned and wants a set time. They do not need a FastQue account or an online payment. To seat someone right now, add them to the Live Queue instead."
        actions={
          <BtnLink href={`/dashboard/salons/${salonId}/queue`} icon="queue">
            Add to Live Queue instead
          </BtnLink>
        }
      />
      <form onSubmit={submit} noValidate>
        {error && <Banner tone="error">{error}</Banner>}
        <div className={`${ui.grid} ${ui.twoCol}`}>
          <div className={ui.sideStack}>
            <Card title="1 · Customer">
              <div className={ui.formGrid}>
                <Field label="Customer name" htmlFor="ia-name">
                  <input id="ia-name" className={ui.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" required />
                </Field>
                <Field label="Mobile number (optional)" htmlFor="ia-phone" hint="Used only to reach them about this appointment.">
                  <input id="ia-phone" className={ui.input} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" placeholder="98765 43210" />
                </Field>
              </div>
              {phone.trim() && (
                <label className={`${ui.checkRow} ${ui.mt12}`}>
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>The customer agreed that the shop may save their number and contact them about this appointment.</span>
                </label>
              )}
            </Card>

            <Card title="2 · Services">
              {services === null ? (
                <div className={ui.hint}>Loading services…</div>
              ) : services.length === 0 ? (
                <EmptyState title="No services yet" action={<BtnLink small href={`/dashboard/salons/${salonId}/services`} icon="plus">Add a service</BtnLink>} />
              ) : (
                <div className={ui.stackSm} role="group" aria-label="Services">
                  {services.map((s) => (
                    <label key={s.id} className={ui.checkRow}>
                      <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
                      <span>
                        <strong>{s.name}</strong>
                        {s.durationMinutes !== null && (
                          <span className={ui.cardSub}>
                            {" "}
                            · {s.durationMinutes} min · {formatMoney(s.price ?? 0, currency)}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                  {chosen.length > 0 && totalMinutes > 0 && (
                    <div className={ui.cardSub}>
                      Total {totalMinutes} min · {formatMoney(totalPrice, currency)}
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card title="3 · Barber (optional)">
              <Field label="Preferred barber" htmlFor="ia-barber" hint={selected.length === 0 ? "Choose services first." : barbers.length === 0 ? "No barber is qualified for every chosen service." : undefined}>
                <select id="ia-barber" className={ui.select} value={staffId} onChange={(e) => { setStaffId(e.target.value); setSlot(null); }} disabled={barbers.length === 0}>
                  <option value="">Any available barber</option>
                  {barbers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.displayName}
                    </option>
                  ))}
                </select>
              </Field>
            </Card>
          </div>

          <div className={ui.sideStack}>
            <Card title="4 · Date & time">
              <SlotPicker salonId={salonId} serviceIds={selected} staffId={staffId || undefined} timeZone={timeZone} value={slot} onChange={setSlot} idPrefix="ia" />
            </Card>
            <Card title="5 · Note (optional)">
              <Field label="Internal note — never shown to the customer" htmlFor="ia-note">
                <textarea id="ia-note" className={ui.textarea} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </Field>
            </Card>
            <div className={ui.rowWrap}>
              <Btn variant="primary" type="submit" icon="check" disabled={busy}>
                {busy ? "Creating…" : "Create appointment"}
              </Btn>
              <BtnLink variant="quiet" href={`/dashboard/salons/${salonId}/bookings`}>
                Cancel
              </BtnLink>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
