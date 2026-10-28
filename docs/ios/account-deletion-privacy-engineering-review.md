# FastQue iOS account deletion and privacy engineering review

**Internal engineering review; not a public privacy notice, legal opinion, or App Store Connect privacy declaration.**
This review is based on the PR #331 source baseline `fc54afbe944483bbb29648d51544f02179789847` and the isolated account-deletion implementation in this branch. It must be reconciled against the actual production API, vendor configuration, and the signed binary before submission.

## Account deletion behavior and limits

- Customer-only accounts retain the existing authenticated in-app deletion endpoint. The backend validates the signed-in user, revokes refresh sessions and provider credentials where it has the necessary revocation material, removes direct identity/contact surfaces and customer content according to the existing implementation, and preserves linked operational/financial records in de-identified form. This branch does not change that behavior.
- Non-customer, staff, owner, administrator, and mixed-role accounts receive an in-app, account-bound deletion-request form. The API derives the subject only from the authenticated session, classifies the current role relationships on the server, and records one idempotent request. It exposes a self-only status DTO and does not accept another user ID.
- The request is deliberately non-destructive: it does not revoke access, end employment, transfer or close a shop, alter bookings/payments, delete personal data, or claim that deletion is complete. The app reports the request as pending and keeps access active. Current automatic resolution and completion workflow is not implemented.
- The new table is an additive Prisma migration. It has not been applied to any production database. The mobile request/status API will fail until a coordinated backend release applies the migration.
- Current direct customer deletion is not a substitute for a complete deletion process for owners, staff, administrators, or mixed-role accounts. The flow in this branch is a safe in-app initiation step, not final App Store deletion certification.

## Retention and continuity policy requiring owner/legal approval

No retention period is proposed here. Before enabling final deletion for non-customer accounts, approve a policy that identifies, by record class: (1) what must be erased, (2) what may or must be retained and the concrete purpose/legal basis, (3) minimization or de-identification requirements, (4) the event that starts each retention clock and its duration, (5) who may access retained records, and (6) when deletion is verified. Legal counsel should validate applicable jurisdictions and recordkeeping duties.

The policy must also decide:

| Account scope | Required continuity decision before final deletion |
| --- | --- |
| Customer-only | Keep the current deletion semantics unless the separately approved retention policy requires changes. |
| Staff / field employee | Resolve active shop membership, assigned work, employee identity/history and outstanding operational duties without deleting another party’s records. |
| Shop owner | Transfer shop ownership to an authorized successor, or approve an alternative operational closure path. Never orphan or silently close a shop. |
| Platform administrator | Assign successor/recovery access and preserve required administrative audit continuity. |
| Mixed-role | Resolve every role and tenant relationship independently; do not allow customer-role deletion to remove business/admin relationships. |

The owner must additionally approve the request handling owner/team, identity verification, user-visible next steps, status transitions, completion notification and a reasonable completion target. Do not make the flow depend solely on email, phone, or chat support; provide an in-app workflow. No business policy or completion SLA is encoded by this change.

## iOS data-flow and SDK inventory (source-level)

Observed in the mobile manifest/config and source:

| Data / operation | Source-level behavior | External party or remaining verification |
| --- | --- | --- |
| Account identifiers and authentication | Email/phone and role-scoped account/session data use FastQue API. Google native sign-in and Apple sign-in provide provider identity/token material to the API. Refresh tokens are stored using Expo SecureStore on native. | Verify production OAuth audiences, server validation, token storage/revocation and configured auth processors against the final backend. |
| Location | `expo-location` requests foreground permission on user-initiated nearby discovery/shop registration paths; coordinates are sent with nearby searches/registration. Reverse geocoding uses the device location API. No background-location permission is declared in the reviewed config. | Verify exact fields/retention in the deployed backend and Apple permission prompt behavior on device. |
| Push notifications | `expo-notifications` obtains an Expo push token and registers the token with the authenticated FastQue API. | Expo push service processes delivery; confirm production APNs credentials, payload fields and account-deletion token removal. |
| Images | `expo-image-picker` supports user-selected shop/QR and Style Advisor imagery; upload code sends images to FastQue endpoints. | Verify actual storage vendor, access controls, image retention/deletion, and whether any image-generation provider is enabled. Do not describe an optional provider as active without evidence. |
| App updates and backend | Expo Updates downloads bundles from the configured EAS project. API base URL is supplied by build environment with a production fallback. | Confirm final build’s resolved production URL, TLS, EAS account/project and any backend/storage sub-processors. |
| Other direct mobile SDKs | Manifest includes Expo SecureStore, Apple authentication, Google native sign-in, location, notifications, image picker, updates, video/speech and packaged font libraries. Source/manifest scan did not identify a direct mobile analytics or advertising SDK. | Recheck the complete transitive/native SDK and privacy-manifest inventory for the exact IPA; a source scan does not prove the contents or behavior of the final binary. |

Do not update the published privacy policy or App Store privacy label from this inventory alone. The live public policy was read on October 28, 2026; it states a last-updated date of September 10, 2026 and describes account identifiers, foreground location, booking/queue data, payment routing, photos, notifications, Google sign-in, Expo notifications and Resend transactional email. It does not currently identify Apple Sign-In or explain the new role-aware in-app request flow. Confirm current production practices and the full processor list before updating it.

## App Store source-level checklist

- Source bundle ID: `com.dcw.fastque`.
- Expo project ID and owner are present in source config. These identify configuration only; EAS account access is not verified by this file review.
- `ios-production` is configured for `distribution: store`, inherits production settings, uses remote app-version management/auto-increment, and enables the iOS-only config gate. The dynamic config adds `usesAppleSignIn: true` and the Apple auth plugin only when `FASTQUE_IOS_BUILD=true`; it also requires a valid public Google iOS client ID.
- The final resolved native config, Team ID, registered App ID capability, distribution certificate/profile, APNs key and App Store Connect permissions still require authenticated account-side verification. Do not infer them from source.
- The current customer deletion path attempts Apple authorization revocation when it has stored revocation material and surfaces a manual-required result when it cannot complete. No Apple account-change/server-notification endpoint was found in the reviewed backend source. Confirm the approved Apple notification configuration and revocation outcomes before stating complete Sign in with Apple deletion compliance.
- Public URLs currently referenced by source: `https://fastque.com/privacy-policy`, the public `/account-deletion` page, and `support@fastque.com`. Verify those URLs resolve and match approved operational policy before listing submission.
- App Store metadata, privacy answers, age rating, export-compliance answer, review credentials/instructions, seller identity, screenshots, TestFlight and public listing remain unverified.

## Release gate summary

This change is suitable for review as an isolated Draft PR after tests and disposable-migration certification. It does not authorize applying the migration or deploying the endpoints. A complete App Store deletion-compliance PASS remains blocked on the approved retention/continuity policy, a real non-destructive case-resolution workflow, production backend deployment, accurate finalized privacy disclosures, and authenticated physical-device acceptance.
