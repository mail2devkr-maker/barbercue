// City discovery hub — placeholder. Real implementation (salon listing, SEO metadata, JSON-LD)
// belongs to the website/SEO phase per PROJECT_STRUCTURE.md; this establishes the URL shape now.
export default async function CityPage({
  params,
}: {
  params: Promise<{ citySlug: string }>;
}) {
  const { citySlug } = await params;
  return (
    <main style={{ padding: "3rem 1.5rem" }}>
      <h1>Barbershops in {citySlug}</h1>
      <p>City discovery page — placeholder, not yet implemented.</p>
    </main>
  );
}
