import { InvoicesPanel } from "../../../../../../components/owner/InvoicesPanel";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <main aria-label="Billing and invoices">
      <InvoicesPanel salonId={salonId} />
    </main>
  );
}
