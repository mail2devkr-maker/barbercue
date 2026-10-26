import {
  CUSTOMER_CATEGORY_PHOTOS,
  CUSTOMER_SERVICE_CATEGORIES,
  PHOTOGRAPHED_SERVICES,
} from "@barbercue/shared";
import { EDITORIAL_ASSETS } from "../manifest";

// The mobile All Services catalogue points at FastQue's editorial library by path. This is the
// guard that every one of those paths is a real, registered asset of the website's own manifest, so
// a renamed or removed photo fails CI instead of showing a broken picture on a customer's phone.
const knownSources = new Set(EDITORIAL_ASSETS.map((asset) => asset.src));

describe("mobile All Services photo paths exist in the website's editorial manifest", () => {
  it("has a registered flagship asset for every customer category", () => {
    for (const [categoryId, photoPath] of Object.entries(CUSTOMER_CATEGORY_PHOTOS)) {
      expect({ categoryId, registered: knownSources.has(`/editorial/${photoPath}`) }).toEqual({
        categoryId,
        registered: true,
      });
    }
  });

  it("has a registered asset for every individually photographed service", () => {
    for (const service of PHOTOGRAPHED_SERVICES) {
      expect({ id: service.id, registered: knownSources.has(`/editorial/${service.photoPath}`) }).toEqual({
        id: service.id,
        registered: true,
      });
    }
  });

  it("never lists a photo path that is not registered, for any catalogue service", () => {
    for (const category of CUSTOMER_SERVICE_CATEGORIES) {
      for (const service of category.services) {
        expect(knownSources.has(`/editorial/${service.photoPath}`)).toBe(true);
      }
    }
  });
});
