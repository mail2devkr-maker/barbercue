# Mobile phone OTP integration handoff

This is the client contract for the customer and shop-owner phone OTP work in Issue #211. The Android source is intentionally unchanged; Android 1.0.3 and 1.0.7 need separate client acceptance before release.

All paths below are relative to the configured API base URL, which already includes `/api/v1`.

## Capability probe

`GET /auth/methods` returns booleans only:

```json
{ "google": true, "phoneOtp": false, "ownerPhoneOtp": false }
```

Clients should hide or explain an unavailable OTP option when its relevant capability is `false`. Do not infer provider readiness from an API key name or expose provider configuration.

## Customer sign-in and onboarding

The existing customer endpoints are unchanged:

1. `POST /auth/otp/request` with `{ "phone": "+919876543210" }`.
2. `POST /auth/otp/verify` with `{ "phone": "+919876543210", "code": "012345" }`.

Phones must be valid E.164 numbers. Codes are six ASCII digits. Successful verification returns the same canonical customer account for a previously used number, creating it on first use. The response has `user.audience = "CUSTOMER"`; customer OTP never grants `SALON_OWNER` or a `STAFF` session. Google sign-in and existing email/password endpoints remain unchanged.

If a phone is already stored on an existing account but was never verified, OTP login fails closed rather than claiming that account based only on possession of a possibly recycled number. The user must first sign in with their existing Google/password identity and verify/link the phone from Account → Profile using `POST /auth/customer/phone/link/request` and `POST /auth/customer/phone/link/verify`. The link is bound to the authenticated CUSTOMER user, rejects a phone owned by another account, writes an audit event without phone metadata, revokes prior refresh sessions, and returns a fresh CUSTOMER-only session.

## New shop owner

Use the customer OTP endpoints above. After verification, submit the existing `POST /salons` shop-registration request with the returned CUSTOMER access token. The server transaction creates the shop and salon-scoped `SALON_OWNER` membership, then issues a fresh `STAFF`-audience session. Do not add an owner role in the client or promote the CUSTOMER token locally.

## Returning shop owner

1. `POST /auth/owner/otp/request` with `{ "phone": "+919876543210" }`.
2. `POST /auth/owner/otp/verify` with `{ "phone": "+919876543210", "code": "012345" }`.

This is a separate owner-only flow. The server only issues a `STAFF` session when the phone is already verified on an active account with a salon-scoped `SALON_OWNER` role and the salon's canonical `ownerUserId` points back to that same user. The customer and owner sessions are not interchangeable. Unknown/non-owner phone requests intentionally return the same generic request response without sending a message; invalid verification returns a generic error.

## Link a phone to an existing owner account

The owner must first sign in to their existing account (Google or email/password). From the authenticated owner settings screen:

1. `POST /auth/owner/phone/link/request` with `{ "phone": "+919876543210" }`.
2. `POST /auth/owner/phone/link/verify` with `{ "phone": "+919876543210", "code": "012345" }`.

Both endpoints require a STAFF-audience `SALON_OWNER` session. A phone already linked to a different account is rejected; accounts are never merged automatically. This updates the account's login phone, not `Salon.phone` (the shop's public contact number). A successful link revokes the account's existing refresh sessions and returns a fresh STAFF token pair.

## Session, expiry, and client rules

- OTPs expire after five minutes, permit at most five verification attempts, and are one-time-use. Resends supersede earlier pending challenges.
- The app applies the shared 45-second resend cooldown. Server-side per-phone limits remain authoritative.
- Keep refresh tokens in the existing platform-specific secure session mechanism. Web receives the existing HttpOnly refresh cookie; native clients should continue using the established refresh-token request contract.
- Treat rate-limit, delivery, expired, invalid, and phone-conflict responses as recoverable UI states. Never log phone numbers, codes, tokens, or provider responses.
- Do not call owner endpoints using a CUSTOMER token. Do not treat a shop contact number or a name/phone match as proof of owner identity.

## Release compatibility

The existing customer OTP request/verify contract and response shape are retained. `ownerPhoneOtp` is an additive capability boolean, so older clients may ignore it. Owner OTP endpoints are additive and no current mobile client uses them yet. This document is an implementation handoff, not a claim of Android binary, physical-device, real SMS delivery, or production-runtime certification.

For an application rollback after this migration is applied, leave the additive database schema in place. A legacy backend can continue reading its older OTP rows because the new column defaults to `LEGACY_SHA256`; a six-digit HMAC challenge issued by the newer backend is intentionally not verifiable by the legacy backend. If rollback occurs, allow such in-flight challenges to expire (at most five minutes) and have affected users request a fresh code. Do not reverse the migration as part of application rollback.
