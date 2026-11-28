# Issue #429 follow-up: discovery rendering and content

This follow-up is based on production master `551b31498eeff4492f0aa5c33e2895ba134a6671`, which includes merged PR #446. It complements that release and the separate open sitemap-rate-limit PR #447; it does not replace their local-business schema, 404, city-content, or inventory-sitemap work.

## Changes in this candidate

- The unfiltered `/search` page fetches its initial city list and first salon page in Server Components and passes those records to the existing filter client. Filtered URLs retain the current client-side flow. If initial discovery is unavailable, the page falls back to the existing client fetch and error/loading behavior.
- Three original, route-specific guides explain online salon booking, live queue use, and the owner software features currently represented by FastQue. Claims are qualified by shop configuration and actual availability. They are linked in the site footer and listed in a separate `sitemap-guides.xml`, declared alongside the inventory sitemap in `robots.txt`; this avoids editing the inventory sitemap while PR #447 is active.
- Next metadata image routes generate a real brand-only 1200×630 social card. They contain no fabricated product screenshots, ratings, awards, or metrics.
- The web proxy redirects the exact `www.fastque.com` host to HTTPS `fastque.com` before its existing protected-route logic. Existing account/dashboard session routing is preserved. This code only works if `www` DNS is pointed to the same Railway web service; this candidate does not change DNS or Railway domains.
- Pull-request CI runs focused SSR/metadata/sitemap/proxy tests, changed-file lint, web TypeScript/build, a sitemap/page crawl, and Lighthouse CI. Crawl and Lighthouse use a local synthetic discovery API fixture, not FastQue production APIs or customer data. Lab reports are retained as a private Actions artifact for 14 days.

## Evidence and known blockers

- Focused SEO tests on the preserved local worktree: **11 passed / 11**, 4 suites (metadata, education sitemap, search SSR, and canonical proxy). Changed-file ESLint and `node --check` on the crawl/Lighthouse scripts passed.
- Local `typecheck`/production build are not certified: this host's isolated node_modules is incomplete and has a mismatched Next installation, and package-registry DNS failed. The exact-head workflow installs from the lockfile and runs both checks.
- Exact-head hosted checks have passed for the current implementation: 11 focused tests across 4 suites; lint, typecheck, and production build; synthetic crawl parsed 123 inventory URLs and 3 education URLs, and checked 6 candidate pages including a real-in-fixture locality; Lighthouse ran 3 times per page (18 lab reports) and passed the configured SEO score threshold. These counts and Lighthouse measurements describe synthetic lab data, not production inventory or field Core Web Vitals.
- Production TLS/redirect behavior, live API-backed route health, DNS routing for `www`, Google/Bing Search Console access, indexing, impressions, and field Core Web Vitals remain unverified. Search Console/Bing Webmaster access is not connected; no sitemap submission is claimed.
- The current public discovery API distinguishes an unknown salon with 404 but provides no separate permanently-removed listing signal for a truthful 410 response.

No Railway configuration, DNS, production data, bookings, authentication, or customer workflows were changed. No deployment was performed.
