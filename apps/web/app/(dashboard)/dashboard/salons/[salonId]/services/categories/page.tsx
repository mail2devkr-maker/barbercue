import { ServiceCategoryManager } from "../../../../../../../components/dashboard/ServiceCategoryManager";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return <ServiceCategoryManager salonId={salonId} />;
}
