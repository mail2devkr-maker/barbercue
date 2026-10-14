import { DISCOVERY_PATHS } from "@barbercue/shared";
import { fetchDiscovery } from "../discovery-api";

describe("fetchDiscovery cache policy", () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not cache public salon profiles", async () => {
    await fetchDiscovery(`${DISCOVERY_PATHS.salons}/in/city/shop`, 300);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/salons\/in\/city\/shop$/),
      { cache: "no-store" },
    );
  });

  it("does not cache salon discovery results", async () => {
    await fetchDiscovery(`${DISCOVERY_PATHS.salons}?city=city`, 300);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/salons\?city=city$/),
      { cache: "no-store" },
    );
  });

  it("preserves ISR for non-salon public metadata", async () => {
    await fetchDiscovery(`${DISCOVERY_PATHS.cities}/in/city`, 300);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/cities\/in\/city$/),
      { next: { revalidate: 300 } },
    );
  });
});
