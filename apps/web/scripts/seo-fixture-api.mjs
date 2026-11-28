import { createServer } from "node:http";

const city = {
  id: "seo-fixture-city",
  name: "Bhopal",
  slug: "bhopal",
  countryCode: "IN",
  regionCode: "IN-MP",
  state: "Madhya Pradesh",
  country: "India",
};
const locality = {
  id: "seo-fixture-locality",
  name: "MP Nagar",
  slug: "mp-nagar",
  citySlug: "bhopal",
};
const salon = {
  id: "seo-fixture-salon",
  publicId: "FQ-SEO-QA-001",
  name: "FastQue SEO QA Studio",
  slug: "seo-qa-studio",
  citySlug: "bhopal",
  localitySlug: "mp-nagar",
  addressLine: "Synthetic test address",
  countryCode: "IN",
  currency: "INR",
  postalCode: null,
  lat: null,
  lng: null,
  coverPhotoUrl: null,
  ratingAverage: null,
  ratingCount: 0,
  priceMin: 250,
  priceMax: 250,
  distanceKm: null,
  isOpenNow: null,
  verified: false,
  waitingCount: 0,
  salonType: "UNISEX",
  salonTypeConfirmed: true,
};
const salonProfile = {
  ...salon,
  description: "Synthetic profile used only by the SEO certification workflow.",
  phone: null,
  services: [{
    id: "seo-fixture-service",
    salonId: salon.id,
    name: "Haircut",
    durationMinutes: 30,
    price: 250,
    category: "Hair",
    isActive: true,
  }],
  operatingHours: [],
  photos: [],
  reviews: [],
  team: [],
  salonTimezone: "Asia/Kolkata",
};
const errorBody = { error: { code: "NOT_FOUND", message: "Synthetic fixture route not found" } };

function respond(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" }).end();
    return;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1:4000");
  if (url.pathname === "/healthz") {
    respond(response, 200, { status: "ok", synthetic: true });
    return;
  }

  const path = url.pathname.replace(/^\/api\/v1\/?/, "");
  if (path === "cities") {
    respond(response, 200, [city]);
    return;
  }
  if (path === "salons/live-stats") {
    respond(response, 200, { liveWaitingCount: 0 });
    return;
  }
  if (path === "shop/sitemap-products") {
    respond(response, 200, []);
    return;
  }

  const segments = path.split("/").filter(Boolean);
  if (
    segments[0] === "cities"
    && segments[1]?.toLowerCase() === city.countryCode.toLowerCase()
    && segments[2] === city.slug
  ) {
    if (segments.length === 3) {
      respond(response, 200, city);
      return;
    }
    if (segments[3] === "localities" && segments.length === 4) {
      respond(response, 200, [locality]);
      return;
    }
    if (segments[3] === "localities" && segments[4] === locality.slug && segments.length === 5) {
      respond(response, 200, locality);
      return;
    }
  }

  if (segments[0] === "salons") {
    if (segments[1]?.toLowerCase() === city.countryCode.toLowerCase() && segments[2] === city.slug && segments[3] === salon.slug) {
      if (segments.length === 5 && segments[4] === "status") {
        respond(response, 404, errorBody);
        return;
      }
      if (segments.length === 4) {
        respond(response, 200, salonProfile);
        return;
      }
    }
    if (segments.length === 1) {
      respond(response, 200, { items: [salon], nextCursor: null });
      return;
    }
  }

  respond(response, 404, errorBody);
});

server.listen(4000, "127.0.0.1", () => {
  process.stdout.write("Synthetic SEO API listening on 127.0.0.1:4000\\n");
});
