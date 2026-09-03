import { EditorialImage } from "../editorial/EditorialImage";
import styles from "./landing.module.css";

/**
 * A product-led hero visual: a real BarberCue editorial photograph grounds the card, with a scrim
 * for legibility, and the two frosted cards explain capabilities BarberCue actually has, without
 * inventing wait counts, appointments, customers or marketplace scale.
 */
export function HeroVisual() {
  return (
    <div className={styles.heroVisual} aria-label="Book appointments or follow a live barber queue with FastQue">
      <div className={styles.heroPhoto} aria-hidden="true">
        <EditorialImage id="hero-editorial-band" fill priority sizes="(max-width: 980px) 100vw, 560px" />
      </div>
      <div className={styles.heroPhotoScrim} aria-hidden="true" />

      <div className={styles.visualLabel}>
        <span className={styles.liveDot} aria-hidden="true" />
        Built for the barber floor
      </div>

      <div className={`${styles.productCard} ${styles.queueProductCard}`}>
        <div className={styles.productCardHead}>
          <span>Live queue</span>
          <span className={styles.productTag}>Real-time</span>
        </div>
        <strong>Keep your place without the waiting room.</strong>
        <div className={styles.queueTrack} aria-hidden="true">
          <span className={styles.queueTrackDone} />
          <span className={styles.queueTrackCurrent} />
          <span />
          <span />
        </div>
        <p>Join remotely. Follow the line. Arrive closer to your turn.</p>
      </div>

      <div className={`${styles.productCard} ${styles.bookingProductCard}`}>
        <span className={styles.productKicker}>Book ahead</span>
        <strong>Service → Barber → Time</strong>
        <p>Choose the chair that fits your day.</p>
      </div>
    </div>
  );
}
