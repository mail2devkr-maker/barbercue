import type { Metadata } from "next";
import { ShopCheckout } from "../../../../components/shop/ShopCheckout";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function ShopCheckoutPage() {
  return <ShopCheckout />;
}
