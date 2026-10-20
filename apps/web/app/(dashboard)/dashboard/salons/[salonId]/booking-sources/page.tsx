import { PageHead } from "../../../../../../components/owner/parts";
import { OwnerOnly } from "../../../../../../components/owner/OwnerOnly";
import { BookingSources } from "../../../../../../components/owner/BookingSources";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <OwnerOnly>
      <main aria-label="Booking sources">
        <PageHead
          eyebrow="Business"
          title="Booking sources"
          sub="See how bookings reach your shop, and create campaign codes for the places you share it."
        />
        <BookingSources salonId={salonId} />
      </main>
    </OwnerOnly>
  );
}
