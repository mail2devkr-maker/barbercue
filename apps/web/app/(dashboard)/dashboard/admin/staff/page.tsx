import { Suspense } from "react";
import { StaffOverview } from "../../../../../components/admin/people/StaffOverview";

export default function AdminStaffPage() {
  return (
    <Suspense fallback={null}>
      <StaffOverview />
    </Suspense>
  );
}
