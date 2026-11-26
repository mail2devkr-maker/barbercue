import { Suspense } from "react";
import { AdminGrowth } from "../../../../../components/admin/growth/AdminGrowth";

export default function AdminGrowthPage() {
  return (
    <Suspense fallback={null}>
      <AdminGrowth />
    </Suspense>
  );
}
