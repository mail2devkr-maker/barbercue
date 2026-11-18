import { OwnerOnly } from "../../../../../../components/owner/OwnerOnly";
import { SellOnFastQue } from "../../../../../../components/owner/shop/SellOnFastQue";

export default async function SellOnFastQuePage({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <OwnerOnly>
      <SellOnFastQue salonId={salonId} />
    </OwnerOnly>
  );
}
