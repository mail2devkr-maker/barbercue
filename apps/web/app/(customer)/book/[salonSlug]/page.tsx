// Booking flow entry point. Placeholder — booking creation belongs to a later phase.
export default async function BookPage({
  params,
}: {
  params: Promise<{ salonSlug: string }>;
}) {
  const { salonSlug } = await params;
  return (
    <main style={{ padding: "3rem 1.5rem" }}>
      <h1>Book at {salonSlug}</h1>
      <p>Booking flow — placeholder, not yet implemented.</p>
    </main>
  );
}
