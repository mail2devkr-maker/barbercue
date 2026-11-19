import { Suspense } from "react";
import { AdminMarketplace } from "../../../../../components/admin/marketplace/AdminMarketplace";

export default function AdminMarketplacePage() {
  return (
    <Suspense fallback={null}>
      <AdminMarketplace />
    </Suspense>
  );
}
