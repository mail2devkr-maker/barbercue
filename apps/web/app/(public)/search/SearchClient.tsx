"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PaginatedResult, SalonListItemDto } from "@barbercue/shared";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import { SalonCard } from "../../../components/discovery/SalonCard";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";

export default function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [city, setCity] = useState(searchParams.get("city") ?? "");
  const [results, setResults] = useState<SalonListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    for (const key of ["q", "city", "locality", "service"]) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }

    let cancelled = false;
    // The loading/error resets happen inside this .then(), not as direct synchronous statements
    // in the effect body — same pattern as lib/auth-context.tsx's mount effect.
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        setLoading(true);
        setError(null);
        return fetch(`${API_BASE_URL}/${DISCOVERY_PATHS.salons}?${params.toString()}`);
      })
      .then((res) => res?.json() as Promise<PaginatedResult<SalonListItemDto>> | undefined)
      .then((data) => {
        if (!cancelled && data) setResults(data.items);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load results. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (city) params.set("city", city);
    router.push(`/search?${params.toString()}`);
  }

  return (
    <main style={{ padding: "2rem 1.5rem", maxWidth: 800, margin: "0 auto" }}>
      <h1>Find a barbershop</h1>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search by name..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 160, padding: "0.5rem", border: "1px solid #E7E0D3", borderRadius: 8 }}
        />
        <input
          type="text"
          placeholder="City slug (e.g. bengaluru)"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          style={{ flex: 1, minWidth: 160, padding: "0.5rem", border: "1px solid #E7E0D3", borderRadius: 8 }}
        />
        <button type="submit" style={{ padding: "0.5rem 1rem", background: "#B0413E", color: "#fff", border: "none", borderRadius: 8 }}>
          Search
        </button>
      </form>

      {loading && <p style={{ color: "#6B6357" }}>Loading...</p>}
      {error && <p style={{ color: "#E24B4A" }}>{error}</p>}
      {!loading && !error && results.length === 0 && <p style={{ color: "#6B6357" }}>No salons found.</p>}
      {results.map((s) => (
        <SalonCard key={s.id} salon={s} />
      ))}
    </main>
  );
}
