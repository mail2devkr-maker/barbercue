import { OfflineBanner } from "../../components/layout/OfflineBanner";

export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OfflineBanner />
      {children}
    </>
  );
}
