import { PageHead } from "../../../../../../components/owner/parts";
import { OwnerOnly } from "../../../../../../components/owner/OwnerOnly";
import { ShopLocation } from "../../../../../../components/owner/ShopLocation";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <OwnerOnly>
      <main aria-label="Shop location">
        <PageHead
          eyebrow="Shop"
          title="Shop location"
          sub="Tell FastQue where your shop is so customers can find you and see how far you are. Every proposal is reviewed before it is shown."
        />
        <ShopLocation salonId={salonId} />
      </main>
    </OwnerOnly>
  );
}
