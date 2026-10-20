import type { Metadata } from "next";
import { PublicOffers } from "../../../components/offers/PublicOffers";

export const metadata: Metadata = {
  title: "Offers near you",
  description: "Offers, promotions and daily deals that shops on FastQue are running right now.",
};

export default async function OffersPage({ searchParams }: { searchParams: Promise<{ city?: string; country?: string }> }) {
  const { city, country } = await searchParams;
  return <PublicOffers city={city ?? null} country={country} />;
}
