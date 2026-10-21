import { PageHead } from "../../../../../../components/owner/parts";
import { OwnerOnly } from "../../../../../../components/owner/OwnerOnly";
import { OwnerAssistant } from "../../../../../../components/owner/OwnerAssistant";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <OwnerOnly>
      <main aria-label="Quick Insights">
        <PageHead eyebrow="Business" title="Quick Insights" sub="Ask about today or right now. Answers come from your shop's recorded numbers. Nothing here changes anything." />
        <OwnerAssistant salonId={salonId} />
      </main>
    </OwnerOnly>
  );
}
