import type { Metadata } from "next";
import { ShopBag } from "../../../../components/shop/ShopCheckout";

export const metadata: Metadata = { title: "Your bag", robots: { index: false } };

export default function ShopBagPage() {
  return <ShopBag />;
}
