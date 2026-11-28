import { withViewerDistance } from "../viewer-distance";

const base = { distanceKm: null, lat: null, lng: null };
const viewer = { lat: 25.69, lng: 85.2 };

describe("withViewerDistance", () => {
  it("adds a rounded straight-line distance to pinned shops only", () => {
    const [pinned, unpinned] = withViewerDistance(
      [
        { ...base, id: "a", lat: 25.7, lng: 85.209 },
        { ...base, id: "b" },
      ],
      viewer,
    );
    expect(pinned.distanceKm).toBeCloseTo(1.4, 1);
    expect(Math.round(pinned.distanceKm * 10)).toBe(pinned.distanceKm * 10);
    expect(unpinned.distanceKm).toBeNull();
  });

  it("keeps a distance the API already computed", () => {
    const [shop] = withViewerDistance([{ ...base, id: "a", lat: 25.7, lng: 85.209, distanceKm: 9.9 }], viewer);
    expect(shop.distanceKm).toBe(9.9);
  });

  it("returns the same list when the viewer position is unknown", () => {
    const list = [{ ...base, id: "a", lat: 25.7, lng: 85.209 }];
    expect(withViewerDistance(list, null)).toBe(list);
  });
});
