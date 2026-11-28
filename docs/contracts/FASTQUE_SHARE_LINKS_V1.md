# FastQue canonical salon share links V1

## Endpoint

`GET /api/v1/dashboard/salons/{salonId}/share-links`

Returns the canonical public FastQue profile path and share-safe Open Graph metadata for the selected salon. The endpoint is read-only and does not create a short link or invoke an external provider.

## Authorization and privacy

- Requires a `STAFF`-audience authenticated session with `SALON_OWNER` membership for the requested salon, or a global `PLATFORM_ADMIN` session.
- A barber/staff-only membership, customer session, unauthenticated request, or owner from another salon is denied.
- The response uses `Cache-Control: private, no-store` and contains no contact details or other private salon/customer information.
- Public readiness reflects the existing public-profile contract: the salon must be `ACTIVE`, and the trusted server-side `WEB_BASE_URL` must be a valid HTTPS origin (HTTP is accepted only for loopback development).
- Missing or invalid `WEB_BASE_URL` fails closed by returning `publicUrl: null` and `WEB_BASE_URL_NOT_CONFIGURED`; it is never derived from an untrusted request Host header.

## Response

```json
{
  "salonId": "<salon-uuid>",
  "status": "ACTIVE",
  "publicPath": "/in/<city-slug>/<salon-slug>",
  "publicUrl": "https://fastque.com/in/<city-slug>/<salon-slug>",
  "readiness": { "ready": true, "reasons": [] },
  "metadata": {
    "title": "Salon name",
    "description": "Public salon description or null",
    "imageUrl": "Public cover/gallery URL or null"
  }
}
```

`publicPath` is constructed from the existing canonical public route using persisted country, city and salon slugs. Path segments are URL-encoded. `publicUrl` uses only the configured web origin. When the shop is not active, its canonical path remains available for owner review, but `readiness.ready` is false and includes `SALON_NOT_PUBLIC`.

## Errors

- `400`: malformed salon UUID.
- `401`: missing/invalid authentication.
- `403`: role or salon-scope authorization failure.
- `404`: salon does not exist.

This contract adds no database schema or migration and is backward-compatible with existing clients.
