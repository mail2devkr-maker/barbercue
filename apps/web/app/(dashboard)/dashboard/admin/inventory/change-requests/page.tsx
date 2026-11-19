import { Suspense } from "react";
import { AdminChangeRequests } from "../../../../../../components/admin/inventory/AdminChangeRequests";

export default function AdminCatalogChangeRequestsPage() {
  return (
    <Suspense fallback={null}>
      <AdminChangeRequests />
    </Suspense>
  );
}
