"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ShopProductDetailDto } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useWishlist, wishlist } from "../../lib/shop/store";
import { CardGrid } from "./ShopParts";
import s from "./shop.module.css";

/** Saved products: on this device for guests, merged with the account's list for signed-in customers. */
export function ShopWishlist() {
  const ids = useWishlist();
  const { user } = useAuth();
  const [items, setItems] = useState<ShopProductDetailDto[] | null>(null);

  useEffect(() => {
    if (!user?.roles.includes("CUSTOMER")) return;
    apiFetch<string[]>("customer/shop/wishlist")
      .then((server) => {
        const merged = [...new Set([...ids, ...server])];
        if (merged.length !== ids.length) wishlist.set(merged);
        for (const id of ids.filter((i) => !server.includes(i))) void apiFetch(`customer/shop/wishlist/${id}`, { method: "PUT" }).catch(() => undefined);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- merge once per sign-in
  }, [user]);

  useEffect(() => {
    if (!ids.length) return;
    Promise.all(ids.slice(0, 48).map((id) => apiFetch<ShopProductDetailDto>(`shop/products/${id}`).catch(() => null))).then((rows) =>
      setItems(rows.filter((r): r is ShopProductDetailDto => !!r)),
    );
  }, [ids]);

  return (
    <main style={{ paddingTop: 20 }} aria-labelledby="wish-title">
      <h1 id="wish-title" className={s.h2}>Wishlist</h1>
      <p className={s.sub}>{user ? "Saved to your FastQue account." : "Saved on this device. Sign in to keep it on your account."}</p>
      <div style={{ marginTop: 16 }}>
        {!ids.length || (items && items.length === 0) ? (
          <div className={s.empty}><strong>Nothing saved yet</strong><span>Tap ♡ on any product to save it.</span><Link href="/shop/browse" className={`${s.btn} ${s.btnPrimary}`}>Find favourites</Link></div>
        ) : (
          <CardGrid items={items?.filter((p) => ids.includes(p.id)) ?? null} />
        )}
      </div>
    </main>
  );
}
