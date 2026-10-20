import { PageHead } from "../../../../../../../components/owner/parts";
import { OwnerOnly } from "../../../../../../../components/owner/OwnerOnly";
import { DemoDashboard } from "../../../../../../../components/owner/DemoDashboard";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <OwnerOnly>
      <main aria-label="Demo dashboard">
        <PageHead eyebrow="Demo" title="Demo dashboard" sub="A read-only look at sample data. It is not your real shop." />
        <DemoDashboard salonId={salonId} />
      </main>
    </OwnerOnly>
  );
}
