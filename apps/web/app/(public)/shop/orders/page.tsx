import type { Metadata } from "next";
import { ShopOrdersList } from "../../../../components/shop/ShopCheckout";

export const metadata: Metadata = { title: "My orders", robots: { index: false } };

export default function ShopOrdersPage() {
  return <ShopOrdersList />;
}
