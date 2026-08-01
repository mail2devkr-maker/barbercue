import type { Metadata } from "next";
import Link from "next/link";
import { DISCOVERY_PATHS, Role } from "@barbercue/shared";
import type { CityDto } from "@barbercue/shared";
import BackendStatus from "./BackendStatus";
import { fetchDiscoveryOrNull } from "../../lib/discovery-api";
import { absoluteUrl, DISCOVERY_REVALIDATE_SECONDS, SITE_URL } from "../../lib/seo";
import { JsonLd } from "../../components/discovery/JsonLd";

const TITLE = "BarberCue — Find a barbershop near you";
const DESCRIPTION =
  "Discover nearby barbershops, see the current wait, and book your chair online. No app required.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/") },
  openGraph: { title: TITLE, description: DESCRIPTION, url: absoluteUrl("/"), type: "website" },
};

function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "BarberCue",
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

// Phase 3A: real discovery content (city links) replaces the Phase 1 foundation-shell text.
// BackendStatus + role login links are kept — still genuinely useful for local dev verification.
//
// The homepage has no dynamic params, so `next build` always attempts to prerender it statically —
// unlike the [citySlug]/[salonSlug] pages below, which skip build-time prerendering entirely
// (no generateStaticParams). If the backend isn't reachable at build time, a thrown network error
// here would fail the whole site build; degrade to an empty city list instead, same as
// app/sitemap.ts's existing fallback for the same failure mode.
export default async function HomePage() {
  const cities = await fetchDiscoveryOrNull<CityDto[]>(DISCOVERY_PATHS.cities, DISCOVERY_REVALIDATE_SECONDS).catch(
    () => null,
  );

  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: 720, margin: "0 auto" }}>
      <JsonLd data={organizationJsonLd()} />
      <h1>BarberCue</h1>
      <p>Skip the wait. Book your chair.</p>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: "1.1rem" }}>Browse by city</h2>
        {cities && cities.length > 0 ? (
          <nav style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {cities.map((c) => (
              <Link
                key={c.slug}
                href={`/${c.slug}`}
                style={{ padding: "6px 12px", border: "1px solid #E7E0D3", borderRadius: 20, color: "#1C1A17" }}
              >
                {c.name}
              </Link>
            ))}
          </nav>
        ) : (
          <p style={{ color: "#6B6357" }}>No cities listed yet.</p>
        )}
      </section>

      <BackendStatus />
      <nav style={{ marginTop: 24, display: "flex", gap: 16, fontSize: "0.875rem" }}>
        <Link href="/login">Customer login</Link>
        <Link href="/owner/login">Owner login</Link>
        <Link href="/staff/login">Staff login</Link>
        <Link href="/admin/login">Admin login</Link>
      </nav>
      <p style={{ color: "#666", fontSize: "0.75rem", marginTop: 16 }}>
        Public site, customer account area, and salon owner/staff/admin dashboard all live in this
        one Next.js app, separated by route group and role ({Role.CUSTOMER}, {Role.SALON_STAFF},{" "}
        {Role.SALON_OWNER}, {Role.PLATFORM_ADMIN}). See <code>ARCHITECTURE.md</code> at the repo root.
      </p>
    </main>
  );
}
