import type { Metadata } from "next";
import { ShopOrderView } from "../../../../../components/shop/ShopCheckout";

// Private order pages: never indexed, and the access secret stays out of the referrer.
export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ShopOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { orderNumber } = await params;
  const sp = await searchParams;
  const token = typeof sp.t === "string" ? sp.t : null;
  return <ShopOrderView orderNumber={orderNumber} token={token} isNew={sp.new === "1"} />;
}
