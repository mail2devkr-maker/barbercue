"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
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
  DISTANCE_SLIDER_ANY,
  DISTANCE_SLIDER_MIN,
  distanceFromSlider,
  sliderFromDistance,
  PRICE_SLIDER_MAX,
  PRICE_SLIDER_MIN,
  PRICE_SLIDER_STEP,
  TOP_RATED_MIN,
  priceRangeChange,
  sortsByStartingPrice,
  type DiscoveryState,
} from "../../lib/discovery-params";
import { FavoriteButton } from "./FavoriteButton";
import { offerBadgeText, salonStatus } from "./SalonResultCard";
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
    <fieldset className={styles.section} aria-describedby={`${id}-help`}>
      <legend className={styles.legend}>
        Price range <span className={styles.legendSub}>{service ? `(for ${service.label})` : "(any service)"}</span>
      </legend>
      <p className={styles.rangeValue} aria-live="polite">{min <= PRICE_SLIDER_MIN && max >= PRICE_SLIDER_MAX ? "Any price" : label}</p>
      <div className={styles.slider}>
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
        {service
          ? `Only salons whose ${service.label.toLowerCase()} price is in this range.`
          : "Salons with at least one service in this range. Pick a service to compare its price."}
      </p>
    </fieldset>
  );
}

/** One-thumb distance slider, styled like the price slider. Applies when the thumb is released. */
function DistanceSlider({ location }: { location: LocationControls }) {
  const [position, setPosition] = useState(sliderFromDistance(location.radiusKm));
  // Follow the URL (back/forward, Clear all, Near me turned off).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is the source of truth
    setPosition(sliderFromDistance(location.radiusKm));
  }, [location.radiusKm]);
  const latest = useRef(position);
  useEffect(() => {
    latest.current = position;
  }, [position]);
  const commit = () => {
    const km = distanceFromSlider(latest.current);
    if (km !== location.radiusKm) location.onRadius(km);
  };
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitSoon = () => {
    if (keyTimer.current) clearTimeout(keyTimer.current);
    keyTimer.current = setTimeout(commit, 450);
  };
  useEffect(() => () => {
    if (keyTimer.current) clearTimeout(keyTimer.current);
  }, []);
  const km = distanceFromSlider(position);
  const fill = ((position - DISTANCE_SLIDER_MIN) / (DISTANCE_SLIDER_ANY - DISTANCE_SLIDER_MIN)) * 100;
  // An older link may carry a radius under 1 km; say so rather than rounding it silently.
  const label = km === null ? "Any distance" : location.radiusKm !== null && location.radiusKm < 1 && position === DISTANCE_SLIDER_MIN ? `Within ${location.radiusKm * 1000} m` : `Within ${km} km`;

  return (
    <fieldset className={styles.section}>
      <legend className={styles.legend}>Distance</legend>
      <p className={styles.rangeValue} aria-live="polite">{location.locating ? "Finding your location…" : label}</p>
      <div className={styles.slider}>
        <div className={styles.track} aria-hidden="true">
          <div className={styles.trackFill} style={{ left: 0, width: `${fill}%` }} />
        </div>
        <input
          type="range"
          aria-label="Distance"
          aria-valuetext={label}
          min={DISTANCE_SLIDER_MIN}
          max={DISTANCE_SLIDER_ANY}
          step={1}
          value={position}
          disabled={location.locating}
          onChange={(e) => setPosition(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commitSoon}
          onBlur={commit}
        />
      </div>
      <div className={styles.rangeEnds} aria-hidden="true">
        <span>1 km</span>
        <span>Any</span>
      </div>
      <Check label="Near me" checked={location.nearMe} onChange={location.onNearMe} />
      {!location.nearMe && <p className={styles.help}>Distance uses your current location.</p>}
    </fieldset>
  );
}

/** Distance needs the customer's location; the page owns the geolocation flow. */
export interface LocationControls {
  nearMe: boolean;
  radiusKm: number | null;
  locating: boolean;
  onRadius: (km: number | null) => void;
  onNearMe: (on: boolean) => void;
}

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (on: boolean) => void; hint?: string }) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function FiltersPanel({
  state,
  onChange,
  onClearAll,
  activeCount,
  location,
}: {
  state: DiscoveryState;
  onChange: (changes: Changes) => void;
  onClearAll: () => void;
  activeCount: number;
  location?: LocationControls;
}) {
  const topRated = state.minRating !== null && state.minRating >= TOP_RATED_MIN;
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

      <ServicePriceSlider state={state} onChange={onChange} />

      {location && <DistanceSlider location={location} />}

      <fieldset className={styles.section}>
        <legend className={styles.legend}>Popular services</legend>
        <div className={styles.serviceGrid}>
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

      <fieldset className={styles.section}>
        <legend className={styles.srOnly}>Show only</legend>
        <Check label="Open now only" checked={state.openNow} onChange={(on) => onChange({ openNow: on ? "true" : null })} />
        <Check
          label="Offers only"
          checked={state.offersOnly}
          onChange={(on) => onChange({ offersOnly: on ? "true" : null })}
          hint={state.popularService ? `Offers that cover ${popularServiceById(state.popularService)?.label.toLowerCase()}` : undefined}
        />
        <Check label={`Top rated (${TOP_RATED_MIN.toFixed(1)}+)`} checked={topRated} onChange={(on) => onChange({ minRating: on ? String(TOP_RATED_MIN) : null })} />
        <Check label="My favorites" checked={state.favoritesOnly} onChange={(on) => onChange({ favorites: on ? "1" : null })} />
      </fieldset>
    </div>
  );
}

export function SortControl({ state, onChange }: { state: DiscoveryState; onChange: (sort: SalonSortOption) => void }) {
  return (
    <div className={styles.sort}>
      <label htmlFor="discovery-sort">Sort by</label>
      <select id="discovery-sort" value={state.sort} onChange={(e) => onChange(e.target.value as SalonSortOption)}>
        {SALON_SORT_OPTIONS.map((option) => {
          return (
            <option key={option} value={option}>
              {SALON_SORT_LABELS[option]}
              {sortsByStartingPrice(option, state) ? " (starting price)" : ""}
              {option === "distance" && !state.nearMe ? " (uses your location)" : ""}
            </option>
          );
        })}
      </select>
    </div>
  );
}

/**
 * Same-service comparison: one row per salon, the selected service's own name and price, its best
 * offer, and the price after that offer only when the offer is certain (otherwise "at booking").
 */
export function CompareTable({ salons, serviceLabel }: { salons: SalonListItemDto[]; serviceLabel: string }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.caption}>{serviceLabel} prices at {salons.length} {salons.length === 1 ? "salon" : "salons"}</caption>
        <thead>
          <tr>
            <th scope="col">Salon</th>
            <th scope="col">{serviceLabel}</th>
            <th scope="col">Price</th>
            <th scope="col">Offer</th>
            <th scope="col">You pay</th>
            <th scope="col">Rating</th>
            <th scope="col">Distance</th>
            <th scope="col">Type</th>
            <th scope="col">Now</th>
            <th scope="col"><span className={styles.srOnly}>Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {salons.map((salon) => {
            const country = salon.countryCode.toLowerCase();
            const params = new URLSearchParams({ city: salon.citySlug, country: salon.countryCode });
            const offer = salon.offers?.[0] ?? null;
            if (offer) params.set("offer", offer.id);
            const money = (amount: number) => formatMoney(amount, salon.currency, salon.countryCode);
            const service = salon.selectedService;
            const certain = offer?.price && service && offer.price.serviceId === service.id ? offer.price : null;
            return (
              <tr key={salon.id}>
                <th scope="row">
                  <Link href={`/${country}/${salon.citySlug}/${salon.slug}`} className={styles.salonLink}>{salon.name}</Link>
                  <small>{salon.addressLine}</small>
                </th>
                <td>{service ? <>{service.name}<small>{service.durationMinutes} min</small></> : <span className={styles.muted}>Not on menu</span>}</td>
                <td>{service ? (certain ? <s className={styles.muted}>{money(service.price)}</s> : <strong>{money(service.price)}</strong>) : <span className={styles.muted}>—</span>}</td>
                <td>
                  {offer ? (
                    <>
                      <span className={styles.offerTag}>{offerBadgeText(offer, salon.currency, salon.countryCode)}</span>
                      <small>{offer.conditional ? "Conditions apply" : offer.title}</small>
                    </>
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td>
                  {certain ? (
                    <strong className={styles.pay}>{money(certain.offerPrice)}</strong>
                  ) : service ? (
                    <>
                      <strong>{money(service.price)}</strong>
                      {offer?.conditional && <small>Offer checked at booking</small>}
                    </>
                  ) : (
                    <span className={styles.muted}>—</span>
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
                <td>
                  {(() => {
                    const status = salonStatus(salon);
                    return <span className={status.tone === "open" ? styles.open : status.tone === "unknown" ? styles.muted : undefined}>{status.text}</span>;
                  })()}
                </td>
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
