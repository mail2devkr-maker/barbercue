"use client";

import { useEffect, useId, useState } from "react";
import { COUNTRY_PATHS, DISCOVERY_PATHS, type CitySearchResultDto, type CountryDto } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";

let indiaId: Promise<string | null> | null = null;
function loadIndiaId(): Promise<string | null> {
  indiaId ??= apiFetch<CountryDto[]>(COUNTRY_PATHS.countries)
    .then((list) => list.find((c) => c.isoCode2 === "IN")?.id ?? null)
    .catch(() => {
      indiaId = null;
      return null;
    });
  return indiaId;
}

/**
 * Free-text city box with suggestions after two letters. A city that is not in the list can still be
 * typed, so a missing master-data row never blocks an onboarding.
 */
export function CityTypeahead({
  value,
  onText,
  onPick,
  disabled,
}: {
  value: string;
  onText: (value: string) => void;
  onPick: (city: CitySearchResultDto) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  const [found, setFound] = useState<{ q: string; cities: CitySearchResultDto[] }>({ q: "", cities: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = value.trim();

  useEffect(() => {
    if (!open || q.length < 2) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
      const countryId = await loadIndiaId();
      if (!countryId || !alive) return;
      const params = new URLSearchParams({ countryId, q, limit: "8" });
      apiFetch<CitySearchResultDto[]>(`${DISCOVERY_PATHS.cities}/${DISCOVERY_PATHS.citySearch}?${params}`)
        .then((cities) => {
          if (!alive) return;
          setActive(0);
          setFound({ q, cities });
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, open]);

  const cities = open && q.length >= 2 && found.q === q ? found.cities : [];
  const pick = (c: CitySearchResultDto) => {
    setOpen(false);
    onPick(c);
  };
  return (
    <span style={{ position: "relative", display: "block" }}>
      <input
        value={value}
        disabled={disabled}
        autoComplete="off"
        maxLength={120}
        placeholder="Type 2 letters, e.g. No…"
        role="combobox"
        aria-label="City"
        aria-expanded={cities.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={cities.length ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          setOpen(true);
          onText(e.target.value);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!cities.length) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i + (e.key === "ArrowDown" ? 1 : cities.length - 1)) % cities.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(cities[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {cities.length > 0 && (
        <span
          id={listId}
          role="listbox"
          style={{ position: "absolute", zIndex: 30, top: "calc(100% + 4px)", left: 0, right: 0, display: "block", padding: 4, borderRadius: 12, background: "#1d1827", color: "#f5f0fb", border: "1px solid rgba(255,255,255,0.16)", boxShadow: "0 16px 40px rgba(0,0,0,0.5)", maxHeight: 260, overflowY: "auto" }}
        >
          {cities.map((c, i) => (
            <span
              key={c.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              style={{ display: "block", padding: "9px 10px", borderRadius: 8, cursor: "pointer", background: i === active ? "rgba(242,41,92,0.25)" : "transparent" }}
            >
              {c.name}
              {c.region && <small style={{ opacity: 0.7 }}> · {c.region.name}</small>}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
