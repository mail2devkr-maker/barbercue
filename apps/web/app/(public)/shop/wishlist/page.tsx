import type { Metadata } from "next";
import { ShopWishlist } from "../../../../components/shop/ShopWishlist";

export const metadata: Metadata = { title: "Wishlist", robots: { index: false } };

export default function ShopWishlistPage() {
  return <ShopWishlist />;
}
