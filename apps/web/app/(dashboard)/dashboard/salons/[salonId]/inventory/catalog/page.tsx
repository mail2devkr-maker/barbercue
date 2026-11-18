import { OwnerCatalog } from "../../../../../../../components/owner/inventory/OwnerCatalog";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return <OwnerCatalog salonId={salonId} />;
}
