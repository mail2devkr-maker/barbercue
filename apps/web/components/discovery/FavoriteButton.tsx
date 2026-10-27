"use client";

import { useState } from "react";
import { useFavorites } from "../../lib/favorites";
import styles from "./favorite-button.module.css";

/**
 * Heart toggle on salon cards and comparison rows. Outlined when not saved, filled red when saved.
 * Signed-out taps go to login and the salon is saved on return (see lib/favorites.ts).
 */
export function FavoriteButton({ salonId, salonName, variant = "overlay" }: { salonId: string; salonName: string; variant?: "overlay" | "inline" }) {
  const { isFavorite, toggle } = useFavorites();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const saved = isFavorite(salonId);

  return (
    <button
      type="button"
      className={`${styles.heart} ${variant === "overlay" ? styles.overlay : styles.inline} ${saved ? styles.saved : ""}`}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${salonName} from favorites` : `Save ${salonName} to favorites`}
      title={failed ? "Couldn’t update favorites. Try again." : saved ? "Saved to favorites" : "Save to favorites"}
      disabled={busy}
      onClick={async (event) => {
        // Cards are links in places; the heart must never navigate.
        event.preventDefault();
        event.stopPropagation();
        setBusy(true);
        setFailed(false);
        try {
          await toggle(salonId);
        } catch {
          setFailed(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M12 20.3s-7.6-4.6-9.3-9.2C1.6 8 3.6 4.7 6.9 4.7c2 0 3.3 1.1 5.1 3 1.8-1.9 3.1-3 5.1-3 3.3 0 5.3 3.3 4.2 6.4-1.7 4.6-9.3 9.2-9.3 9.2z"
          fill={saved ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
