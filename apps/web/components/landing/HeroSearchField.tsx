"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DISCOVERY_PATHS, type CityDto, type ServiceSuggestionDto } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { SearchIcon } from "./icons";
import styles from "./landing.module.css";

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 1;
const RESULT_LIMIT = 30;

/**
 * Homepage discovery is deliberately service-first. Platform inventory and shop-name discovery
 * are not exposed here; location refinement (including manual city/locality) lives on /search.
 * Suggestions come only from active services offered by ACTIVE salons.
 */
export function HeroSearchField({ cities: _operatingCities }: { cities: CityDto[] | null }) {
  const router = useRouter();
  const listboxId = useId();
  const requestSeqRef = useRef(0);
  const [value, setValue] = useState("");
  const [services, setServices] = useState<ServiceSuggestionDto[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const trimmed = value.trim();
  const tooShort = trimmed.length < MIN_QUERY_LENGTH;
  const expanded = open && !tooShort && services.length > 0;

  useEffect(() => {
    if (tooShort) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const seq = (requestSeqRef.current += 1);
      apiFetch<ServiceSuggestionDto[]>(
        `${DISCOVERY_PATHS.salons}/${DISCOVERY_PATHS.serviceSuggestions}?${new URLSearchParams({
          q: trimmed,
          limit: String(RESULT_LIMIT),
        })}`,
      )
        .then((result) => {
          if (cancelled || seq !== requestSeqRef.current) return;
          setServices(result);
          setActiveIndex(0);
        })
        .catch(() => {
          if (cancelled || seq !== requestSeqRef.current) return;
          setServices([]);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, tooShort]);

  function submit(serviceName = trimmed) {
    setOpen(false);
    const params = new URLSearchParams();
    if (serviceName.trim()) params.set("service", serviceName.trim());
    router.push(`/search${params.size ? `?${params.toString()}` : ""}`);
  }

  function choose(index: number) {
    const service = services[index];
    if (!service) return submit();
    setValue(service.name);
    submit(service.name);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && expanded) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % services.length);
    } else if (event.key === "ArrowUp" && expanded) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + services.length) % services.length);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (expanded) choose(activeIndex);
    else submit();
  }

  return (
    <form className={styles.heroSearch} onSubmit={handleSubmit} role="search" aria-label="Search FastQue services">
      <SearchIcon className={styles.heroSearchIcon} />
      <input
        type="search"
        name="service"
        role="combobox"
        aria-label="Service"
        aria-expanded={expanded}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listboxId}-${activeIndex}` : undefined}
        autoComplete="off"
        placeholder="Search services — haircut, hair spa, beard trim…"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />
      <button type="submit" className={styles.heroSearchButton}>
        <SearchIcon className={styles.ctaIcon} /> Search
      </button>

      {expanded && (
        <ul id={listboxId} role="listbox" className={styles.heroSuggestions}>
          <li role="presentation" className={styles.heroSuggestionGroup}>Services</li>
          {services.map((service, index) => (
            <li
              key={`${service.name}:${service.category ?? ""}`}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`${styles.heroSuggestion} ${index === activeIndex ? styles.heroSuggestionActive : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <SearchIcon className={styles.heroSuggestionIcon} />
              <span>
                {service.name}
                {service.category ? <small>{service.category}</small> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
