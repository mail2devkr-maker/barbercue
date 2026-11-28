# API

Generated from the controllers. All paths are under `/api/v1`. "Public" needs no sign-in; every other route needs a valid session and re-checks ownership. Starting new business answers 404 while the flag is off.

## `home` (public)

- `GET home/config`
- `GET home/landing`
- `GET home/categories`
- `GET home/search`
- `GET home/professionals/:id`
- `POST home/understand`
- `GET home/campaigns`
- `POST home/quote`
- `POST home/slots`
- `POST home/guest/holds`
- `POST home/guest/bookings`
- `GET home/shared/:token`

## `home/guest/bookings/:code` (public)

- `GET home/guest/bookings/:code`
- `POST home/guest/bookings/:code/phone-code`
- `POST home/guest/bookings/:code/phone-verify`
- `POST home/guest/bookings/:code/cancel`
- `GET home/guest/bookings/:code/tracking`
- `POST home/guest/bookings/:code/start-code`
- `POST home/guest/bookings/:code/tickets`
- `POST home/guest/bookings/:code/review`
- `POST home/guest/bookings/:code/incident`

## `home/me`

- `GET home/me/landing`
- `GET home/me/addresses`
- `POST home/me/addresses`
- `PUT home/me/addresses/:id`
- `DELETE home/me/addresses/:id`
- `GET home/me/favorites`
- `PUT home/me/favorites/:id`
- `DELETE home/me/favorites/:id`
- `GET home/me/suggestions`
- `POST home/me/quote`
- `POST home/me/slots`
- `POST home/me/holds`
- `DELETE home/me/holds/:id`
- `GET home/me/bookings`
- `POST home/me/bookings`
- `GET home/me/bookings/:code`
- `POST home/me/bookings/:code/cancel`
- `POST home/me/bookings/:code/reschedule`
- `POST home/me/bookings/:code/reschedule/answer`
- `POST home/me/bookings/:code/replacement`
- `POST home/me/bookings/:code/no-show`
- `POST home/me/bookings/:code/interrupt`
- `GET home/me/bookings/:code/tracking`
- `POST home/me/bookings/:code/start-code`
- `POST home/me/bookings/:code/completion-code`
- `POST home/me/bookings/:code/extras/:id`
- `POST home/me/bookings/:code/payments/:id`
- `POST home/me/bookings/:code/review`
- `POST home/me/bookings/:code/tickets`
- `GET home/me/bookings/:code/tickets/:id`
- `POST home/me/bookings/:code/tickets/:id`
- `POST home/me/bookings/:code/incident`
- `POST home/me/bookings/:code/share`
- `POST home/me/bookings/:code/block`
- `GET home/me/bookings/:code/rebook`
- `GET home/me/recurring`
- `POST home/me/recurring`
- `PUT home/me/recurring/:id`
- `POST home/me/campaigns/:id/join`
- `POST home/me/campaigns/:id/leave`
- `POST home/me/campaigns/:id/price`
- `GET home/me/export`
- `DELETE home/me/data`

## `home/pro`

- `GET home/pro/profile`
- `GET home/pro/prefill`
- `POST home/pro/register`
- `PUT home/pro/settings`
- `POST home/pro/terms`
- `POST home/pro/submit`
- `PUT home/pro/offerings`
- `PUT home/pro/areas`
- `PUT home/pro/profiles/:id`
- `POST home/pro/profiles/:id/consent`
- `POST home/pro/profiles/:id/online`
- `POST home/pro/profiles/:id/verifications`
- `GET home/pro/verifications/:id/file`
- `GET home/pro/calendar`
- `POST home/pro/time-off`
- `DELETE home/pro/time-off/:id`
- `GET home/pro/requests`
- `POST home/pro/requests/:id/accept`
- `POST home/pro/requests/:id/decline`
- `GET home/pro/bookings`
- `GET home/pro/bookings/:code`
- `POST home/pro/bookings/:code/:action`
  - actions: `prepare`, `on-the-way`, `arrived`, `address-issue`, `customer-no-show`, `delay`, `check-in`, `start`, `interrupt`, `hygiene`, `extras`, `complete`, `payment`, `cancel`, `cannot-come`, `reschedule`, `reschedule-answer`, `feedback`, `incident`, `ticket`, `share`, `block`, `tracking-start`, `tracking-stop`
- `PUT home/pro/bookings/:code/location`
- `GET home/pro/earnings`
- `GET home/pro/reviews`
- `POST home/pro/reviews/:id/respond`
- `POST home/pro/reviews/:id/report`
- `POST home/pro/incident`

## `dashboard/salons/:salonId/home`

- `GET dashboard/salons/:salonId/home`
- `POST dashboard/salons/:salonId/home/enable`
- `GET dashboard/salons/:salonId/home/sources`
- `POST dashboard/salons/:salonId/home/terms`
- `POST dashboard/salons/:salonId/home/submit`
- `PUT dashboard/salons/:salonId/home/settings`
- `PUT dashboard/salons/:salonId/home/offerings`
- `PUT dashboard/salons/:salonId/home/areas`
- `POST dashboard/salons/:salonId/home/staff/:staffId`
- `PUT dashboard/salons/:salonId/home/professionals/:id`
- `GET dashboard/salons/:salonId/home/bookings`
- `GET dashboard/salons/:salonId/home/bookings/:code`
- `POST dashboard/salons/:salonId/home/bookings/:code/:action`
  - actions: `assign`, `cancel`, `reschedule`, `reschedule-answer`, `replacement`, `payment`
- `GET dashboard/salons/:salonId/home/reviews`
- `POST dashboard/salons/:salonId/home/reviews/:id/respond`
- `POST dashboard/salons/:salonId/home/reviews/:id/report`
- `GET dashboard/salons/:salonId/home/earnings`
- `GET dashboard/salons/:salonId/home/settlements`
- `GET dashboard/salons/:salonId/home/promotions`
- `POST dashboard/salons/:salonId/home/promotions`
- `POST dashboard/salons/:salonId/home/packages`
- `GET dashboard/salons/:salonId/home/advice`

## `admin/home`

- `GET admin/home/overview`
- `GET admin/home/dispatch`
- `GET admin/home/providers`
- `POST admin/home/providers/:id/review`
- `POST admin/home/professionals/:id/suspend`
- `GET admin/home/verifications`
- `POST admin/home/verifications/:id/review`
- `GET admin/home/verifications/:id/file`
- `GET admin/home/bookings`
- `GET admin/home/bookings/export`
- `GET admin/home/bookings/:code`
- `GET admin/home/bookings/:code/tracking`
- `POST admin/home/bookings/:code/:action`
  - actions: `invite`, `replacement`, `cancel`, `force-check-in`, `professional-no-show`, `refund`, `void-payment`
- `GET admin/home/catalog`
- `PUT admin/home/catalog/categories/:id`
- `PUT admin/home/catalog/services`
- `GET admin/home/growth`
- `POST admin/home/promotions`
- `POST admin/home/societies`
- `POST admin/home/campaigns`
- `POST admin/home/campaigns/close-due`
- `POST admin/home/membership-plans`
- `GET admin/home/quality`
- `POST admin/home/reviews/:id`
- `GET admin/home/incidents`
- `POST admin/home/incidents/:id`
- `GET admin/home/tickets`
- `POST admin/home/tickets/:id`
- `GET admin/home/money`
- `POST admin/home/fee-rules`
- `PUT admin/home/fee-rules/:id`
- `POST admin/home/settlements`
- `POST admin/home/settlements/:id/collect`
- `GET admin/home/training`
- `GET admin/home/insights`
- `GET admin/home/analytics`
- `GET admin/home/audit`
- `GET admin/home/settings`
- `PUT admin/home/settings`
- `GET admin/home/field`

## `employee/home`

- `GET employee/home/leads`
- `POST employee/home/leads`
- `PUT employee/home/leads/:id`
- `POST employee/home/leads/:id/register`
