import { Suspense } from "react";
import { AdminFinance } from "../../../../../components/admin/finance/AdminFinance";

export default function AdminFinancePage() {
  return (
    <Suspense fallback={null}>
      <AdminFinance />
    </Suspense>
  );
}
