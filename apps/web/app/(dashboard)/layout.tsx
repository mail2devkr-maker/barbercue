import { DashboardHeader } from "../../components/layout/DashboardHeader";

export default function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DashboardHeader />
      {children}
    </>
  );
}
