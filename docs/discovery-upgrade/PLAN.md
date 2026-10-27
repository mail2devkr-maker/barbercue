# Discovery upgrade — price compare, favorites, filters, salon type, sorting

Branch `feature/discovery-compare-favorites` (from `master` 7069b29). Started 2026-10-27.

## 1. What already exists (reused, not duplicated)

| Need | Existing | Notes |
| --- | --- | --- |
| Customer discovery page | `/search` (`app/(public)/search/SearchClient.tsx`); every filter lives in the URL | Extended in place. The landing page's search and category links already go here. |
| Search API | `GET salons` → `SalonsService.search` (`salonSearchQuerySchema`) | Already has `service`, `priceMin/priceMax`, `lat/lng`, `radiusKm`, cursor pagination. |
| Service-specific price filter | When `service` is set, a salon passes only if **the matching service itself** is in range | Correct today; kept. Without a service, the old "any service in range" filter is unchanged for existing links. |
| Salon type | `Salon.salonType` enum `GENTS / LADIES / UNISEX`, default `UNISEX`; owner can change it on the Services page (audited) | Not asked at registration, not used in discovery, and every pre-existing salon was silently defaulted to UNISEX. |
| Service pricing | `Service` (salon-specific `name`, `category`, `price`, `durationMinutes`, `isActive`) | No canonical catalog key on a service, so "same service" across salons needs a matching rule (below). |
| Ratings | `Review.rating` aggregated per salon (`ratingAverage`, `ratingCount`) | Reused. |
| Distance | Haversine over a bounding-box candidate set (no PostGIS) | Reused; distance mode returns one page (documented limitation). |
| Customer auth | `Role.CUSTOMER`, `/login?next=` with `safeNextPath`, `/account/*` behind `RequireRole` | Reused for favorites. |
| Favorites | — | New. |

## 2. Design decisions

**Salon type (gender) filter** — `SALON_TYPE_FILTER_MATCHES` in `packages/shared`:

| Customer picks | Shows |
| --- | --- |
| All | every salon |
| Male (Gents) | Gents + Unisex |
| Female (Ladies) | Ladies + Unisex |
| Unisex | Unisex **that the owner confirmed** |

Old salons: a new `Salon.salonTypeConfirmed` flag (default `false`, so every existing row starts unconfirmed) records whether an owner actually chose the type. Unconfirmed salons keep the stored `UNISEX` value, so they still appear under All / Male / Female (the inclusive outcome), but **not** under "Unisex only", and their card says "Type not set" instead of claiming Unisex. Owners see a prompt to confirm; registration now asks for the type and confirms it. Nothing is reclassified silently.

**"Same service" matching** — `POPULAR_SERVICES` in `packages/shared`: each popular service (Haircut, Beard Styling, Shaving, Facial, Hair Spa, Hair Color, Massage, Cleanup, Bleach, Detan) has match terms and exclusions, applied case-insensitively to a salon's own service name/category. The compared price is the **cheapest active matching service at that salon**, and its exact salon-specific name is returned and shown next to the price, so a comparison is never ambiguous.

**Price filter** — only offered once a service is selected (the slider is disabled with "Select a service to filter by price" otherwise), and always applied to that service's price.

**Sorting** — `relevance` (default, by name, paginated), `distance` (needs location; nearest first), `price` (needs a selected service; lowest selected-service price first — rejected by the API without a service, disabled in the UI with "Select a service first to sort by price"), `rating` (highest average first, salons with no reviews last, then review count). Distance, price and rating sorts use the existing bounded candidate approach (≤ 200 candidates, one page) — the same documented limitation as "Near me" today.

**Favorites** — `CustomerFavorite (userId, salonId, createdAt)`, unique per pair, indexed by user and salon. `GET favorites`, `GET favorites/ids`, `POST favorites/:salonId`, `DELETE favorites/:salonId`, customers only. Signed-out heart tap → login, then the favorite is saved on return.

## 3. Status

| Phase | Status | Delivered |
| --- | --- | --- |
| 1 Inspect + plan | ✅ | This document. |
| 2 Salon type | ✅ | Migration `20261027090000_discovery_salon_type_confirmed_and_favorites` (additive: `salons.salonTypeConfirmed` default false, new `customer_favorites`). Registration asks Male / Female / Unisex (required in the form, optional in the API for older clients). Saving the type on the owner Services page confirms it; unconfirmed owners see a prompt. Discovery filter `salonType` + "Type not set" on cards. |
| 3 Favorites | ✅ | `GET favorites`, `GET favorites/ids`, `POST/DELETE favorites/:salonId` (customers only, idempotent, active salons only). Heart on every salon card (home, search, city pages, comparison), optimistic with rollback; signed-out tap → login → saved on return. `/account/favorites` with Book / Join queue / remove and sort (recent / rating / name). |
| 4 Service comparison | ✅ | `popularService` filter (`POPULAR_SERVICES`), each result's `selectedService` (cheapest matching active service in range, with its own name), two-thumb price slider tied to the selected service, Cards / Compare prices table with Book now. |
| 5 Sorting | ✅ | `sort=relevance|distance|price|rating` combined with every filter; price needs a service (400 otherwise, disabled in UI); distance asks for location. |
| 6 Tests + checks | ✅ | Backend: 13 new (filter rule, matching, price-in-range, selected price, sorts, validation, favorites scoping/idempotency) + updated mocks for batched queries. Web: 13 new (URL rules, controls, compare table, card, hearts incl. rollback and post-login save, favorites order). Browser-checked on a local QA database: search, compare, price sort, slider, salon-type filter, signed-out heart, registration field, phone layout. Favorites API exercised over HTTP. |

| 7 Rating, open now, favorites only | ✅ | `minRating` (3 / 3.5 / 4 / 4.5; unreviewed salons never pass), `openNow=true` (checked per salon in its own time zone, so it uses the bounded single-page mode), `ids` (≤ 200 salon UUIDs; the public search never reads who is asking, so the client sends the customer's saved IDs). Web: Rating and "Show only" (Open now, My favorites) in the filter panel; signed out → sign-in prompt, nothing saved → empty state. |
| 8 Mobile parity | ✅ | Search screen: Salon type, Compare price (popular service, price filter follows it), Sort (distance only with a location, price only with a service), Rating, Open now and Favorites toggles; card shows the compared service's own name and price, the confirmed type or "Type not set", and a heart (customers; optimistic with rollback; signed out → sign-in hint). New strings in English and Hindi. |

**Also improved** — search result items are now built with grouped queries (ratings, price span, live queue, selected service) instead of 3–4 queries per salon.

## 4. Pending / not done

- Customer sign-in locally needs phone OTP or Google, so the signed-in heart was verified through unit tests and the HTTP API rather than by clicking in the browser.
- Mobile was verified with unit/screen tests and typecheck, not on a device or emulator. Popular-service names on mobile are shown in English (they match salons' own English service names).
- Price/rating/distance sorts rank up to 200 candidates and return one page (same limit as "Near me" today); a geo index (PostGIS) and stored rating aggregates would lift it.
- Popular-service matching is a keyword rule, not a curated service taxonomy; a canonical service key on `Service` would make it exact.
- Favorite count / "recently favorited" extras not built.
