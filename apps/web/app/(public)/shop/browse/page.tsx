import type { Metadata } from "next";
import { Suspense } from "react";
import { ShopBrowse } from "../../../../components/shop/ShopBrowse";

export const metadata: Metadata = {
  title: "Shop all beauty & grooming",
  description: "Search FastQue Marketplace by product, brand, category or barcode. Filter by price, offers and salons near you.",
  alternates: { canonical: "/shop/browse" },
};

export default function ShopBrowsePage() {
  return (
    <Suspense fallback={null}>
      <ShopBrowse />
    </Suspense>
  );
}
