import { Suspense } from "react";
import { OwnerOnly } from "../../../../../../components/owner/OwnerOnly";
import { OwnerHomeServices } from "../../../../../../components/home/OwnerHomeServices";

export default async function HomeServicesPage({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <OwnerOnly>
      <Suspense>
        <OwnerHomeServices salonId={salonId} />
      </Suspense>
    </OwnerOnly>
  );
}
