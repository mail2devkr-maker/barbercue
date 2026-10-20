import { RevenuePanel } from "../../../../../../components/owner/FinancePanels";
import { RevenueReport } from "../../../../../../components/owner/RevenueReport";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <main aria-label="Revenue">
      <RevenuePanel salonId={salonId} />
      <RevenueReport salonId={salonId} />
    </main>
  );
}
