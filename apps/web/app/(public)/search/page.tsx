import type { Metadata } from "next";
import { Suspense } from "react";
import { absoluteUrl } from "../../../lib/seo";
import SearchClient from "./SearchClient";

// The bare /search (no filters) is the indexable "browse all salons" page — canonical to itself.
// Filtered variations canonicalize to /search. A city slug on its own cannot produce the
// country-scoped canonical route safely, so this deliberately avoids inventing a flat /city URL.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const keys = Object.keys(params).filter((k) => params[k]);

  return {
    title: "Search barbershops",
    description: "Search for barbershops by name, city, or service.",
    alternates: { canonical: absoluteUrl("/search") },
    robots: keys.length > 0 ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchClient />
    </Suspense>
  );
}
