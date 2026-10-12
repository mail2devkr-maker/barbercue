import { SalonHome } from "../../../../../components/owner/SalonHome";

// The shop's home. Owners (and delegated admins) get the full Overview; a barber gets "My day".
// Deciding WHICH to show is presentation only - each view reads its own API, which authorizes on the
// server (the overview endpoint is owner-only; the "my work" endpoint is scoped to the signed-in barber).
export default async function SalonHomePage({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <main aria-label="Shop home">
      <SalonHome salonId={salonId} />
    </main>
  );
}
