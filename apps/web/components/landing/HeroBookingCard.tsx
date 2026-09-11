import Link from "next/link";
import { ServiceIcon, BarberIcon, TimeIcon } from "./icons";
import styles from "./landing.module.css";

const ROWS = [
  { icon: ServiceIcon, label: "Service" },
  { icon: BarberIcon, label: "Barber" },
  { icon: TimeIcon, label: "Time" },
];

/**
 * The floating "Book ahead" teaser card shown next to the hero photo on wide desktop viewports
 * (Reference A). The whole card is a real link into search/booking rather than a static
 * decoration, since every FastQue booking flow starts from choosing a shop there first.
 */
export function HeroBookingCard() {
  return (
    <Link href="/search" className={styles.bookingCard} aria-label="Book ahead — choose the chair that fits your day">
      <span className={styles.bookingCardKicker}>Book ahead</span>
      <ul className={styles.bookingCardRows}>
        {ROWS.map(({ icon: Icon, label }) => (
          <li key={label}>
            <Icon className={styles.bookingCardIcon} />
            {label}
          </li>
        ))}
      </ul>
      <p className={styles.bookingCardNote}>
        Choose the chair that
        <br />
        fits your day.
      </p>
    </Link>
  );
}
