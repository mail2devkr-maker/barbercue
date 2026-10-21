"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { formatMoney } from "@barbercue/shared";
import type { CustomerAssistantSearchResultDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import {
  SEARCH_LIMITS,
  bookHref,
  buildSearchRequest,
  describeFailure,
  formatSlot,
  localToday,
  parseSearch,
  type FormErrors,
  type SearchFailure,
} from "../../lib/customer-assistant";
import styles from "./customer-assistant.module.css";

type Geo = "IDLE" | "ASKING" | "DENIED" | "UNSUPPORTED";

/** About 100 m. Enough to find nearby shops; the exact position is never needed and is never stored by this page. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * "Find a time": searches real shops, prices and open times for a service on a day. It is not a chat and uses no AI, nothing is held for
 * the customer, and nothing is booked or paid here. Each result opens the shop's booking page with the service already chosen; the
 * customer picks a live time and confirms there.
 */
export function CustomerAssistant() {
  const today = localToday();
  const [serviceQuery, setServiceQuery] = useState("");
  const [date, setDate] = useState(today);
  const [city, setCity] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geo, setGeo] = useState<Geo>("IDLE");
  const [maxPrice, setMaxPrice] = useState("");
  const [limit, setLimit] = useState(3);
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SearchFailure | null>(null);
  const [result, setResult] = useState<CustomerAssistantSearchResultDto | null>(null);
  const [searched, setSearched] = useState<{ query: string; date: string } | null>(null);
  // Two quick clicks must not send two searches (the server allows 5 a minute per address).
  const inFlight = useRef(false);

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeo("UNSUPPORTED");
      return;
    }
    setGeo("ASKING");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: round3(pos.coords.latitude), lng: round3(pos.coords.longitude) });
        setGeo("IDLE");
        setErrors((e) => ({ ...e, city: undefined }));
      },
      () => setGeo("DENIED"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const built = buildSearchRequest({ serviceQuery, date, city, coords, maxPrice, limit }, today);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const raw = await apiFetch<unknown>("assistant/search", { method: "POST", body: JSON.stringify(built.body) });
      const parsed = parseSearch(raw);
      if (!parsed) {
        setResult(null);
        setFailure({ kind: "TRY_LATER", message: "The search could not be completed right now. Nothing was booked. Try again in a moment." });
        return;
      }
      setResult(parsed);
      setSearched({ query: serviceQuery.trim(), date });
    } catch (err) {
      // Old results are dropped so they are never shown beside a failed search.
      setResult(null);
      setFailure(err instanceof ApiError ? describeFailure(err.status, err.code) : describeFailure(undefined));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <main className={styles.page} aria-label="Find a time">
      <h1 className={styles.heading}>Find a time</h1>
      <p className={styles.muted}>
        Search real shops, prices and open times for a service. This is a search, not a chat and not AI. Nothing is booked or paid until you confirm on the
        booking page, and the times shown are a snapshot that is not held for you.
      </p>

      <form className={styles.form} onSubmit={search} noValidate aria-label="Find a time">
        <div className={styles.field}>
          <label htmlFor="ca-service" className={styles.label}>
            What service do you want?
          </label>
          <input
            id="ca-service"
            className={styles.input}
            value={serviceQuery}
            maxLength={SEARCH_LIMITS.maxQueryLength}
            placeholder="For example: haircut"
            autoComplete="off"
            aria-invalid={errors.serviceQuery ? true : undefined}
            aria-describedby={errors.serviceQuery ? "ca-service-error" : undefined}
            onChange={(e) => setServiceQuery(e.target.value)}
          />
          {errors.serviceQuery && (
            <p id="ca-service-error" className={styles.fieldError} role="alert">
              {errors.serviceQuery}
            </p>
          )}
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="ca-date" className={styles.label}>
              Which day?
            </label>
            <input
              id="ca-date"
              className={styles.input}
              type="date"
              value={date}
              min={today}
              aria-invalid={errors.date ? true : undefined}
              aria-describedby={errors.date ? "ca-date-error" : undefined}
              onChange={(e) => setDate(e.target.value)}
            />
            {errors.date && (
              <p id="ca-date-error" className={styles.fieldError} role="alert">
                {errors.date}
              </p>
            )}
          </div>

          <div className={styles.field}>
            <label htmlFor="ca-city" className={styles.label}>
              Where?
            </label>
            {coords ? (
              <div className={styles.actions}>
                <span>Using your location (about 100 m, used only for this search)</span>
                <button type="button" className={styles.secondary} onClick={() => setCoords(null)}>
                  Use a city instead
                </button>
              </div>
            ) : (
              <>
                <input
                  id="ca-city"
                  className={styles.input}
                  value={city}
                  placeholder="City, for example: jharsuguda"
                  autoComplete="off"
                  aria-invalid={errors.city ? true : undefined}
                  aria-describedby={errors.city ? "ca-city-error" : undefined}
                  onChange={(e) => setCity(e.target.value)}
                />
                <div className={styles.actions}>
                  <button type="button" className={styles.secondary} onClick={useMyLocation} disabled={geo === "ASKING"}>
                    {geo === "ASKING" ? "Finding you…" : "Use my location"}
                  </button>
                </div>
                {geo === "DENIED" && <p className={styles.muted}>Location was not shared. Enter your city instead.</p>}
                {geo === "UNSUPPORTED" && <p className={styles.muted}>This browser cannot share a location. Enter your city instead.</p>}
              </>
            )}
            {errors.city && (
              <p id="ca-city-error" className={styles.fieldError} role="alert">
                {errors.city}
              </p>
            )}
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="ca-price" className={styles.label}>
              Most you want to pay (optional)
            </label>
            <input
              id="ca-price"
              className={styles.input}
              inputMode="decimal"
              value={maxPrice}
              placeholder="For example: 500"
              autoComplete="off"
              aria-invalid={errors.maxPrice ? true : undefined}
              aria-describedby={errors.maxPrice ? "ca-price-error" : undefined}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
            {errors.maxPrice && (
              <p id="ca-price-error" className={styles.fieldError} role="alert">
                {errors.maxPrice}
              </p>
            )}
          </div>
          <div className={styles.field}>
            <label htmlFor="ca-limit" className={styles.label}>
              Shops to show
            </label>
            <select id="ca-limit" className={styles.input} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? "Searching…" : "Find open times"}
          </button>
        </div>
      </form>

      <div aria-live="polite" aria-atomic="true">
        {failure && (
          <p className={styles.alert} role={failure.kind === "FIX_FORM" ? "status" : "alert"}>
            {failure.message}
          </p>
        )}
        {result && searched && (
          <>
            <p className={styles.muted}>
              {result.candidates.length === 0
                ? ""
                : `${result.candidates.length} shop${result.candidates.length === 1 ? "" : "s"} for “${searched.query}” on ${searched.date}. Times are in each shop's own time zone.`}
            </p>
            {result.candidates.length === 0 ? (
              <p className={styles.empty}>
                {`No shop has an open time for “${searched.query}” on ${searched.date} in that place. Try another day, a wider place or a different wording.`}
              </p>
            ) : (
              <ul className={styles.list}>
                {result.candidates.map((c) => (
                  <li key={`${c.salon.id}:${c.service.id}`} className={styles.card}>
                    <h2 className={styles.shop}>{c.salon.name}</h2>
                    <p className={styles.service}>{`${c.service.name}${c.service.category ? ` · ${c.service.category}` : ""}`}</p>
                    <p className={styles.muted}>
                      {`${formatMoney(c.service.price, c.currency, c.salon.countryCode)} · ${c.service.durationMinutes} min${c.salon.distanceKm !== null ? ` · ${c.salon.distanceKm.toFixed(1)} km away` : ""}`}
                    </p>
                    {c.availableSlots.length > 0 ? (
                      <>
                        <ul className={styles.slots} aria-label={`Open times at ${c.salon.name}`}>
                          {c.availableSlots.map((s) => (
                            <li key={s.slotStart} className={styles.slot}>
                              {formatSlot(s.slotStart, c.timeZone)}
                            </li>
                          ))}
                        </ul>
                        <Link className={styles.book} href={bookHref(c)}>
                          {`Choose a time at ${c.salon.name}`}
                        </Link>
                      </>
                    ) : (
                      <p className={styles.muted}>No open time is left at this shop on that day.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </main>
  );
}
