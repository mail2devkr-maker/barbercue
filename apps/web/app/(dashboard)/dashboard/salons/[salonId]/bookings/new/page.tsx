import { InShopAppointmentForm } from "../../../../../../../components/owner/InShopAppointmentForm";

export default async function NewInShopAppointmentPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = await params;
  return (
    <main aria-label="New in-shop appointment">
      <InShopAppointmentForm salonId={salonId} />
    </main>
  );
}
