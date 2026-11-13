import { useEffect, useState } from 'react';
import type { CityDto } from '@barbercue/shared';

// Website parity for the search page's "City / location" control (apps/web/app/(public)/search/
// SearchClient.tsx): the customer either picks a city FastQue has shops in, or uses their current
// location ("Near me"). Home and Search share one choice for the app session, so changing it on
// either screen is reflected on the other.

export type LocationChoice =
  | { kind: 'gps'; label: string; coords: { lat: number; lng: number } }
  | { kind: 'city'; city: Pick<CityDto, 'id' | 'name' | 'slug' | 'countryCode' | 'state'> };

let current: LocationChoice | null = null;
const listeners = new Set<(choice: LocationChoice | null) => void>();

export function getLocationChoice(): LocationChoice | null {
  return current;
}

export function setLocationChoice(next: LocationChoice | null): void {
  current = next;
  for (const listener of listeners) listener(current);
}

export function subscribeLocationChoice(listener: (choice: LocationChoice | null) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useLocationChoice(): LocationChoice | null {
  const [choice, setChoice] = useState<LocationChoice | null>(current);
  useEffect(() => {
    setChoice(current);
    return subscribeLocationChoice(setChoice);
  }, []);
  return choice;
}

export function locationChoiceLabel(choice: LocationChoice | null): string | null {
  if (!choice) return null;
  return choice.kind === 'gps' ? choice.label : choice.city.name;
}

/** Same query keys the website sends for a picked city. GPS coordinates are sent separately. */
export function cityQueryParams(choice: LocationChoice | null): { city: string; countryCode: string } | null {
  return choice?.kind === 'city' ? { city: choice.city.slug, countryCode: choice.city.countryCode } : null;
}

/** Case- and accent-insensitive city filter for the picker list. */
export function filterCities<T extends { name: string; state?: string | null }>(cities: T[], text: string): T[] {
  const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const needle = norm(text);
  if (!needle) return cities;
  return cities.filter((c) => norm(c.name).includes(needle) || norm(c.state ?? '').includes(needle));
}

export function __resetLocationChoiceForTests(): void {
  current = null;
  listeners.clear();
}
