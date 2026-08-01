// Chair management (Chair). Placeholder — owner-only in the finalized RBAC model.
export default async function DashboardChairsPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = await params;
  return (
    <main style={{ padding: "3rem 1.5rem" }}>
      <h1>Chairs — salon {salonId}</h1>
      <p>Chair management — placeholder, not yet implemented.</p>
    </main>
  );
}
