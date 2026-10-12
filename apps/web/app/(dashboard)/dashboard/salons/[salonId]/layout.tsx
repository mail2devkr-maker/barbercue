import { OwnerShell } from "../../../../../components/owner/OwnerShell";

// Every shop-management and operations page lives inside the Owner shell: a narrow icon rail, the
// grouped navigation sidebar, a toolbar with search/notifications/account, and (on phones) a bottom
// bar. It replaces the former dark scope + horizontal tab strip, so no section page can be a dead
// end and the owner/staff menus come from ONE definition (components/owner/owner-nav.ts).
//
// Nested under salons/layout.tsx's RequireRole gate (owner, staff or delegated platform admin); the
// shell only decides what to PRESENT - every API call re-checks who the caller is at this shop.
export default async function SalonSectionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = await params;
  return <OwnerShell salonId={salonId}>{children}</OwnerShell>;
}
