"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { SalonListItemDto, SalonOfferSummaryDto } from "@barbercue/shared";
import { SALON_TYPE_LABELS, SHOP_CLOSED_TODAY_MESSAGE, VERIFICATION_BADGE_CAPTION, formatDistance, formatMoney } from "@barbercue/shared";
import { SalonImage } from "../ui/SalonImage";
import { FavoriteButton } from "./FavoriteButton";
import styles from "./salon-result-card.module.css";

// Booking page 3.0: the horizontal marketplace card on /search. Every value here comes from the
// search API (real services, prices, reviews, hours and published offers). A discounted price is
// shown only when the server says the offer is certain for anyone; the booking flow recalculates
// and revalidates the offer on the server before anything is confirmed.

const AUDIENCE_TEXT: Record<SalonOfferSummaryDto["audience"], string | null> = {
  ALL: null,
  NEW: "First visit only",
  REPEAT: "Returning customers",
  INACTIVE: "Welcome-back customers",
};

export function offerBadgeText(offer: SalonOfferSummaryDto, currency: string | null, countryCode: string): string {
  return offer.discountType === "PERCENT"
    ? `${offer.discountValue}% OFF`
    : `Flat ${formatMoney(offer.discountValue, currency, countryCode)} OFF`;
}

/** Plain-language conditions ("First visit only · Mon–Fri, 14:00–17:00 · On bookings above ₹500"). */
export function offerConditions(offer: SalonOfferSummaryDto, currency: string | null, countryCode: string): string[] {
  return [
    AUDIENCE_TEXT[offer.audience],
    offer.schedule,
    offer.minimumBookingAmount !== null ? `On bookings above ${formatMoney(offer.minimumBookingAmount, currency, countryCode)}` : null,
    offer.maximumDiscountAmount !== null ? `Up to ${formatMoney(offer.maximumDiscountAmount, currency, countryCode)} off` : null,
  ].filter((text): text is string => !!text);
}

function validTill(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(iso));
}

/** "22:00" → "10:00 PM". */
export function clockText(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function OffersDialog({ salon, onClose }: { salon: SalonListItemDto; onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <div className={styles.dialogBackdrop} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.key === "Escape" && onClose()}
      >
        <div className={styles.dialogHead}>
          <h3 id={titleId}>Offers at {salon.name}</h3>
          <button ref={closeRef} type="button" className={styles.dialogClose} onClick={onClose} aria-label="Close offers">×</button>
        </div>
        <ul className={styles.dialogList}>
          {(salon.offers ?? []).map((offer) => (
            <li key={offer.id}>
              <strong>{offerBadgeText(offer, salon.currency, salon.countryCode)}</strong> {offer.title}
              <p>{offer.appliesTo ? `On ${offer.appliesTo}` : "On all services"} · Valid till {validTill(offer.validTo)}</p>
              {offer.description && <p>{offer.description}</p>}
              {offerConditions(offer, salon.currency, salon.countryCode).length > 0 && (
                <p className={styles.terms}>{offerConditions(offer, salon.currency, salon.countryCode).join(" · ")}</p>
              )}
            </li>
          ))}
        </ul>
        <p className={styles.dialogNote}>The final price is confirmed when you book; eligibility is checked then.</p>
      </div>
    </div>
  );
}

export function SalonResultCard({ salon, styleName }: { salon: SalonListItemDto; styleName?: string }) {
  const [photo, setPhoto] = useState(0);
  const [offersOpen, setOffersOpen] = useState(false);
  const country = salon.countryCode.toLowerCase();
  const money = (amount: number) => formatMoney(amount, salon.currency, salon.countryCode);
  const photos = salon.photoUrls?.length ? salon.photoUrls : salon.coverPhotoUrl ? [salon.coverPhotoUrl] : [];
  const offer = salon.offers?.[0] ?? null;
  const moreOffers = (salon.offers?.length ?? 0) - 1;

  const profileHref = `/${country}/${salon.citySlug}/${salon.slug}${styleName ? `?style=${encodeURIComponent(styleName)}` : ""}`;
  const bookingParams = new URLSearchParams({ city: salon.citySlug, country: salon.countryCode });
  if (styleName) bookingParams.set("style", styleName);
  // The card's offer travels into the existing booking journey, which re-checks it on the server.
  if (offer) bookingParams.set("offer", offer.id);
  const bookingHref = `/book/${salon.slug}?${bookingParams.toString()}`;

  const rows = [
    ...(salon.selectedService ? [{ ...salon.selectedService, selected: true }] : []),
    ...(salon.otherServices ?? []).map((service) => ({ ...service, selected: false })),
  ].slice(0, 4);
  const hiddenServices = Math.max(0, (salon.serviceCount ?? 0) - rows.length);

  const status = salon.isClosedForToday
    ? { tone: styles.closed, text: SHOP_CLOSED_TODAY_MESSAGE }
    : salon.isOpenNow === true
      ? { tone: styles.open, text: salon.closesAt ? `Open now · Closes ${clockText(salon.closesAt)}` : "Open now" }
      : salon.isOpenNow === false
        ? { tone: styles.closed, text: "Closed now" }
        : null;

  return (
    <article className={styles.card} aria-labelledby={`salon-${salon.id}`}>
      <div className={styles.media}>
        <Link href={profileHref} className={styles.mediaLink} aria-label={`View ${salon.name}`} tabIndex={-1}>
          <SalonImage url={photos[photo] ?? null} alt={`${salon.name} salon`} aspectRatio="4 / 3" rounded={0} />
        </Link>
        <FavoriteButton salonId={salon.id} salonName={salon.name} />
        {offer && <span className={styles.offerBadge}>{offerBadgeText(offer, salon.currency, salon.countryCode)}</span>}
        {photos.length > 1 && (
          <>
            <button type="button" className={`${styles.arrow} ${styles.arrowPrev}`} aria-label="Previous photo" onClick={() => setPhoto((p) => (p - 1 + photos.length) % photos.length)}>‹</button>
            <button type="button" className={`${styles.arrow} ${styles.arrowNext}`} aria-label="Next photo" onClick={() => setPhoto((p) => (p + 1) % photos.length)}>›</button>
            <span className={styles.counter} aria-live="polite">{photo + 1}/{photos.length}</span>
          </>
        )}
      </div>

      <div className={styles.info}>
        <div className={styles.titleRow}>
          <h3 id={`salon-${salon.id}`} className={styles.name}>
            <Link href={profileHref}>{salon.name}</Link>
          </h3>
          {salon.ratingAverage !== null && (
            <span className={styles.rating} aria-label={`Rated ${salon.ratingAverage.toFixed(1)} from ${salon.ratingCount} reviews`}>
              ★ {salon.ratingAverage.toFixed(1)} <small>({salon.ratingCount})</small>
            </span>
          )}
          {salon.verified && <span className={styles.verified} title={VERIFICATION_BADGE_CAPTION}>✓ Verified</span>}
        </div>
        <p className={styles.address}>{salon.addressLine}</p>
        {salon.distanceKm !== null && <p className={styles.distance}>{formatDistance(salon.distanceKm, salon.countryCode)} away</p>}
        <div className={styles.chips}>
          {salon.salonType && salon.salonTypeConfirmed ? (
            <span className={styles.typeChip}>{SALON_TYPE_LABELS[salon.salonType]}</span>
          ) : (
            <span className={`${styles.typeChip} ${styles.typeUnknown}`}>Type not set</span>
          )}
          {salon.ratingAverage === null && <span className={`${styles.typeChip} ${styles.typeUnknown}`}>No reviews yet</span>}
          {salon.waitingCount > 0 && <span className={styles.typeChip}>{salon.waitingCount} waiting</span>}
        </div>
        {photos.length > 1 && (
          <div className={styles.thumbs}>
            {photos.slice(1, 4).map((url, index) => (
              <button key={url} type="button" className={styles.thumb} onClick={() => setPhoto(index + 1)} aria-label={`Show photo ${index + 2}`}>
                <SalonImage url={url} alt="" aspectRatio="4 / 3" rounded={6} />
              </button>
            ))}
            {photos.length > 4 && <span className={styles.thumbMore}>+{photos.length - 4}</span>}
          </div>
        )}
        {status && <p className={`${styles.status} ${status.tone}`}>{status.text}</p>}
      </div>

      {offer && (
        <div className={styles.offer}>
          <span className={styles.offerIcon} aria-hidden="true">%</span>
          <div>
            <p className={styles.offerTitle}>{offer.title}</p>
            <p className={styles.offerValue}>
              {offerBadgeText(offer, salon.currency, salon.countryCode)} {offer.appliesTo ? `on ${offer.appliesTo}` : "on all services"}
            </p>
            {offerConditions(offer, salon.currency, salon.countryCode).length > 0 && (
              <p className={styles.offerTerms}>{offerConditions(offer, salon.currency, salon.countryCode).join(" · ")}</p>
            )}
            <p className={styles.offerValid}>Valid till {validTill(offer.validTo)}</p>
            <button type="button" className={styles.linkButton} onClick={() => setOffersOpen(true)}>
              {moreOffers > 0 ? `View all ${moreOffers + 1} offers` : "Offer details"}
            </button>
          </div>
        </div>
      )}

      <div className={styles.prices}>
        {rows.length === 0 ? (
          <p className={styles.muted}>Prices on request</p>
        ) : (
          <ul>
            {rows.map((row) => {
              const discounted = offer?.price && offer.price.serviceId === row.id ? offer.price : null;
              return (
                <li key={row.id} className={row.selected ? styles.selectedRow : undefined}>
                  <span className={styles.serviceName}>{row.name}</span>
                  <span className={styles.servicePrice}>
                    {discounted ? (
                      <>
                        <s>{money(discounted.originalPrice)}</s> <strong>{money(discounted.offerPrice)}</strong>
                      </>
                    ) : (
                      <strong>{money(row.price)}</strong>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {salon.selectedService === null && <p className={styles.muted}>Doesn’t list this service</p>}
        {offer?.conditional && offer.appliesTo && <p className={styles.conditional}>Offer may apply at booking</p>}
        <Link href={profileHref} className={styles.allServices}>
          View all services{hiddenServices > 0 ? ` (${hiddenServices} more)` : ""} →
        </Link>
      </div>

      <div className={styles.actions}>
        {salon.isClosedForToday ? (
          <span className={styles.muted}>Closed today</span>
        ) : (
          <Link href={bookingHref} className={styles.book}>Book Now</Link>
        )}
        <Link href={profileHref} className={styles.profile}>View Profile</Link>
      </div>

      {offersOpen && <OffersDialog salon={salon} onClose={() => setOffersOpen(false)} />}
    </article>
  );
}
