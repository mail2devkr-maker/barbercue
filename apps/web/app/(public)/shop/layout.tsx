import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ShopFrame } from "../../../components/shop/ShopParts";

export const metadata: Metadata = {
  title: { default: "Marketplace — beauty from salons near you", template: "%s · Marketplace" },
  description: "Shop hair care, skin care, makeup and grooming products stocked by FastQue partner salons near you. Compare salon prices and pick up nearby — no appointment needed.",
  alternates: { canonical: "/shop" },
};

export default function ShopLayout({ children }: { children: ReactNode }) {
  return <ShopFrame>{children}</ShopFrame>;
}
