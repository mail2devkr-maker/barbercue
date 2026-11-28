/**
 * Region hub pages (Delhi NCR). A region page only groups real FastQue city pages: it lists the
 * cities in the region that have at least one live shop, with the shops themselves. Nothing here
 * is a count or claim that does not come from the discovery API.
 */
import type { CityDto } from "@barbercue/shared";

/** City names (lowercase) that belong to the National Capital Region. */
export const DELHI_NCR_CITY_NAMES: ReadonlySet<string> = new Set([
  "delhi",
  "new delhi",
  "noida",
  "greater noida",
  "gautam buddha nagar",
  "ghaziabad",
  "gurugram",
  "gurgaon",
  "faridabad",
  "sonipat",
  "bahadurgarh",
]);

export function isDelhiNcrCity(city: Pick<CityDto, "name" | "countryCode">): boolean {
  return city.countryCode.toUpperCase() === "IN" && DELHI_NCR_CITY_NAMES.has(city.name.trim().toLowerCase());
}

export interface RegionCityFacts {
  name: string;
  shopCount: number;
  hasMore: boolean;
}

function countText(c: RegionCityFacts): string {
  return c.hasMore ? `${c.shopCount}+` : String(c.shopCount);
}

export function regionTotal(cities: RegionCityFacts[]): { total: number; hasMore: boolean } {
  return {
    total: cities.reduce((n, c) => n + c.shopCount, 0),
    hasMore: cities.some((c) => c.hasMore),
  };
}

/** Answer-first intro built from the live counts. */
export function delhiNcrIntro(cities: RegionCityFacts[]): string {
  if (cities.length === 0) {
    return "No salons in Delhi NCR are listed on FastQue yet.";
  }
  const { total, hasMore } = regionTotal(cities);
  const parts = cities.map((c) => `${c.name} (${countText(c)})`).join(", ");
  return `You can book a salon, barbershop or beauty parlour in Delhi NCR online on FastQue. ${total}${hasMore ? "+" : ""} ${total === 1 && !hasMore ? "shop is" : "shops are"} listed across ${parts}: compare services and prices, check whether a shop is open, then book an appointment or join its live queue from your phone.`;
}

export function delhiNcrFaq(cities: RegionCityFacts[]): { q: string; a: string }[] {
  const names = cities.map((c) => c.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
  return [
    {
      q: "Where can I book a salon or barbershop in Delhi NCR online?",
      a:
        cities.length > 0
          ? `On FastQue. Shops in ${list} are listed on this page. Open a city to see every shop there, or open a shop to see its services, prices and hours.`
          : "No Delhi NCR shops are on FastQue yet.",
    },
    {
      q: "Which Delhi NCR cities have salons on FastQue?",
      a:
        cities.length > 0
          ? `Right now: ${cities.map((c) => `${c.name} (${countText(c)} ${c.shopCount === 1 && !c.hasMore ? "shop" : "shops"})`).join(", ")}. New shops join regularly; this list updates from the live listings.`
          : "None yet.",
    },
    {
      q: "Can I see salon prices before I go?",
      a: "Yes. Each shop lists its services with prices set by the shop. The final amount is confirmed by the shop at the visit.",
    },
    {
      q: "Can I skip the waiting line at a salon in Noida or Greater Noida?",
      a: "Where the shop has its live queue on, you can join it from your phone, follow your place and arrive closer to your turn. You can also book a time ahead if the shop takes bookings.",
    },
    {
      q: "I own a salon in Delhi NCR. How do I list it?",
      a: "Create an owner account on FastQue and add your shop, services, staff and hours. Customers can then find you, book ahead or join your live queue.",
    },
  ];
}
