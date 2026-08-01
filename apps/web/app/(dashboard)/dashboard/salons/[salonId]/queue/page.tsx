// Live queue view for salon staff/owners. Placeholder — the queue engine is a later phase.
export default async function DashboardQueuePage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = await params;
  return (
    <main style={{ padding: "3rem 1.5rem" }}>
      <h1>Queue — salon {salonId}</h1>
      <p>Live queue dashboard — placeholder, not yet implemented.</p>
    </main>
  );
}
