import SearchPage from "../(public)/search/page";
import SearchClient from "../(public)/search/SearchClient";
import { DISCOVERY_PATHS } from "@barbercue/shared";
import { fetchDiscovery } from "../../lib/discovery-api";

jest.mock("../../lib/discovery-api", () => ({ fetchDiscovery: jest.fn() }));
jest.mock("../(public)/search/SearchClient", () => ({ __esModule: true, default: jest.fn(() => null) }));

describe("public search initial HTML data", () => {
  beforeEach(() => fetchDiscovery.mockReset());

  it("loads default city and salon results on the server and passes the first page to the client", async () => {
    const cities = [{ id: "city-1", name: "Hajipur", slug: "hajipur", countryCode: "IN" }];
    const salons = [{ id: "salon-1", name: "Sample Studio" }];
    fetchDiscovery.mockImplementation(async (path) => path === DISCOVERY_PATHS.cities
      ? cities
      : { items: salons, nextCursor: "next-page" });

    const page = await SearchPage({ searchParams: Promise.resolve({}) });
    const child = page.props.children;

    expect(child.type).toBe(SearchClient);
    expect(child.props.initialCities).toEqual(cities);
    expect(child.props.initialResults).toEqual(salons);
    expect(child.props.initialHasMore).toBe(true);
    expect(fetchDiscovery).toHaveBeenCalledTimes(2);
  });

  it("leaves filtered searches to the existing client filter flow", async () => {
    const page = await SearchPage({ searchParams: Promise.resolve({ city: "hajipur" }) });
    const child = page.props.children;

    expect(child.type).toBe(SearchClient);
    expect(child.props.initialResults).toBeUndefined();
    expect(fetchDiscovery).not.toHaveBeenCalled();
  });

  it("falls back to client fetching if server discovery is temporarily unavailable", async () => {
    fetchDiscovery.mockRejectedValue(new Error("discovery unavailable"));
    const page = await SearchPage({ searchParams: Promise.resolve({}) });
    const child = page.props.children;

    expect(child.props.initialResults).toBeUndefined();
    expect(child.props.initialCities).toBeUndefined();
  });
});
