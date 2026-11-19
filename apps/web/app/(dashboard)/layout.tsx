import type { Metadata } from "next";
import { OfflineBanner } from "../../components/layout/OfflineBanner";

// Owner/admin dashboards are private: never in search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OfflineBanner />
      {children}
    </>
  );
}
