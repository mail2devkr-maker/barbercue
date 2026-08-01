// Public salon profile page — placeholder. Real implementation (services/prices/hours/photos/
// reviews, canonical URL, OG tags, HairSalon + BreadcrumbList JSON-LD) belongs to the
// website/SEO phase per PROJECT_STRUCTURE.md; this establishes the URL shape now.
export default async function SalonPage({
  params,
}: {
  params: Promise<{ citySlug: string; salonSlug: string }>;
}) {
  const { citySlug, salonSlug } = await params;
  return (
    <main style={{ padding: "3rem 1.5rem" }}>
      <h1>{salonSlug}</h1>
      <p>
        Salon profile page in {citySlug} — placeholder, not yet implemented.
      </p>
    </main>
  );
}
