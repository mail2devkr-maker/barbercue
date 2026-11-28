import { Suspense } from "react";
import { OwnerConnect } from "../../../../../../components/connect/OwnerConnect";

// Owners and staff with a FastQue Connect grant. The API re-checks every request.
export default async function ConnectPage({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return <Suspense><OwnerConnect salonId={salonId} /></Suspense>;
}
