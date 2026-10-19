"use client";

import Link from "next/link";
import type { PublicOfferDto } from "@barbercue/shared";
import { formatMoney } from "@barbercue/shared";
import { useCursorList } from "../../lib/use-cursor-list";
import {
  DEFAULT_COUNTRY,
  bookOfferHref,
  cityToSlug,
  eligibilityText,
  offerDiscountText,
  offerKindLabel,
  validUntilText,
} from "../../lib/public-offers";
import styles from "./public-offers.module.css";

const OPTIONS = {
  mismatchCodes: ["INVALID_FILTER"] as const,
  errorText: (_code: string | undefined, message: string) => message,
  keyOf: (row: PublicOfferDto) => row.id,
};

function OfferList({ city, country }: { city: string; country: string }) {
  const list = useCursorList<PublicOfferDto>("offers", { city }, true, OPTIONS);
  return (
    <>
      {list.error && <p className={styles.error} role="alert">{list.error}</p>}
      {list.loading && <p className={styles.muted}>Looking for offers…</p>}
      {!list.loading && !list.error && list.items.length === 0 && (
        <p className={styles.empty}>There are no offers in this city right now. Check again soon.</p>
      )}
      <ul className={styles.list}>
        {list.items.map((offer) => (
          <li key={offer.id} className={styles.card}>
            <div className={styles.head}>
              <span className={styles.kind}>{offerKindLabel(offer.kind)}</span>
              <span className={styles.discount}>{offerDiscountText(offer)}</span>
            </div>
            <h2 className={styles.title}>{offer.title}</h2>
            <p className={styles.shop}>{offer.salon.name}, {offer.salon.city}</p>
            {offer.description && <p>{offer.description}</p>}
            <p className={styles.muted}>{eligibilityText(offer)} Valid {validUntilText(offer.validTo)}.</p>
            {offer.prices.length > 0 && (
              <ul className={styles.prices} aria-label={`Prices with ${offer.title}`}>
                {offer.prices.slice(0, 4).map((line) => (
                  <li key={line.serviceId}>
                    {line.serviceName}: <s>{formatMoney(line.basePrice, line.currency)}</s> {formatMoney(line.finalPrice, line.currency)}
                  </li>
                ))}
              </ul>
            )}
            <Link className={styles.book} href={bookOfferHref({ salonSlug: offer.salon.slug, country, citySlug: city, offerId: offer.id })}>
              Book with this offer
            </Link>
          </li>
        ))}
      </ul>
      {list.notice && <p className={styles.muted} role="status">{list.notice}</p>}
      {list.hasMore && (
        <button type="button" className={styles.more} onClick={list.loadMore} disabled={list.loadingMore}>
          {list.loadingMore ? "Loading…" : "Show more offers"}
        </button>
      )}
    </>
  );
}

/**
 * Offers, promotions and daily deals shops in a city are running right now. Prices shown are estimates: FastQue decides again when
 * you book, an offer needs a signed-in account, and an offer is never a payment. The shop link is built from the city you searched
 * with, because the offer list does not name a country or city slug.
 */
export function PublicOffers({ city, country }: { city: string | null; country?: string }) {
  const citySlug = city ? cityToSlug(city) : null;
  const countryCode = (country ?? DEFAULT_COUNTRY).toLowerCase();
  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>Offers near you</h1>
      <p className={styles.muted}>
        Offers, promotions and daily deals that shops are running right now. Prices are estimates; the final price is confirmed when you book,
        and you need to be signed in to use an offer.
      </p>
      <form action="/offers" method="get" className={styles.form} role="search" aria-label="Find offers in a city">
        <input type="hidden" name="country" value={countryCode} />
        <label htmlFor="offers-city" className={styles.label}>City</label>
        <input id="offers-city" name="city" defaultValue={citySlug ?? ""} placeholder="For example: jharsuguda" className={styles.input} autoComplete="off" />
        <button type="submit" className={styles.search}>Show offers</button>
      </form>
      {citySlug ? <OfferList city={citySlug} country={countryCode} /> : (
        <p className={styles.empty}>{city ? "That does not look like a city name. Use letters, numbers and hyphens." : "Enter your city to see its offers."}</p>
      )}
    </main>
  );
}
