"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { PaginatedResult, SalonListItemDto } from "@barbercue/shared";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const RESULT_LIMIT = 6;

type SuggestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; salons: SalonListItemDto[] }
  | { kind: "failed" };

/**
 * Issue #13 Mission D: "Shop or service" previously had no live suggestions at all — typing
 * "bear" surfaced nothing, even after salons.service.ts's own q-param match was fixed to include
 * service names/categories (see that fix's own comment). This reuses that exact same, now-correct
 * GET /salons?q= endpoint for suggestions — real indexed data, never a fabricated static list —
 * and each suggestion links straight to the matching salon's real profile, since the user has
 * already found exactly what they were typing for.
 */
export function ShopServiceSearchField({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const listboxId = useId();
  const [state, setState] = useState<SuggestState>({ kind: "idle" });
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeqRef = useRef(0);

  const trimmed = value.trim();
  const tooShort = trimmed.length < MIN_QUERY_LENGTH;

  useEffect(() => {
    // Nothing to search against yet. tooShort is handled by hiding the list at render time
    // rather than by resetting state here (same reasoning as CitySearchField's own effect), so
    // this effect never calls setState synchronously on its own body.
    if (tooShort) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const seq = (requestSeqRef.current += 1);
      setState({ kind: "loading" });
      const params = new URLSearchParams({ q: trimmed, limit: String(RESULT_LIMIT) });
      fetch(`${API_BASE_URL}/${DISCOVERY_PATHS.salons}?${params.toString()}`)
        .then((response) => {
          if (!response.ok) throw new Error(`Search failed with ${response.status}`);
          return response.json() as Promise<PaginatedResult<SalonListItemDto>>;
        })
        .then((data) => {
          if (cancelled || seq !== requestSeqRef.current) return;
          setActiveIndex(0);
          setState({ kind: "results", salons: data.items });
        })
        .catch(() => {
          if (cancelled || seq !== requestSeqRef.current) return;
          setState({ kind: "failed" });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, tooShort]);

  const salons = !tooShort && state.kind === "results" ? state.salons : [];
  const expanded = open && salons.length > 0;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!expanded) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % salons.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + salons.length) % salons.length);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
    // Enter is intentionally NOT swallowed here (unlike CitySearchField): this field's own
    // "Find shops" submit is a valid, equally correct action, not a half-filled form to protect
    // against — a suggestion is one option among several matches, not the only valid one.
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="search"
        placeholder="Fade, beard trim, shop name…"
        autoComplete="off"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listboxId}-${activeIndex}` : undefined}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />

      {expanded && (
        <ul
          id={listboxId}
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            margin: 0,
            padding: 4,
            listStyle: "none",
            background: "#fff",
            border: "1px solid var(--bc-border)",
            borderRadius: "var(--bc-radius-sm)",
            boxShadow: "var(--bc-shadow-lg)",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {salons.map((salon, index) => (
            <li
              key={salon.id}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
            >
              <Link
                href={`/${salon.countryCode}/${salon.citySlug}/${salon.slug}`}
                // Prevents this click's mousedown from blurring the input first — a blur-triggered
                // close (see onBlur below) would otherwise unmount this link before its own click
                // event fires, same race CitySearchField's onMouseDown comment describes.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                style={{
                  display: "block",
                  padding: "9px 10px",
                  borderRadius: 6,
                  textDecoration: "none",
                  color: "var(--bc-ink)",
                  background: index === activeIndex ? "var(--bc-gold-soft)" : "transparent",
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600 }}>{salon.name}</span>
                {salon.priceMin !== null && (
                  <span style={{ fontSize: 13, color: "var(--bc-muted)", display: "block" }}>
                    From {salon.currency ?? ""} {salon.priceMin}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {open && !tooShort && state.kind === "results" && salons.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--bc-muted)", marginTop: 6 }}>
          No shops or services match &ldquo;{trimmed}&rdquo; yet — try{" "}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onSubmit}
            style={{ color: "var(--bc-accent)", textDecoration: "underline", background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            searching anyway
          </button>
          .
        </p>
      )}
    </div>
  );
}
