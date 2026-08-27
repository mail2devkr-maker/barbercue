import Link from "next/link";
import type { SalonListItemDto } from "@barbercue/shared";
import { formatMoney } from "@barbercue/shared";
import { SalonImage } from "../ui/SalonImage";
import styles from "./salon-card.module.css";

// styleName is optional and only ever set by the search page when the visitor arrived via the AI
// Style Advisor's "Try This Look" hand-off — forwarded into the link so the chosen style survives
// through to the salon profile page's "Book an appointment" CTA, and from there into the booking
// form. Every other caller (landing page's Featured Shops, plain search) omits it and behaves
// exactly as before.
export function SalonCard({ salon, styleName }: { salon: SalonListItemDto; styleName?: string }) {
  const href = `/${salon.countryCode.toLowerCase()}/${salon.citySlug}/${salon.slug}${styleName ? `?style=${encodeURIComponent(styleName)}` : ""}`;
  return (
    <Link href={href} className={styles.link}>
      <article className={styles.card}>
        {/* A photo is what makes a listing feel like a real, chosen-by-a-human shop rather than a
            database row — the single biggest gap versus Fresha/Booksy's card pattern. SalonImage
            already renders an honest empty state when a shop has none. */}
        <div className={styles.imageWrap}>
          <SalonImage url={salon.coverPhotoUrl} alt={`${salon.name}'s shop front`} aspectRatio="4 / 3" rounded={0} />
        </div>
        <div className={styles.body}>
          <h3 className={styles.name}>{salon.name}</h3>
          <p className={styles.address}>{salon.addressLine}</p>
          <div className={styles.metaRow}>
            {salon.ratingAverage !== null && (
              <span className={styles.rating}>
                <span aria-hidden="true">★</span> {salon.ratingAverage.toFixed(1)}
                <span className={styles.ratingCount}>({salon.ratingCount})</span>
              </span>
            )}
            {salon.priceMin !== null && (
              <span className={styles.price}>
                {formatMoney(salon.priceMin, salon.currency, salon.countryCode)}
                {salon.priceMax !== null && salon.priceMax !== salon.priceMin
                  ? `–${formatMoney(salon.priceMax, salon.currency, salon.countryCode)}`
                  : ""}
              </span>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}
