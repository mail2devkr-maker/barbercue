# External salon review profiles — API contract v1

This additive contract supports Requirement #6 on top of the existing owner review API. It stores
owner-provided outbound profile URLs only. No third-party review data is scraped, fetched, synced,
or merged, and no provider credentials are used.

All routes use the existing `/api/v1` prefix and require an authenticated `SALON_OWNER` session
for the requested salon. The existing delegated `PLATFORM_ADMIN` path remains available; writes
are audited. Authorization is checked server-side against the salon on every request.

## Review listing

`GET /api/v1/dashboard/salons/:salonId/reviews?source=FASTQUE|GOOGLE|FACEBOOK|INSTAGRAM&limit=20&cursor=...`

`source` is optional and defaults to `FASTQUE`. The response retains the current `items` and
`nextCursor` pagination fields and adds the selected `source` and a `sources` array:

```json
{
  "source": "FASTQUE",
  "items": [],
  "nextCursor": null,
  "sources": [
    { "source": "FASTQUE", "state": "CONNECTED", "profileUrl": null },
    { "source": "GOOGLE", "state": "LINK_ONLY", "profileUrl": "https://g.page/example" },
    { "source": "FACEBOOK", "state": "UNAVAILABLE", "profileUrl": null },
    { "source": "INSTAGRAM", "state": "UNAVAILABLE", "profileUrl": null }
  ]
}
```

Only `FASTQUE` returns FastQue review rows. Selecting GOOGLE, FACEBOOK, or INSTAGRAM returns an
empty `items` array and `nextCursor: null`; `LINK_ONLY` means the dashboard may link out to the
owner-supplied profile, not that external reviews are connected. Each FastQue row carries
`source: "FASTQUE"`. An unsupported `source` returns `400 INVALID_REVIEW_SOURCE` in the standard
API error envelope.

## Read and update profile links

`GET /api/v1/dashboard/salons/:salonId/review-profiles` returns `{ "sources": [...] }` in the same
shape as the listing.

`PUT /api/v1/dashboard/salons/:salonId/review-profiles` accepts a partial update:

```json
{
  "googleUrl": "https://g.page/example",
  "facebookUrl": "https://www.facebook.com/example",
  "instagramUrl": "https://www.instagram.com/example/"
}
```

Omitted fields are unchanged; an explicit `null` clears that provider link. Empty bodies and unknown
fields are rejected. URLs are trimmed, canonicalized, limited to 500 characters, HTTPS-only, and
validated against exact provider host allowlists. Credentials, non-default ports, and token/code
query parameters are rejected. Google `google.com` URLs must point to `/maps` or `/search`, not an
open-redirect path. Validation is not proof that the profile belongs to the salon; ownership of the
profile URL remains the shop owner's responsibility.

Successful writes emit `SALON_REVIEW_PROFILES_UPDATED` in `audit_logs` in the same transaction as
the profile write. The audit records the salon and changed provider names, but deliberately omits
full URLs. The salon-scoped primary key and foreign key prevent profiles from crossing shops.

## Provider boundary

OAuth, webhooks, external API calls, profile ownership verification, rating aggregation, and
third-party review synchronization are not enabled in this contract. A future provider connector
requires separate credentials, product approval, provider terms review, and exact source identity
mapping. Until then, external sources must remain visibly `LINK_ONLY` or `UNAVAILABLE` and must
never contribute rows to FastQue ratings or aggregates.
