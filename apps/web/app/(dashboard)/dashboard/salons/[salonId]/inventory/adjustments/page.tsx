import { MovementWorkspace } from "../../../../../../../components/owner/inventory/StockViews";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return <MovementWorkspace salonId={salonId} kind="ADJUSTMENT" />;
}
