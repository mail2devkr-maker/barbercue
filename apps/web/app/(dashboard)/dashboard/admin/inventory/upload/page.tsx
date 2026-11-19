import { Suspense } from "react";
import { AdminInventoryUpload } from "../../../../../../components/admin/inventory/AdminInventoryUpload";

export default function AdminInventoryUploadPage() {
  return (
    <Suspense fallback={null}>
      <AdminInventoryUpload />
    </Suspense>
  );
}
