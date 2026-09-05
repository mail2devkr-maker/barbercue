import { OwnerShopNav } from "../../../../../components/dashboard/OwnerShopNav";
import { AdminManagingBanner } from "../../../../../components/dashboard/AdminManagingBanner";

// Issue #13 Mission B: wraps every shop-management section (queue, settings, bookings,
// schedule, customers, analytics, reviews, verification, services, hours, photos, chairs,
// staff) with one persistent nav, so entering any single section is never a dead end — see
// OwnerShopNav's own doc comment for the full reasoning. Nested under salons/layout.tsx's
// existing RequireRole gate, so no auth duplication is needed here.
//
// AdminManagingBanner (Part 2) renders here too, once, so every section under a shop — not just
// the handful with delegated-admin backend support today — visibly discloses an admin session
// rather than only the ones an admin can currently mutate.
export default async function SalonSectionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = await params;
  return (
    <>
      <OwnerShopNav salonId={salonId} />
      <AdminManagingBanner />
      {children}
    </>
  );
}
