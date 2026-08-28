import { DashboardQueueView } from "../../../../../../components/queue/DashboardQueueView";
import { SetupNavigation } from "../../../../../../components/dashboard/SetupNavigation";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

// Live queue view for salon staff/owners — call/assign/complete/no-show/cancel and staff
// clock-in/out, all with realtime push updates over the /realtime socket namespace.
export default async function DashboardQueuePage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = await params;
  return (
    <main className={styles.pageWide}>
      <h1 className={styles.pageTitle}>Live queue</h1>
      <p className={styles.pageSubtitle}>
        Your operational floor: call, assign and complete customer visits in real time.
      </p>
      <SetupNavigation salonId={salonId} currentStep="queue" section="steps" />
      <DashboardQueueView salonId={salonId} />
      <SetupNavigation
        salonId={salonId}
        currentStep="queue"
        section="actions"
        nextAction={{
          kind: "link",
          href: `/dashboard/salons/${salonId}/settings?setup=complete`,
          label: "Finish setup",
        }}
      />
    </main>
  );
}
