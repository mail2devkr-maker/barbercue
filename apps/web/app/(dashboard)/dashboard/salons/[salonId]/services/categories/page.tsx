import { ServiceCategoryManager } from "../../../../../../../components/dashboard/ServiceCategoryManager";
import { OwnerOnly } from "../../../../../../../components/owner/OwnerOnly";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <OwnerOnly>
      <ServiceCategoryManager salonId={salonId} />
    </OwnerOnly>
  );
}
