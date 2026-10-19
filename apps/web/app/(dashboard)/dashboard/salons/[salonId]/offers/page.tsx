import { PageHead } from "../../../../../../components/owner/parts";
import { OwnerOnly } from "../../../../../../components/owner/OwnerOnly";
import { OffersWorkspace } from "../../../../../../components/owner/offers/OffersWorkspace";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <OwnerOnly>
      <main aria-label="Offers">
        <PageHead eyebrow="Business" title="Offers and promotions" sub="Offers, promotions and daily deals that reduce the price of online bookings. Nothing here takes a payment or sends a message." />
        <OffersWorkspace salonId={salonId} />
      </main>
    </OwnerOnly>
  );
}
