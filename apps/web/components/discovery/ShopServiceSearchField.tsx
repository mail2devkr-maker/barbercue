"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import type { ServiceSuggestionDto } from "@barbercue/shared";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const RESULT_LIMIT = 6;

type SuggestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; services: ServiceSuggestionDto[] }
  | { kind: "failed" };

/**
 * Service-only customer search typeahead. Suggestions come from real active Service rows via
 * GET /salons/service-suggestions; shop names are intentionally excluded.
 */
export function ShopServiceSearchField({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (serviceName?: string) => void;
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
      fetch(`${API_BASE_URL}/${DISCOVERY_PATHS.salons}/${DISCOVERY_PATHS.serviceSuggestions}?${params.toString()}`)
        .then((response) => {
          if (!response.ok) throw new Error(`Search failed with ${response.status}`);
          return response.json() as Promise<ServiceSuggestionDto[]>;
        })
        .then((data) => {
          if (cancelled || seq !== requestSeqRef.current) return;
          setActiveIndex(0);
          setState({ kind: "results", services: data });
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

  const services = !tooShort && state.kind === "results" ? state.services : [];
  const expanded = open && services.length > 0;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!expanded) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % services.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + services.length) % services.length);
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
        placeholder="Haircut, hair spa, beard trim…"
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
          {services.map((service, index) => (
            <li
              key={`${service.name}-${service.category ?? ""}`}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  onChange(service.name);
                  setOpen(false);
                  onSubmit(service.name);
                }}
                style={{
                  width: "100%",
                  display: "block",
                  padding: "9px 10px",
                  border: 0,
                  borderRadius: 6,
                  textAlign: "left",
                  color: "var(--bc-ink)",
                  background: index === activeIndex ? "var(--bc-gold-soft)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600 }}>{service.name}</span>
                {service.category && (
                  <span style={{ fontSize: 13, color: "var(--bc-muted)", display: "block" }}>
                    {service.category}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !tooShort && state.kind === "results" && services.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--bc-muted)", marginTop: 6 }}>
          No services match &ldquo;{trimmed}&rdquo; yet — try{" "}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSubmit(trimmed)}
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
