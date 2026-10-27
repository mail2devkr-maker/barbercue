"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FAVORITES_PATHS, type FavoriteSalonDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../lib/api";
import { sortFavorites, useFavorites, type FavoriteSort } from "../../../../lib/favorites";
import { SalonCard } from "../../../../components/discovery/SalonCard";
import styles from "./favorites.module.css";

/** The customer's saved salons, each with Book / Join queue and the heart to remove it. */
export default function FavoritesPage() {
  const [items, setItems] = useState<FavoriteSalonDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<FavoriteSort>("recent");
  const { isFavorite, loaded } = useFavorites();

  useEffect(() => {
    apiFetch<FavoriteSalonDto[]>(FAVORITES_PATHS.favorites)
      .then(setItems)
      .catch((requestError) => setError(requestError instanceof ApiError ? requestError.message : "Couldn’t load your favorites."));
  }, []);

  // A heart tapped on this page removes the salon straight away (the shared store is updated
  // optimistically, so the list follows it without a reload).
  // Until the shared heart state has loaded, show everything (no flash of an empty list).
  const shown = useMemo(
    () => sortFavorites((items ?? []).filter((item) => !loaded || isFavorite(item.id)), sort),
    [items, sort, isFavorite, loaded],
  );

  return (
    <section className={styles.page} aria-labelledby="favorites-title">
      <div className={styles.head}>
        <div>
          <h1 id="favorites-title" className={styles.title}>Favorite salons</h1>
          <p className={styles.sub}>Salons you saved with the heart. Book again in one tap.</p>
        </div>
        {items && items.length > 1 && (
          <label className={styles.sort}>
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value as FavoriteSort)}>
              <option value="recent">Recently saved</option>
              <option value="rating">Rating</option>
              <option value="name">Name</option>
            </select>
          </label>
        )}
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {!items && !error && <p className={styles.muted} role="status">Loading your favorites…</p>}

      {items && shown.length === 0 && (
        <div className={styles.empty}>
          <span aria-hidden="true">♡</span>
          <h2>No favorites yet</h2>
          <p>Tap the heart on any salon to save it here.</p>
          <Link href="/search" className={styles.cta}>Find salons</Link>
        </div>
      )}

      {shown.length > 0 && (
        <div className={styles.grid}>
          {shown.map((salon) => (
            <SalonCard key={salon.id} salon={salon} />
          ))}
        </div>
      )}
    </section>
  );
}
