import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { workMarketplaceLinksEnabled } from "../../lib/dashboard-flags";
import { CustomerShell } from "../../components/layout/CustomerShell";

export const metadata: Metadata = {
  title: { default: "FastQue Work", template: "%s | FastQue Work" },
  description: "Find real paid work near you, know your earnings upfront and get paid reliably.",
};

export default function WorkLayout({ children }: { children: ReactNode }) {
  // Dark launch: until the marketplace is switched on, /work is a real 404 (not an empty shell
  // that Google could index while every API call answers "not available").
  if (!workMarketplaceLinksEnabled()) notFound();
  return <CustomerShell>{children}</CustomerShell>;
}
