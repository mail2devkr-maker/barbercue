# FastQue Customer and Owner Phone OTP API v1

This contract describes the backend implementation from PR #214 (`a64f6d8082b26d4b504a746d8ea5f2196d10cddb`) integrated into the non-production platform candidate. The browser/mobile UI remains owned by the frontend and Android workstreams.

## Availability

`GET /api/v1/auth/methods` returns public booleans:

```json
{
  "google": true,
  "phoneOtp": false,
  "ownerPhoneOtp": false
}
```

Clients must treat a missing `ownerPhoneOtp` field from an older backend as `false`. OTP is available only when the selected provider, approved template, HMAC secret (at least 32 bytes), explicit calling-code allowlist, and all positive delivery ceilings are configured. In non-production, the only enabled sender is the explicit synthetic test sender. No development sender logs codes.

## Customer sign-in

`POST /api/v1/auth/otp/request`

```json
{ "phone": "+919876543210" }
```

Response:

```json
{ "expiresInSeconds": 300 }
```

`POST /api/v1/auth/otp/verify`

```json
{ "phone": "+919876543210", "code": "123456" }
```

On success the response contains `{ user, tokens }`, issues a CUSTOMER-audience session, and sets the existing HttpOnly refresh cookie. A new number creates a customer account after OTP verification. Existing unverified accounts are not claimed by possession of a recycled number; the user must authenticate through an existing identity and use the authenticated phone-link flow.

## Shop-owner sign-in and phone linking

`POST /api/v1/auth/owner/otp/request` and `POST /api/v1/auth/owner/otp/verify` use the same request and response shapes as customer OTP. An owner login requires an active user with a verified phone, a salon-scoped `SALON_OWNER` role, and a matching canonical `Salon.ownerUserId`. Unknown or ineligible phone numbers receive the generic request response without a challenge or SMS. Successful login issues a STAFF-audience session containing the authorized owner role; it cannot upgrade a CUSTOMER session.

Owner phone linking requires an existing authenticated owner session:

- `POST /api/v1/auth/owner/phone/link/request`
- `POST /api/v1/auth/owner/phone/link/verify`

Customer phone linking similarly requires an authenticated customer session:

- `POST /api/v1/auth/customer/phone/link/request`
- `POST /api/v1/auth/customer/phone/link/verify`

Both use `{ "phone": "+919876543210" }` for requests and `{ "phone": "+919876543210", "code": "123456" }` for verification. The phone must not belong to another account. A successful link is audited, revokes the user's existing refresh tokens, then issues a fresh session for the same audience. Phone-link OTP challenges are bound to the authenticated subject user.

Phone OTP does not create a new owner account or infer ownership from a salon's public contact number. New owners must complete the existing account and shop-ownership process first, then verify/link their personal number while authenticated.

## Validation and errors

- Phone numbers use E.164 format (`+` followed by 8–15 digits); codes are exactly six digits.
- OTP requests and verification use the existing strict authentication throttle (5 requests per minute per throttler key), in addition to per-phone and database-backed global/country ceilings.
- Request challenges expire after five minutes. A later request supersedes the prior pending challenge for that phone, purpose, and subject. Verification is atomic and one-time; replay and concurrent second verification are rejected.
- An unavailable/misconfigured sender fails closed (`OTP_DELIVERY_FAILED`). Rate ceilings return `OTP_RATE_LIMITED`; malformed, invalid, expired, or exhausted codes use the existing OTP error codes. Authenticated link routes also enforce the corresponding CUSTOMER or SALON_OWNER role server-side.
- Ambiguous provider timeout attempts remain counted and are not retried or refunded automatically.

## Provider and release boundary

Production sending requires explicit provider API key and template, an HMAC secret, an explicit country allowlist, and the three owner-selected positive ceilings: daily global sends, rolling 24-hour global sends, and daily sends per calling code. These ceilings are message-attempt limits, not a currency guarantee. Provider pricing units, DLT/template approval, delivery receipts, and the owner's selected limits must be independently verified before production activation. No real SMS is sent by the test suite.

Backend integration source: `codex/fastque-platform-30-otp-integration-20261019`. Production configuration, Railway, Neon, and Android distribution are outside this contract and remain separate release gates.
