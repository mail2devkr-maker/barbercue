"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  MIN_RATING_OPTIONS,
  POPULAR_SERVICES,
  SALON_SORT_LABELS,
  SALON_SORT_OPTIONS,
  SALON_TYPE_LABELS,
  formatDistance,
  formatMoney,
  popularServiceById,
  type SalonListItemDto,
  type SalonSortOption,
  type SalonTypeFilter,
} from "@barbercue/shared";
import {
  PRICE_SLIDER_MAX,
  PRICE_SLIDER_MIN,
  PRICE_SLIDER_STEP,
  priceRangeChange,
  sortUnavailableReason,
  type DiscoveryState,
} from "../../lib/discovery-params";
import { FavoriteButton } from "./FavoriteButton";
import styles from "./discovery-filters.module.css";

type Changes = Record<string, string | null>;

const TYPE_OPTIONS: Array<{ value: SalonTypeFilter | null; label: string; hint: string }> = [
  { value: null, label: "All", hint: "Every salon" },
  { value: "GENTS", label: SALON_TYPE_LABELS.GENTS, hint: "Male + unisex salons" },
  { value: "LADIES", label: SALON_TYPE_LABELS.LADIES, hint: "Female + unisex salons" },
  { value: "UNISEX", label: SALON_TYPE_LABELS.UNISEX, hint: "Unisex salons only" },
];

const rupees = (value: number) => `₹${new Intl.NumberFormat("en-IN").format(value)}`;

/** Two-thumb price slider for the selected service. Applies when a thumb is released. */
export function ServicePriceSlider({ state, onChange }: { state: DiscoveryState; onChange: (changes: Changes) => void }) {
  const enabled = state.popularService !== null;
  const service = popularServiceById(state.popularService);
  const [min, setMin] = useState(state.priceMin ?? PRICE_SLIDER_MIN);
  const [max, setMax] = useState(state.priceMax ?? PRICE_SLIDER_MAX);
  const id = useId();

  // Follow the URL (back/forward, Clear all, a new service).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is the source of truth
    setMin(state.priceMin ?? PRICE_SLIDER_MIN);
    setMax(state.priceMax ?? PRICE_SLIDER_MAX);
  }, [state.priceMin, state.priceMax, state.popularService]);

  const commit = () => onChange(priceRangeChange(min, max));
  // Keyboard steps arrive one key at a time; apply once the customer pauses rather than per press.
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ min, max });
  useEffect(() => {
    latest.current = { min, max };
  }, [min, max]);
  const commitSoon = () => {
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(() => onChange(priceRangeChange(latest.current.min, latest.current.max)), 450);
  };
  useEffect(() => () => {
    if (keyTimer.current) clearTimeout(keyTimer.current);
  }, []);
  const left = ((min - PRICE_SLIDER_MIN) / (PRICE_SLIDER_MAX - PRICE_SLIDER_MIN)) * 100;
  const right = ((max - PRICE_SLIDER_MIN) / (PRICE_SLIDER_MAX - PRICE_SLIDER_MIN)) * 100;
  const label = `${rupees(min)} – ${max >= PRICE_SLIDER_MAX ? `${rupees(PRICE_SLIDER_MAX)}+` : rupees(max)}`;

  return (
    <fieldset className={styles.section} disabled={!enabled} aria-describedby={`${id}-help`}>
      <legend className={styles.legend}>
        Price {service ? <span className={styles.legendSub}>for {service.label}</span> : null}
      </legend>
      <p className={styles.rangeValue} aria-live="polite">{enabled ? label : "Any price"}</p>
      <div className={`${styles.slider} ${enabled ? "" : styles.sliderDisabled}`}>
        <div className={styles.track} aria-hidden="true">
          <div className={styles.trackFill} style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }} />
        </div>
        <input
          type="range"
          aria-label="Minimum price"
          min={PRICE_SLIDER_MIN}
          max={PRICE_SLIDER_MAX}
          step={PRICE_SLIDER_STEP}
          value={min}
          onChange={(e) => setMin(Math.min(Number(e.target.value), max - PRICE_SLIDER_STEP))}
          onPointerUp={commit}
          onKeyUp={commitSoon}
          onBlur={commit}
        />
        <input
          type="range"
          aria-label="Maximum price"
          min={PRICE_SLIDER_MIN}
          max={PRICE_SLIDER_MAX}
          step={PRICE_SLIDER_STEP}
          value={max}
          onChange={(e) => setMax(Math.max(Number(e.target.value), min + PRICE_SLIDER_STEP))}
          onPointerUp={commit}
          onKeyUp={commitSoon}
          onBlur={commit}
        />
      </div>
      <div className={styles.rangeEnds} aria-hidden="true">
        <span>{rupees(PRICE_SLIDER_MIN)}</span>
        <span>{rupees(PRICE_SLIDER_MAX)}+</span>
      </div>
      <p id={`${id}-help`} className={styles.help}>
        {enabled ? `Only salons whose ${service!.label.toLowerCase()} price is in this range.` : "Select a service to filter by price."}
      </p>
    </fieldset>
  );
}

export function FiltersPanel({
  state,
  onChange,
  onClearAll,
  activeCount,
}: {
  state: DiscoveryState;
  onChange: (changes: Changes) => void;
  onClearAll: () => void;
  activeCount: number;
}) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Filters</h2>
        {activeCount > 0 && (
          <button type="button" className={styles.clear} onClick={onClearAll}>
            Clear all
          </button>
        )}
      </div>

      <fieldset className={styles.section}>
        <legend className={styles.legend}>Salon type</legend>
        <div className={styles.segmented} role="radiogroup" aria-label="Salon type">
          {TYPE_OPTIONS.map((option) => {
            const checked = state.salonType === option.value;
            return (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={checked}
                title={option.hint}
                className={`${styles.segment} ${checked ? styles.segmentOn : ""}`}
                onClick={() => onChange({ salonType: option.value })}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className={styles.help}>{TYPE_OPTIONS.find((o) => o.value === state.salonType)?.hint}</p>
      </fieldset>

      <fieldset className={styles.section}>
        <legend className={styles.legend}>Popular services</legend>
        <div className={styles.chips}>
          {POPULAR_SERVICES.map((service) => {
            const on = state.popularService === service.id;
            return (
              <button
                key={service.id}
                type="button"
                aria-pressed={on}
                className={`${styles.chip} ${on ? styles.chipOn : ""}`}
                onClick={() => onChange({ __popularService: on ? null : service.id })}
              >
                {service.label}
              </button>
            );
          })}
        </div>
        <p className={styles.help}>Pick one to compare its price across salons.</p>
      </fieldset>

      <ServicePriceSlider state={state} onChange={onChange} />

      <fieldset className={styles.section}>
        <legend className={styles.legend}>Rating</legend>
        <div className={styles.segmented} role="radiogroup" aria-label="Minimum rating">
          {[null, ...MIN_RATING_OPTIONS].map((value) => {
            const checked = state.minRating === value;
            return (
              <button
                key={value ?? "any"}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={value === null ? "Any rating" : `${value} stars and up`}
                className={`${styles.segment} ${checked ? styles.segmentOn : ""}`}
                onClick={() => onChange({ minRating: value === null ? null : String(value) })}
              >
                {value === null ? "Any" : `${value}★+`}
              </button>
            );
          })}
        </div>
        <p className={styles.help}>{state.minRating === null ? "Average customer review score." : "Salons without reviews are hidden."}</p>
      </fieldset>

      <fieldset className={styles.section}>
        <legend className={styles.legend}>Show only</legend>
        <div className={styles.chips}>
          <button
            type="button"
            aria-pressed={state.openNow}
            className={`${styles.chip} ${state.openNow ? styles.chipOn : ""}`}
            onClick={() => onChange({ openNow: state.openNow ? null : "true" })}
          >
            Open now
          </button>
          <button
            type="button"
            aria-pressed={state.favoritesOnly}
            className={`${styles.chip} ${state.favoritesOnly ? styles.chipOn : ""}`}
            onClick={() => onChange({ favorites: state.favoritesOnly ? null : "1" })}
          >
            ♥ My favorites
          </button>
        </div>
      </fieldset>
    </div>
  );
}

export function SortControl({ state, onChange }: { state: DiscoveryState; onChange: (sort: SalonSortOption) => void }) {
  const priceReason = sortUnavailableReason("price", state);
  return (
    <div className={styles.sort}>
      <label htmlFor="discovery-sort">Sort by</label>
      <select id="discovery-sort" value={state.sort} onChange={(e) => onChange(e.target.value as SalonSortOption)}>
        {SALON_SORT_OPTIONS.map((option) => (
          <option key={option} value={option} disabled={option === "price" && !!priceReason}>
            {SALON_SORT_LABELS[option]}
            {option === "price" && priceReason ? " — select a service first" : ""}
            {option === "distance" && !state.nearMe ? " (uses your location)" : ""}
          </option>
        ))}
      </select>
      {priceReason && <span className={styles.sortHint}>{priceReason}</span>}
    </div>
  );
}

/** Same-service comparison: one row per salon, the selected service's own name and price. */
export function CompareTable({ salons, serviceLabel }: { salons: SalonListItemDto[]; serviceLabel: string }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.caption}>{serviceLabel} prices at {salons.length} {salons.length === 1 ? "salon" : "salons"}</caption>
        <thead>
          <tr>
            <th scope="col">Salon</th>
            <th scope="col">{serviceLabel} price</th>
            <th scope="col">Rating</th>
            <th scope="col">Distance</th>
            <th scope="col">Type</th>
            <th scope="col"><span className={styles.srOnly}>Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {salons.map((salon) => {
            const country = salon.countryCode.toLowerCase();
            const params = new URLSearchParams({ city: salon.citySlug, country: salon.countryCode });
            return (
              <tr key={salon.id}>
                <th scope="row">
                  <Link href={`/${country}/${salon.citySlug}/${salon.slug}`} className={styles.salonLink}>{salon.name}</Link>
                  <small>{salon.addressLine}</small>
                </th>
                <td>
                  {salon.selectedService ? (
                    <>
                      <strong>{formatMoney(salon.selectedService.price, salon.currency, salon.countryCode)}</strong>
                      <small>{salon.selectedService.name} · {salon.selectedService.durationMinutes} min</small>
                    </>
                  ) : (
                    <span className={styles.muted}>Not on menu</span>
                  )}
                </td>
                <td>
                  {salon.ratingAverage === null ? (
                    <span className={styles.muted}>No reviews yet</span>
                  ) : (
                    <>★ {salon.ratingAverage.toFixed(1)} <small>{salon.ratingCount} {salon.ratingCount === 1 ? "review" : "reviews"}</small></>
                  )}
                </td>
                <td>{salon.distanceKm === null ? <span className={styles.muted}>—</span> : formatDistance(salon.distanceKm, salon.countryCode)}</td>
                <td>{salon.salonType && salon.salonTypeConfirmed ? SALON_TYPE_LABELS[salon.salonType] : <span className={styles.muted}>Not set</span>}</td>
                <td className={styles.rowActions}>
                  <FavoriteButton salonId={salon.id} salonName={salon.name} variant="inline" />
                  {salon.isClosedForToday ? (
                    <span className={styles.muted}>Closed today</span>
                  ) : (
                    <Link className={styles.book} href={`/book/${salon.slug}?${params.toString()}`}>Book now</Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
