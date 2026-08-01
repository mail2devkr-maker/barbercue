// Generic JSON-LD injector. `data` is any schema.org-shaped plain object — JSON.stringify is safe
// here (no user-controlled HTML is ever interpolated raw; this is structured data, not markup).
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
