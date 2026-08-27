"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PaginatedResult, SalonListItemDto } from "@barbercue/shared";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import { SalonCard } from "../../../components/discovery/SalonCard";
import { Button } from "../../../components/ui/Button";

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 180,
  padding: "12px 14px",
  border: "1px solid var(--bc-border)",
  borderRadius: "var(--bc-radius-sm)",
  fontSize: "1rem",
  fontFamily: "var(--font-body)",
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";

export default function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [city, setCity] = useState(searchParams.get("city") ?? "");
  // AI Style Advisor hand-off (major-upgrade phase) — present only when arriving via "Try This
  // Look"; forwarded into each result's link, never sent to the backend search itself.
  const style = searchParams.get("style") ?? undefined;
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
    <main style={{ padding: "2.5rem 1.5rem 3rem", maxWidth: 1080, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "2rem", letterSpacing: "-0.01em", marginBottom: 8 }}>
        Find a barbershop
      </h1>
      {style && (
        <p style={{ color: "var(--bc-muted)", fontSize: 14, marginBottom: 16 }}>
          Booking for the <strong>{style}</strong> look — pick a shop below to continue.
        </p>
      )}
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 10, margin: "20px 0 36px", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search by name..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="City slug (e.g. bengaluru)"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          style={inputStyle}
        />
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>

      {loading && <p style={{ color: "var(--bc-muted)" }}>Loading…</p>}
      {error && <p style={{ color: "#E24B4A" }}>{error}</p>}
      {!loading && !error && results.length === 0 && (
        <p style={{ color: "var(--bc-muted)" }}>No salons found. Try a different name or city.</p>
      )}
      {results.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
          {results.map((s) => (
            <SalonCard key={s.id} salon={s} styleName={style} />
          ))}
        </div>
      )}
    </main>
  );
}
