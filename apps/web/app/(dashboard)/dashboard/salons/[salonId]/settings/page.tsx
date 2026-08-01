// Salon settings — payment policy (SalonPaymentPolicy) and cancellation policy
// (CancellationPolicy) configuration. Placeholder — owner-only.
export default async function DashboardSettingsPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = await params;
  return (
    <main style={{ padding: "3rem 1.5rem" }}>
      <h1>Settings — salon {salonId}</h1>
      <p>Payment policy and cancellation policy settings — placeholder, not yet implemented.</p>
    </main>
  );
}
