import { EditorialImage } from "../editorial/EditorialImage";
import styles from "./landing.module.css";

/**
 * The hero photograph behind the public landing headline, shared by every breakpoint — a real
 * BarberCue editorial photograph (a barber actively cutting a client's hair) with a dark scrim for
 * text contrast, matching the reference screenshots' cinematic barbershop hero.
 *
 * Rendered at its own natural aspect ratio (900x672, no `fill`/`object-fit: cover`) rather than
 * stretched to cover the full-bleed hero width — a wide hero covering a 4:3 source under `cover`
 * scaled the photo (and the customer's head with it) far beyond its intended size. See
 * .heroPhotoImg's own comment for the right-anchored, intrinsic-ratio sizing this enables instead.
 */
export function HeroVisual() {
  return (
    <div className={styles.heroMedia} aria-hidden="true">
      <EditorialImage
        id="barber-flagship"
        priority
        sizes="(max-width: 720px) 100vw, 900px"
        className={styles.heroPhotoImg}
      />
      <div className={styles.heroScrim} />
    </div>
  );
}
