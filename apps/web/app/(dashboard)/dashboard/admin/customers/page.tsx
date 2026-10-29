import { Suspense } from "react";
import { CustomersOverview } from "../../../../../components/admin/people/CustomersOverview";

export default function AdminCustomersPage() {
  return (
    <Suspense fallback={null}>
      <CustomersOverview />
    </Suspense>
  );
}
