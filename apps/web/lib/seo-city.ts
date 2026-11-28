/**
 * City landing page copy (super SEO pass). Answer-first, factual and built from live data: the
 * number of listed shops comes from the discovery API, and every capability described here exists
 * in the product (book ahead, live queue, prices, open-now and wait information).
 */

export interface CityFacts {
  name: string;
  state: string;
  /** Shops shown on the page. */
  shopCount: number;
  /** True when the API has more shops than the first page shows. */
  hasMore: boolean;
}

function shopsPhrase({ shopCount, hasMore }: CityFacts): string {
  if (hasMore) return `${shopCount}+ salons and barbershops`;
  return shopCount === 1 ? "1 salon" : `${shopCount} salons and barbershops`;
}

/** The first paragraph on the page: answers "where can I book a salon in {city}?" directly. */
export function cityIntro(city: CityFacts): string {
  if (city.shopCount === 0) {
    return `No salons in ${city.name} are listed on FastQue yet. You can search nearby cities, or ask your local salon to join FastQue.`;
  }
  return `You can book a salon, barbershop or beauty parlour in ${city.name} online on FastQue. ${shopsPhrase(city)} in ${city.name}, ${city.state} ${city.shopCount === 1 && !city.hasMore ? "is" : "are"} listed below: compare services and prices, check whether a shop is open, then book an appointment or join its live queue from your phone.`;
}

export function cityFaq(city: CityFacts): { q: string; a: string }[] {
  const n = city.shopCount;
  return [
    {
      q: `Where can I book a salon appointment in ${city.name}?`,
      a:
        n > 0
          ? `On FastQue. ${shopsPhrase(city)} in ${city.name} ${n === 1 && !city.hasMore ? "is" : "are"} listed on this page. Open a shop to see its services, prices and hours, then book a time or join the live queue.`
          : `No ${city.name} salons are on FastQue yet. Search a nearby city, or ask your salon to list itself on FastQue.`,
    },
    {
      q: "How does online salon booking on FastQue work?",
      a: "Choose a shop, pick one or more services, then either book a date and time or join the shop's live queue. You can follow the queue on your phone and arrive closer to your turn instead of waiting at the shop.",
    },
    {
      q: `Can I compare salon prices in ${city.name} before booking?`,
      a: "Yes. Each shop lists its services with prices set by the shop. The final amount is confirmed by the shop at the visit.",
    },
    {
      q: "What should I check before choosing a salon?",
      a: "Look at the services and prices the shop lists, its opening hours, whether it is open now, its photos and reviews from other FastQue customers, and how many people are already waiting in its queue.",
    },
    {
      q: `I own a salon in ${city.name}. How can I list it on FastQue?`,
      a: "Create an owner account on FastQue and add your shop, services, staff and hours. Customers can then find you, book ahead or join your live queue, and you manage everything from the FastQue dashboard or app.",
    },
  ];
}
