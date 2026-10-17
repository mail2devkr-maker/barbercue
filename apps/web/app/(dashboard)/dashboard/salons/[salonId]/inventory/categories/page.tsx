import { CategoriesView } from "../../../../../../../components/owner/inventory/LookupViews";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return <CategoriesView salonId={salonId} />;
}
