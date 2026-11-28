# FastQue super SEO pass — audit, changes and handover (19 Nov 2026)

Branch `claude/fastque-super-seo-transformation`, based on master `cfc42df7` (live web deploy
`f425bb82`). Builds on PR #439 (service pages, service × city pages, full sitemap) and issue #429.
**Not deployed.**

## 1. Baseline (production, measured 19 Nov 2026 with curl from India)

| Check | Result |
|---|---|
| `http://fastque.com/` | 301 → `https://fastque.com/` ✔ |
| `https://www.fastque.com/` | **does not resolve** (no DNS record) |
| Trailing slash `/in/jharsuguda/` | 308 → no slash ✔ |
| Query variants `?utm=x` | 200 with canonical to the clean URL ✔ |
| Unknown page `/this-does-not-exist` | 404 ✔ |
| Unknown city/shop/service (`/in/nocity`, `/in/jharsuguda/nosalon`, `/services/nosuch`) | **200 + noindex (soft 404)** |
| `/login`, `/owner/login`, `/staff/login`, `/admin/login`, `/account` | **200, no noindex**, generic title "FastQue" |
| `/shop` canonical | **relative** (`/shop`) — no `metadataBase` |
| robots.txt | allows all, disallows `/account /dashboard /book /search?`, points to sitemap ✔ |
| sitemap.xml | 1055 URLs: 16 cities, 109 shops, 54 services, 864 service×city URLs; **every URL `lastmod` = now**; **first 50 shops per city only**; service×city URLs listed even with no matching shop (those pages are noindex → contradictory) |
| Shop JSON-LD | `HairSalon` for every shop, **self-published `aggregateRating`** (Google: self-serving, ineligible), `addressLocality` = URL slug |
| Homepage JSON-LD | `WebSite` + SearchAction pointing to `/search?q=` — the search page ignores `q` |
| Source fallback host | `https://barbercueweb-production.up.railway.app` |
| Search Console | Property verified + sitemap submitted 19 Nov; Page indexing report: "Processing data, please check again in a day or so" — **no indexing data yet** |

Live shops per city (from the sitemap): Greater Noida 41, Noida 31, Ghaziabad 14, Sambalpur 5,
Puri 3, Hajipur 3, Kendujhar 2, Gorakhpur 2, and 1 each in New Delhi, Maharajganj, Kolkata,
Jharsuguda, Indore, Gautam Buddha Nagar, Delhi, Bhopal. Patna, Mumbai, Bengaluru, Hyderabad,
Pune and Bhubaneswar have **no live shops**, so no landing pages were created for them.

## 2. What this branch changes

**Technical**
- Real 404 for unknown city / shop / area / service / service×city: `notFound()` now runs in
  `generateMetadata`, and the root `app/loading.tsx` (which streamed a 200 before the page knew it
  was missing) moved into the private `(customer)` and `(dashboard)` groups. Verified locally:
  `/in/nocity`, `/in/jharsuguda/nosalon`, `/services/nosuch`, `/in/jharsuguda/services/nosuch`,
  `/in/jharsuguda/areas/nope` → **404** for Googlebot and browsers; real pages stay 200.
- `noindex, nofollow` on all sign-in, account, employee and dashboard routes (new server layouts).
- Production fallback host → `https://fastque.com`; `metadataBase` set, so every relative
  canonical/OG URL is absolute.
- Site defaults: descriptive default title/description, Open Graph (`en_IN`, site name, logo),
  Twitter card, `lang="en-IN"`.

**Structured data**
- Homepage: `Organization` (brand, legal name FastQue Digital Technology Private Limited, logo,
  area served India) + `WebSite` in one `@graph`. Broken SearchAction removed (Google retired the
  sitelinks search box; ours pointed to an unsupported parameter).
- Shop pages (`lib/seo-salon.ts`): `BeautySalon` for confirmed ladies' parlours, `HairSalon`
  otherwise (schema.org has no barbershop type); **no `aggregateRating`**; real city name + state;
  photos, description, phone, geo, hours only when the shop published them; `OfferCatalog` of
  the shop's real services and prices.
- City pages: `FAQPage` (visible on the page) and `ItemList` of the listed shops.
  FAQ rich results are limited by Google to government/health sites; the markup is kept only
  because it matches visible content — no rich result is expected.

**Content / local**
- City page: answer-first intro using the live shop count ("You can book a salon … in
  Jharsuguda online on FastQue. 1 salon in Jharsuguda, Odisha is listed below …"), and a visible
  5-question FAQ limited to real product capabilities (book ahead, live queue, prices, open now,
  reviews, owner listing). No "free", "best", ratings or statistics claims.
- Shop page titles: "{Shop} — {Barbershop | Beauty parlour | Unisex salon | Salon} in {City}";
  heading label follows the shop type instead of "Barbershop" for every shop.
- Area pages: "Salons & barbershops in {Area}, {City}" (was "Barbershops in …").
- Thin pages: a city or area with no listed shop is `noindex, follow` (service×city already was).

**Sitemap**
- All shops per city (cursor pagination), not the first 50.
- No fake `lastmod`; only marketplace products keep their real `updatedAt`.
- Cities, areas and service×city pages are listed only when they show at least one real shop;
  service×city uses the same discovery request as the page (shared cache key).
- Logged (not silent) when the backend is unavailable; warning near the 50,000-URL limit.

**Tests** — `apps/web/lib/__tests__/seo-quality.test.jsx` (15 tests): no self-serving rating,
correct type/label, no invented values, city copy honesty and grammar, real-404 rule on every
dynamic public page, no root loading boundary, private areas noindex, thin-page noindex,
metadataBase + canonical host, sitemap rules, shared query.

## 3. Keyword → page map (no search volumes or positions are claimed: none measured yet)

| Keyword | Intent | Target page | Status / gap | Priority |
|---|---|---|---|---|
| FastQue, FastQue app | Brand | `/` | Organization graph added; needs indexing | High |
| online salon service in Jharsuguda / salon booking Jharsuguda | Local transactional | `/in/jharsuguda` | Answer-first intro + FAQ added; only **1** live shop — inventory is the real gap | High |
| best salon in {city} | Local commercial | `/in/{city}` | Page lists real shops; we do not claim "best" (no rating ranking) | Medium |
| salon booking in Hajipur | Local | `/in/hajipur-bihar` | 3 shops; same template | High |
| barber shop in Patna, Bhubaneswar, Mumbai … | Local | none | **No shops → no page** (by design) | Blocked on inventory |
| haircut / facial / bridal makeup in {city} | Service + local | `/in/{city}/services/{svc}` | Indexed only where a shop offers it | Medium |
| salon near me, haircut near me, beauty parlour near me | Local pack (Maps) | `/services/{svc}`, `/` | Mostly won by Google Maps listings → needs shops' Google Business Profiles | Medium |
| book salon appointment online, salon booking app India | Transactional | `/`, `/app` | Homepage copy; needs authority/backlinks | Medium |
| salon management software India, barber shop / salon queue management software | B2B | none dedicated | **Gap:** no owner-facing landing page; recommend a factual `/for-salons` page (owner decision on pricing/claims) | High (next PR) |

## 4. Competitors (evidence limits)

Only evidence collected: the owner's Google AI Overview for "online salon service in Jharsuguda"
(19 Nov) cited Justdial, Sulekha, LUZO and Salonist. Their backlinks, rankings and inventory were
**not** measured (no keyword/backlink tool access). What is evident: they are long-established,
widely-linked directories with many listings per city. FastQue's realistic advantage is
first-party, real-time data (live queue, open now, real prices, booking) — which this branch now
exposes in crawlable HTML and structured data. Inclusion in AI Overviews is decided by Google and
**cannot be guaranteed**.

## 5. Owner / manual actions (blockers)

1. **Search Console** (property `https://fastque.com/`, verified): wait for the first indexing
   report (1–3 days), then send me the "Pages" and "Performance" screens or keep the browser
   logged in. After this branch is live: resubmit `sitemap.xml` and request indexing for
   `/`, `/in/jharsuguda`, `/in/hajipur-bihar`, `/in/greater-noida`, `/in/noida`.
2. **Google Business Profile** (FastQue, created 19 Nov): video verification.
3. **DNS**: add `www.fastque.com` (CNAME) and redirect it to `https://fastque.com` (Spaceship).
4. **Inventory**: real shops in target cities (Jharsuguda has 1). Pages for cities without shops
   are intentionally not created.
5. **Shop data**: ask shops to set their type (many show "Type not set"), photos, hours, phone,
   map pin — all feed the structured data.
6. **Authority (genuine only)**: each partner shop links its FastQue page from its own Google
   Business Profile/Instagram; FastQue company profiles on LinkedIn, Facebook, Instagram, YouTube,
   Crunchbase, Startup India; local press about launches. No paid/spam links, no fake reviews.
7. **Bing Webmaster Tools**: import the Search Console property (owner login).

## 6. Not done in this branch (honest)

- Lighthouse / Core Web Vitals: not measured; no CrUX field data exists for a new site.
- Rich Results Test: JSON-LD validated by unit tests and parsing only, not by Google's tool
  (needs a public URL; do it after deploy).
- Real-device booking test, Bing, keyword/backlink research tools: not available.
- B2B landing page and locality guides: need owner decisions and real data.
