# Owner Insights — deterministic query API (v1)

Status: backend candidate in the non-production branch `codex/fastque-owner-assistant-20261020`. This is a provider-free, rule-based read feature, not generative AI. It does not complete the broader owner/customer AI-assistant requirement by itself.

## Endpoint

`POST /api/v1/dashboard/salons/:salonId/assistant/query`

Requires the existing authenticated STAFF-audience session and current salon-scoped owner or platform-admin authorization. A barber, customer, or owner of another salon receives the standard authorization error. Access is checked before query interpretation. Response is `Cache-Control: private, no-store`; the route has a 12-request/minute throttle in addition to the existing global rate limit.

Request:

```json
{ "question": "How many appointments today?" }
```

`question` is trimmed, 2–300 characters, and the object rejects unknown fields. The server does not retain, log, or echo the question in the API response.

Response:

```json
{
  "salonId": "uuid",
  "mode": "DETERMINISTIC",
  "intent": "TODAY_RECORDED_AND_ESTIMATED_VALUE",
  "localDate": "2026-10-20",
  "timezone": "Asia/Kolkata",
  "answer": "For 2026-10-20 (Asia/Kolkata), shop-recorded collections are INR 245.00. Completed-service listed-price value is estimated at INR 380.00; this estimate is not collected revenue.",
  "figures": [
    { "metric": "recordedCollectionsToday", "value": 245, "unit": "money", "currency": "INR", "estimated": false },
    { "metric": "estimatedServiceValueToday", "value": 380, "unit": "money", "currency": "INR", "estimated": true }
  ],
  "generatedAt": "2026-10-20T10:00:00.000Z"
}
```

## Supported intents

- `TODAY_SUMMARY`
- `TODAY_RECORDED_AND_ESTIMATED_VALUE`
- `APPOINTMENTS_TODAY`
- `COMPLETED_SERVICES_TODAY`
- `WAITING_QUEUE_NOW`
- `IN_SERVICE_NOW`
- `AVAILABLE_BARBERS_NOW`
- `CANCELLATIONS_TODAY`

The initial parser recognizes a narrow English/Hinglish/Hindi phrase set. Period requests other than today/current state, unsupported requests, customer lookups, booking changes, and advice are rejected with HTTP 422 and `OWNER_ASSISTANT_QUERY_UNSUPPORTED`; the response lists supported intent descriptions and never includes the submitted text. Clients should present this as “Quick Insights” or disclose its limited deterministic scope, not claim an AI/LLM is active.

## Data and safety semantics

- The existing `OwnerOverviewService` is the only source of values; figures are not separately recomputed or generated.
- `recordedCollectionsToday` is the shop-recorded invoice payment ledger net of recorded refunds. It is not a claim about external settlement or all cash/card receipts.
- `estimatedServiceValueToday` is completed-service listed-price value. It is always marked `estimated: true` and must not be described as revenue or money collected.
- Counts and money use the salon-local date/timezone returned in the response. Currency is nullable when not configured.
- No customer, phone, email, staff identity, or schedule rows are returned. No writes, provider calls, assistant conversation storage, or booking/payment actions occur.
- The assistant capability may be `ENABLED` with `reasonCode: DETERMINISTIC_QUERY_ONLY`; customer-assistant generation remains unconfigured until a separate, secure availability/search contract is implemented.

## Stable errors

- Standard validation envelope for malformed input.
- Standard live salon-access errors for unauthorized users.
- `OWNER_ASSISTANT_QUERY_UNSUPPORTED` (422) for unsupported intent or period.
- Standard throttling error when the route limit is exceeded.
