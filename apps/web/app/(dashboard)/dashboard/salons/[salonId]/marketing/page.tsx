import Link from "next/link";
import { ShopSharePanel } from "../../../../../../components/owner/ShopSharePanel";
import { OwnerOnly } from "../../../../../../components/owner/OwnerOnly";
import { Card, PageHead } from "../../../../../../components/owner/parts";
import ui from "../../../../../../components/owner/owner.module.css";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <OwnerOnly>
      <main aria-label="Marketing">
        <PageHead
          eyebrow="Business"
          title="Marketing"
          sub="Share your shop with customers. Everything on this page is a link or message you send yourself: FastQue does not post, message or email anyone on your behalf."
        />
        <ShopSharePanel salonId={salonId} settingsHref={`/dashboard/salons/${salonId}/settings`} />
        <div className={ui.mt16}>
          <Card title="Offers and promotions">
            <p className={ui.cardSub}>Create offers, promotions and daily deals on the <Link className={ui.cardLink} href={`/dashboard/salons/${salonId}/offers`}>Offers</Link> page, and see which campaign links brought bookings on <Link className={ui.cardLink} href={`/dashboard/salons/${salonId}/booking-sources`}>Booking sources</Link>. Customer invitations from a contact list are not available yet.</p>
          </Card>
        </div>
      </main>
    </OwnerOnly>
  );
}
