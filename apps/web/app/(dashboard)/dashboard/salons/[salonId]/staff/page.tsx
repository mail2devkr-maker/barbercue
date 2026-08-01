// Staff roster management (SalonStaff). Placeholder — owner-only in the finalized RBAC model.
export default async function DashboardStaffPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = await params;
  return (
    <main style={{ padding: "3rem 1.5rem" }}>
      <h1>Staff — salon {salonId}</h1>
      <p>Staff roster management — placeholder, not yet implemented.</p>
    </main>
  );
}
