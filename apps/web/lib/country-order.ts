import type { CountryDto } from "@barbercue/shared";

const INDIA_CODE = "IN";
const countryNameCollator = new Intl.Collator("en", { sensitivity: "base" });

/**
 * Presents India first for BarberCue's launch market while keeping every other API country in
 * alphabetical order. The original Country objects are returned unchanged: ids, ISO codes and
 * backend ordering/contracts remain untouched, and a malformed duplicate IN response is reduced
 * to the first genuine API row rather than inventing a replacement object.
 */
export function orderCountriesForDisplay(countries: readonly CountryDto[]): CountryDto[] {
  const india = countries.find((country) => country.isoCode2 === INDIA_CODE);
  const others = countries
    .filter((country) => country.isoCode2 !== INDIA_CODE)
    .sort((a, b) => countryNameCollator.compare(a.name, b.name));

  return india ? [india, ...others] : others;
}
