import { PageHead } from "../../../../../../components/owner/parts";
import { OwnerOnly } from "../../../../../../components/owner/OwnerOnly";
import { ContactsWorkspace } from "../../../../../../components/owner/ContactsWorkspace";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <OwnerOnly>
      <main aria-label="Contact list check">
        <PageHead
          eyebrow="Business"
          title="Contact list check"
          sub="Check a list of phone numbers before you invite people. Nobody is contacted."
        />
        <ContactsWorkspace salonId={salonId} />
      </main>
    </OwnerOnly>
  );
}
