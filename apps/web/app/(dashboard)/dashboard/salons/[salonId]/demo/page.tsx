import { PageHead } from "../../../../../../components/owner/parts";
import { DemoWorkspace } from "../../../../../../components/owner/DemoWorkspace";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <main aria-label="Demo data">
      <PageHead eyebrow="Shop" title="Demo data" sub="Sample data in a private workspace, separate from your real shop records." />
      <DemoWorkspace salonId={salonId} />
    </main>
  );
}
