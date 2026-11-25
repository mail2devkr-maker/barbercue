import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CustomerShell } from "../../components/layout/CustomerShell";

// Not indexed: the public pages are behind a switch and the rest is private.
export const metadata: Metadata = {
  title: { default: "FastQue Home", template: "%s | FastQue Home" },
  robots: { index: false, follow: false },
  referrer: "strict-origin-when-cross-origin",
};

export default function HomeLayout({ children }: { children: ReactNode }) {
  return <CustomerShell>{children}</CustomerShell>;
}
