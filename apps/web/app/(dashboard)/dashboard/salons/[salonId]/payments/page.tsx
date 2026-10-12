import { PaymentsPanel } from "../../../../../../components/owner/FinancePanels";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <main aria-label="Payments">
      <PaymentsPanel salonId={salonId} />
    </main>
  );
}
