import type { Metadata } from "next";
import { Suspense } from "react";
import { absoluteUrl } from "../../../lib/seo";
import SearchClient from "./SearchClient";

// The bare /search (no filters) is the indexable "browse all salons" page — canonical to itself.
// Filtered variations (?city=..., ?q=...) canonicalize back to /search or, when a single city
// filter is the only param, to that city's own (more authoritative) page — avoids indexing every
// filter combination as separate thin-content URLs.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const keys = Object.keys(params).filter((k) => params[k]);

  const onlyCity = keys.length === 1 && params.city;
  const canonical = onlyCity ? absoluteUrl(`/${params.city}`) : absoluteUrl("/search");

  return {
    title: "Search barbershops",
    description: "Search for barbershops by name, city, or service.",
    alternates: { canonical },
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
