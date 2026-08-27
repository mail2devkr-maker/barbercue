import Link from "next/link";
import type { SalonListItemDto } from "@barbercue/shared";
import { formatMoney } from "@barbercue/shared";
import { SalonImage } from "../ui/SalonImage";
import styles from "./salon-card.module.css";

export function SalonCard({ salon, styleName }: { salon: SalonListItemDto; styleName?: string }) {
  const countryCode = salon.countryCode.toLowerCase();
  const profileParams = styleName ? `?style=${encodeURIComponent(styleName)}` : "";
  const actionParams = new URLSearchParams({
    city: salon.citySlug,
    country: salon.countryCode,
  });
  if (styleName) actionParams.set("style", styleName);

  const profileHref = `/${countryCode}/${salon.citySlug}/${salon.slug}${profileParams}`;
  const bookingHref = `/book/${salon.slug}?${actionParams.toString()}`;
  const queueHref = `/queue/${salon.slug}?${actionParams.toString()}`;

  return (
    <article className={styles.card}>
      <Link href={profileHref} className={styles.imageLink} aria-label={`View ${salon.name}`}>
        <SalonImage
          url={salon.coverPhotoUrl}
          alt={`${salon.name} barbershop`}
          aspectRatio="4 / 3"
          rounded={0}
        />
      </Link>

      <div className={styles.body}>
        <div className={styles.titleRow}>
          <div>
            <Link href={profileHref} className={styles.nameLink}>
              <h3 className={styles.name}>{salon.name}</h3>
            </Link>
            <p className={styles.address}>{salon.addressLine}</p>
          </div>
          {salon.ratingAverage !== null && (
            <span className={styles.rating} aria-label={`${salon.ratingAverage.toFixed(1)} out of 5`}>
              <span aria-hidden="true">★</span> {salon.ratingAverage.toFixed(1)}
            </span>
          )}
        </div>

        <div className={styles.metaRow}>
          <span>
            {salon.ratingAverage === null
              ? "New on BarberCue"
              : `${salon.ratingCount} ${salon.ratingCount === 1 ? "review" : "reviews"}`}
          </span>
          {salon.priceMin !== null && (
            <strong>
              From {formatMoney(salon.priceMin, salon.currency, salon.countryCode)}
            </strong>
          )}
        </div>

        <div className={styles.actions}>
          <Link href={bookingHref} className={styles.primaryAction}>
            Book
          </Link>
          <Link href={queueHref} className={styles.secondaryAction}>
            Join queue
          </Link>
        </div>
      </div>
    </article>
  );
}
