import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CustomerShell } from "../../components/layout/CustomerShell";

export const metadata: Metadata = {
  title: { default: "FastQue Work", template: "%s | FastQue Work" },
  description: "Find real paid work near you, know your earnings upfront and get paid reliably.",
};

export default function WorkLayout({ children }: { children: ReactNode }) {
  return <CustomerShell>{children}</CustomerShell>;
}
