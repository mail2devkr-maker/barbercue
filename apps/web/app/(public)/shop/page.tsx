import type { ShopHomeDto } from "@barbercue/shared";
import { ShopHome } from "../../../components/shop/ShopHome";
import { fetchDiscovery } from "../../../lib/discovery-api";

export const revalidate = 60;

export default async function ShopHomePage() {
  // Server-rendered for search engines and a fast first paint; the client refreshes it for the
  // shopper's location. If the backend is unreachable the page still renders and retries client-side.
  const initial = await fetchDiscovery<ShopHomeDto>("shop/home", revalidate).catch(() => null);
  return <ShopHome initial={initial} />;
}
