import { PageHead } from "../../../../../../components/owner/parts";
import { ContactListCheck } from "../../../../../../components/owner/ContactListCheck";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <main aria-label="Contact list check">
      <PageHead
        eyebrow="Business"
        title="Contact list check"
        sub="Check a list of phone numbers before you invite people. Nothing is saved and nobody is contacted."
      />
      <ContactListCheck salonId={salonId} />
    </main>
  );
}
