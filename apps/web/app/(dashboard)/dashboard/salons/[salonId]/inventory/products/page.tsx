import { ProductsView } from "../../../../../../../components/owner/inventory/ProductsView";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return <ProductsView salonId={salonId} />;
}
