import { ShopSharePanel } from "../../../../../../components/owner/ShopSharePanel";
import { Card, PageHead } from "../../../../../../components/owner/parts";
import ui from "../../../../../../components/owner/owner.module.css";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <main aria-label="Marketing">
      <PageHead
        eyebrow="Business"
        title="Marketing"
        sub="Share your shop with customers. Everything on this page is a link or message you send yourself: FastQue does not post, message or email anyone on your behalf."
      />
      <ShopSharePanel salonId={salonId} settingsHref={`/dashboard/salons/${salonId}/settings`} />
      <div className={ui.mt16}>
        <Card title="Offers and promotions">
          <p className={ui.cardSub}>Creating discounts and daily deals, customer invitations from a contact list, and campaign results are not available yet. They need new server features and will appear here once they exist.</p>
        </Card>
      </div>
    </main>
  );
}
