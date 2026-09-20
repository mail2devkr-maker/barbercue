import { DashboardHeader } from "../../components/layout/DashboardHeader";
import { OfflineBanner } from "../../components/layout/OfflineBanner";
import { SiteFooter } from "../../components/layout/SiteFooter";

export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OfflineBanner />
      <DashboardHeader />
      {children}
      <SiteFooter />
    </>
  );
}
