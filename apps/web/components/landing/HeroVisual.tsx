import styles from "./landing.module.css";

/**
 * A product-led hero visual rather than a fabricated salon photograph. The chair illustration is
 * decorative; the two cards explain capabilities BarberCue actually has, without inventing wait
 * counts, appointments, customers or marketplace scale.
 */
export function HeroVisual() {
  return (
    <div className={styles.heroVisual} aria-label="Book appointments or follow a live barber queue with BarberCue">
      <div className={styles.heroVisualGlow} aria-hidden="true" />
      <div className={styles.chairScene} aria-hidden="true">
        <svg viewBox="0 0 520 620" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M92 40H428" stroke="currentColor" strokeWidth="2" opacity=".16" />
          <path d="M64 566H456" stroke="currentColor" strokeWidth="2" opacity=".16" />
          <rect x="132" y="68" width="256" height="250" rx="128" stroke="currentColor" strokeWidth="3" opacity=".3" />
          <rect x="158" y="94" width="204" height="198" rx="102" fill="currentColor" opacity=".05" />
          <path d="M214 246C214 217 234 196 260 196C286 196 306 217 306 246V300H214V246Z" fill="currentColor" opacity=".82" />
          <path d="M184 302C184 276 205 255 231 255H289C315 255 336 276 336 302V398C336 420 318 438 296 438H224C202 438 184 420 184 398V302Z" fill="currentColor" />
          <path d="M172 334H348" stroke="#E9C77A" strokeWidth="7" strokeLinecap="round" />
          <path d="M190 438H330L348 486H172L190 438Z" fill="currentColor" opacity=".86" />
          <path d="M260 486V552" stroke="currentColor" strokeWidth="12" strokeLinecap="round" />
          <path d="M208 552H312" stroke="currentColor" strokeWidth="12" strokeLinecap="round" />
          <path d="M136 284L184 326" stroke="currentColor" strokeWidth="13" strokeLinecap="round" />
          <path d="M384 284L336 326" stroke="currentColor" strokeWidth="13" strokeLinecap="round" />
          <circle cx="412" cy="128" r="7" fill="#E9C77A" />
          <circle cx="108" cy="434" r="5" fill="#E9C77A" opacity=".8" />
        </svg>
      </div>

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
