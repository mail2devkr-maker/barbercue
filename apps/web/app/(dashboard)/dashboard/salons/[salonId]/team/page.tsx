import { TeamPanel } from "../../../../../../components/owner/TeamPanel";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <main aria-label="Team">
      <TeamPanel salonId={salonId} />
    </main>
  );
}
