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
    <main style={{ padding: "2.5rem 1.5rem 3rem", maxWidth: 900, margin: "0 auto" }}>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: "1.8rem",
          letterSpacing: "-0.01em",
          marginBottom: 20,
          color: "var(--bc-ink)",
        }}
      >
        Live queue
      </h1>
      <DashboardQueueView salonId={salonId} />
    </main>
  );
}
