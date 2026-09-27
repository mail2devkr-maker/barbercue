"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DISCOVERY_PATHS, type ServiceSuggestionDto } from "@barbercue/shared";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";
const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 1;
const RESULT_LIMIT = 12;

type SuggestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; services: ServiceSuggestionDto[] }
  | { kind: "failed" };

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
  const requestSeqRef = useRef(0);
  const trimmed = value.trim();
  const tooShort = trimmed.length < MIN_QUERY_LENGTH;

  useEffect(() => {
    if (tooShort) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const seq = (requestSeqRef.current += 1);
      setState({ kind: "loading" });
      const params = new URLSearchParams({ q: trimmed, limit: String(RESULT_LIMIT) });
      fetch(
        `${API_BASE_URL}/${DISCOVERY_PATHS.salons}/${DISCOVERY_PATHS.serviceSuggestions}?${params.toString()}`,
      )
        .then((response) => {
          if (!response.ok) throw new Error(`Service suggestions failed with ${response.status}`);
          return response.json() as Promise<ServiceSuggestionDto[]>;
        })
        .then((services) => {
          if (cancelled || seq !== requestSeqRef.current) return;
          setActiveIndex(0);
          setState({ kind: "results", services });
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

  function choose(name: string) {
    onChange(name);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      if (expanded && services[activeIndex]) {
        event.preventDefault();
        choose(services[activeIndex].name);
        return;
      }
      onSubmit();
      return;
    }
    if (!expanded) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % services.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + services.length) % services.length);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        type="search"
        placeholder="Hair, haircut, beard trim, facial…"
        autoComplete="off"
        role="combobox"
        aria-label="Service"
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
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {services.map((service, index) => (
            <li
              key={`${service.name}:${service.category ?? ""}`}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
            >
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(service.name)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 10px",
                  border: 0,
                  borderRadius: 6,
                  color: "var(--bc-ink)",
                  background: index === activeIndex ? "var(--bc-gold-soft)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600 }}>{service.name}</span>
                {service.category && (
                  <span style={{ fontSize: 12, color: "var(--bc-muted)", display: "block" }}>
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
          No matching services yet. Try another service name.
        </p>
      )}
    </div>
  );
}
