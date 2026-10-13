import { CancellationsPanel } from "../../../../../../components/owner/CancellationsPanel";

export default async function Page({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = await params;
  return (
    <main aria-label="Cancellations">
      <CancellationsPanel salonId={salonId} />
    </main>
  );
}
