import { BoltIcon, CalendarCheckIcon, StoreIcon, HeartIcon } from "./icons";
import styles from "./landing.module.css";

const FEATURES = [
  { icon: BoltIcon, label: "Real-time Queue" },
  { icon: CalendarCheckIcon, label: "Easy Booking" },
  { icon: StoreIcon, label: "Trusted Shops" },
  { icon: HeartIcon, label: "Better Experience" },
];

/** The four-item feature strip under the hero search bar (Reference B). */
export function HeroFeatureRow() {
  return (
    <ul className={styles.featureRow} aria-label="Why FastQue">
      {FEATURES.map(({ icon: Icon, label }) => (
        <li key={label} className={styles.featureItem}>
          <Icon className={styles.featureIcon} />
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}
