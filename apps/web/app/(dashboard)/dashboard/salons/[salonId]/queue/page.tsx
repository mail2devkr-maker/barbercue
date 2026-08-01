import { DashboardQueueView } from "../../../../../../components/queue/DashboardQueueView";

// Live queue view for salon staff/owners — call/assign/complete/no-show/cancel and staff
// clock-in/out, all with realtime push updates over the /realtime socket namespace.
export default async function DashboardQueuePage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = await params;
  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 900, margin: "0 auto" }}>
      <h1>Live queue</h1>
      <DashboardQueueView salonId={salonId} />
    </main>
  );
}
