# FastQue Customer Assistant Search API v1

Requirement #15 exposes a deterministic, provider-free search across active public salon services and current booking availability. This is a retrieval API, not a generative assistant and not a reservation.

## Endpoint

`POST /api/v1/assistant/search`

The endpoint is public because it is part of customer discovery. It is throttled to 5 requests per IP per minute, validates a bounded body, returns `Cache-Control: no-store`, and exposes no owner, employee, customer, phone, email, booking, queue, or internal financial records.

## Request

```json
{
  "serviceQuery": "haircut",
  "date": "2026-10-22",
  "city": "hajipur",
  "countryCode": "IN",
  "lat": 25.69,
  "lng": 85.21,
  "radiusKm": 25,
  "maxPrice": 500,
  "limit": 3
}
```

`serviceQuery` is trimmed and must contain 2–80 characters. `date` must be a real `YYYY-MM-DD` calendar date and is interpreted in each salon's resolved IANA timezone. A location scope is required: either `city` (a city slug) or a coordinate pair. `countryCode` is optional and requires `city`. Coordinates must be supplied together; `radiusKm` requires both and is capped at 500. `maxPrice` is an optional non-negative price ceiling. `limit` is 1–5 and defaults to 3. The backend examines at most twelve salon candidates per request to bound database work. Availability beyond the existing booking engine's supported horizon is returned as no slots.

## Response

```json
{
  "mode": "DETERMINISTIC_CATALOG_AVAILABILITY",
  "generated": false,
  "bookingConfirmationRequired": true,
  "date": "2026-10-22",
  "candidates": [
    {
      "salon": {
        "id": "<internal salon UUID>",
        "publicId": "BC-SHOP-000001",
        "name": "Example Salon",
        "slug": "example-salon",
        "citySlug": "hajipur",
        "countryCode": "IN",
        "distanceKm": 2.4
      },
      "service": {
        "id": "<service UUID>",
        "name": "Haircut",
        "category": "Hair",
        "price": 250,
        "durationMinutes": 30
      },
      "currency": "INR",
      "timeZone": "Asia/Kolkata",
      "availableSlots": [
        { "slotStart": "2026-10-22T03:30:00.000Z", "slotEnd": "2026-10-22T04:00:00.000Z" }
      ]
    }
  ]
}
```

Only active salons and active matching service rows qualify. Name matches take precedence over category-only matches; ties use actual price and stable ID ordering. Returned slots come from `AvailabilityService`, filtered to `available: true`, and are capped at three per salon. A slot is an availability snapshot, not a hold: the normal booking endpoint revalidates capacity when the customer explicitly confirms.

## Authorization and side effects

No authentication is required for public discovery. The response contains only public catalog/location data and available slot times. It has no side effect: no booking, payment, notification, queue entry, or provider call is created. Search requests are bounded to twelve salon candidates, a maximum result count of five, and five requests per minute.

## Errors

Malformed input returns the existing `400 VALIDATION_ERROR` envelope. Database or availability failures are not converted into fabricated empty success data; unexpected failures use the common API error handling. Existing availability and booking behavior remains authoritative.

## Capability semantics

`customerAssistant` is `ENABLED` with reason code `DETERMINISTIC_CATALOG_AVAILABILITY_SEARCH` only because this endpoint is available. This does not mean an LLM, chat memory, conversational orchestration, or booking automation is configured. Paid AI providers remain separate and disabled unless independently configured and approved.
