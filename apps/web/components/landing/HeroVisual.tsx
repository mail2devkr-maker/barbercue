import { EditorialImage } from "../editorial/EditorialImage";
import styles from "./landing.module.css";

/**
 * The full-bleed hero photograph behind the public landing headline, shared by every breakpoint —
 * a real BarberCue editorial photograph (a barber actively cutting a client's hair) with a dark
 * scrim for text contrast, matching the reference screenshots' cinematic barbershop hero.
 */
export function HeroVisual() {
  return (
    <div className={styles.heroMedia} aria-hidden="true">
      <EditorialImage
        id="barber-flagship"
        fill
        priority
        sizes="100vw"
        className={styles.heroPhotoImg}
      />
      <div className={styles.heroScrim} />
    </div>
  );
}
