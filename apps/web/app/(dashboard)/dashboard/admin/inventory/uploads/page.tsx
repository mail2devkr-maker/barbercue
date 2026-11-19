import { Suspense } from "react";
import { UploadHistory } from "../../../../../../components/admin/inventory/AdminInventoryUpload";

export default function AdminInventoryUploadHistoryPage() {
  return (
    <Suspense fallback={null}>
      <UploadHistory standalone />
    </Suspense>
  );
}
