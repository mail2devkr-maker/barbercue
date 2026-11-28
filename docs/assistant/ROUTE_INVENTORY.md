# FastQue route inventory (generated)

Best-effort generated from `apps/backend/src/**/*.controller.ts` on master `f4f15e98` for issue #362. Each row is a candidate assistant action. `Roles` is the controller-level gate; every handler also re-checks shop ownership/membership in its service. Unresolved path constants are shown in `{braces}`. A few rows have parse artifacts (a stray backtick, an abbreviated handler name); the controllers are authoritative.

**314 routes in 27 modules.**

| Module | Method | Path | Roles (controller gate) | Handler |
|---|---|---|---|---|
| admin | GET | /admin/overview | PLATFORM_ADMIN, CO_FOUNDER, HR_ADMIN, SALES_ADMIN, PLATFORM_VIEWER, | overview |
| admin | GET | /admin/shop-activity | PLATFORM_ADMIN, CO_FOUNDER, HR_ADMIN, SALES_ADMIN, PLATFORM_VIEWER, | shopActivityReport |
| admin | GET | /admin/analytics/overview | PLATFORM_ADMIN, CO_FOUNDER, PLATFORM_VIEWER | executiveOverview |
| admin | GET | /admin/analytics/timeseries | PLATFORM_ADMIN, CO_FOUNDER, PLATFORM_VIEWER | analyticsTimeseries |
| admin | GET | /admin/shops/status | PLATFORM_ADMIN, CO_FOUNDER, HR_ADMIN, SALES_ADMIN, PLATFORM_VIEWER, | shopStatusReport |
| admin | GET | /admin/customers | ADMIN_PERMISSION_ROLES.viewCustomerAnalytics | customerOverview |
| admin | GET | /admin/staff | ADMIN_PERMISSION_ROLES.viewStaffAnalytics | staffOverview |
| admin | GET | /admin/exports/customers | ADMIN_PERMISSION_ROLES.exportCustomerReport | exportCustomerReport |
| admin | GET | /admin/exports/customers/contact | ADMIN_PERMISSION_ROLES.exportCustomerContacts | exportCustomerContacts |
| admin | GET | /admin/exports/staff | ADMIN_PERMISSION_ROLES.exportStaffPerformance | exportStaffPerformance |
| admin | GET | /admin/exports/staff/contact`, | ADMIN_PERMISSION_ROLES.exportStaffContacts | exportStaffContacts |
| admin | GET | /admin/analytics/customers-served | ADMIN_PERMISSION_ROLES.exportCustomerReport | servedCustomers |
| admin | GET | /admin/verification | PLATFORM_ADMIN, CO_FOUNDER | listVerification |
| admin | GET | /admin/verification/:id | PLATFORM_ADMIN, CO_FOUNDER | getVerification |
| admin | POST | /admin/verification/:id/start-review | PLATFORM_ADMIN, CO_FOUNDER | startReview |
| admin | POST | /admin/verification/:id/decide | PLATFORM_ADMIN, CO_FOUNDER | decide |
| admin | GET | /admin/employees | PLATFORM_ADMIN, CO_FOUNDER, HR_ADMIN | listEmployees |
| admin | POST | /admin/employees | PLATFORM_ADMIN, CO_FOUNDER, HR_ADMIN | createEmployee |
| admin | POST | /admin/employees/special | PLATFORM_ADMIN, CO_FOUNDER, HR_ADMIN | createSpecialEmployee |
| admin | PATCH | /admin/employees/:id | PLATFORM_ADMIN, CO_FOUNDER, HR_ADMIN | updateEmployee |
| admin | POST | /admin/employees/:id/password | PLATFORM_ADMIN, CO_FOUNDER, HR_ADMIN | resetEmployeePassword |
| admin | GET | /admin/crm/overview | PLATFORM_ADMIN, CO_FOUNDER, HR_ADMIN, SALES_ADMIN | crmOverview |
| admin | GET | /admin/crm/leads | PLATFORM_ADMIN, CO_FOUNDER, HR_ADMIN, SALES_ADMIN | crmLeads |
| admin | GET | /admin/crm/visits | PLATFORM_ADMIN, CO_FOUNDER, HR_ADMIN, SALES_ADMIN | crmVisits |
| admin | GET | /admin/crm/follow-ups | PLATFORM_ADMIN, CO_FOUNDER, HR_ADMIN, SALES_ADMIN | crmFollowUps |
| admin | GET | /admin/crm/analytics | PLATFORM_ADMIN | crmAnalytics |
| admin | GET | /admin/crm/leads/page | PLATFORM_ADMIN | crmLeadsPage |
| admin | GET | /admin/crm/visits/page | PLATFORM_ADMIN | crmVisitsPage |
| admin | GET | /admin/crm/follow-ups/page | PLATFORM_ADMIN | crmFollowUpsPage |
| admin | GET | /admin/location-verifications | PLATFORM_ADMIN | listLocationProposals |
| admin | POST | /admin/location-verifications/:proposalId/decision`, | PLATFORM_ADMIN | decideLocationProposal |
| admin | GET | /admin/access | PLATFORM_ADMIN | listAdminAccess |
| admin | POST | /admin/access | PLATFORM_ADMIN | grantAdminAccess |
| admin | POST | /admin/access/:userId/revoke | PLATFORM_ADMIN | revokeAdminAccess |
| admin | DELETE | /admin/shops/:id | PLATFORM_ADMIN, CO_FOUNDER | deleteShop |
| admin | PATCH | /admin/shops/:id/status | PLATFORM_ADMIN, CO_FOUNDER | updateShopStatus |
| assistant | GET | /assistant/capabilities | any signed-in | capabilities |
| assistant | POST | /assistant/turns | any signed-in | turn |
| assistant | POST | /assistant/confirmations | any signed-in | confirm |
| auth | POST | /auth/admin/totp/setup | any signed-in | setup |
| auth | POST | /auth/admin/totp/confirm | any signed-in | confirm |
| auth | GET | /auth/methods | any signed-in | authMethods |
| auth | POST | /auth/otp/request | any signed-in | otpRequest |
| auth | POST | /auth/otp/verify | any signed-in | otpVerify |
| auth | POST | /auth/owner/otp/request | any signed-in | ownerOtpRequest |
| auth | POST | /auth/owner/otp/verify | any signed-in | ownerOtpVerify |
| auth | POST | /auth/owner/phone/link/request | SALON_OWNER | ownerPhoneLinkRequest |
| auth | POST | /auth/owner/phone/link/verify | SALON_OWNER | ownerPhoneLinkVerify |
| auth | POST | /auth/customer/phone/link/request | CUSTOMER | customerPhoneLinkRequest |
| auth | POST | /auth/customer/phone/link/verify | CUSTOMER | customerPhoneLinkVerify |
| auth | POST | /auth/google | any signed-in | googleLogin |
| auth | POST | /auth/employee/login | any signed-in | employeeLogin |
| auth | POST | /auth/owner/signup | any signed-in | ownerSignup |
| auth | POST | /auth/staff/login | any signed-in | staffLogin |
| auth | POST | /auth/staff/google | any signed-in | staffGoogleLogin |
| auth | POST | /auth/admin/login | any signed-in | adminLogin |
| auth | POST | /auth/admin/google | any signed-in | adminGoogleLogin |
| auth | POST | /auth/refresh | any signed-in | refresh |
| auth | POST | /auth/logout | any signed-in | logout |
| auth | POST | /auth/logout-all | any signed-in | logoutAll |
| auth | GET | /auth/sessions | any signed-in | sessions |
| auth | DELETE | /auth/sessions/:id | any signed-in | revokeSession |
| auth | POST | /auth/forgot-password | any signed-in | forgotPassword |
| auth | POST | /auth/reset-password | any signed-in | resetPassword |
| auth | POST | /auth/password/initial | any signed-in | setInitialPassword |
| auth | DELETE | /auth/account | CUSTOMER | deleteAccount |
| auth | GET | /auth/me | any signed-in | me |
| auth | PATCH | /auth/language | any signed-in | setLanguage |
| bookings | GET | /salons/:salonId/booking/staff | any signed-in | listStaff |
| bookings | GET | /salons/:salonId/booking/availability | any signed-in | getAvailability |
| bookings | GET | /salons/:salonId/booking/cancellation-policy | any signed-in | getCancellationPolicy |
| bookings | GET | /salons/:salonId/booking/payment-info | any signed-in | getPaymentInfo |
| bookings | GET | /salons/:salonId/booking/recent-activity | any signed-in | getRecentActivity |
| bookings | POST | /bookings | CUSTOMER | create |
| bookings | GET | /bookings/mine | CUSTOMER | listMine |
| bookings | GET | /bookings/:id | CUSTOMER | getOne |
| bookings | POST | /bookings/:id/cancel | CUSTOMER | cancel |
| bookings | POST | /bookings/:id/reschedule | CUSTOMER | reschedule |
| credits | POST | /admin/credits/grant | PLATFORM_ADMIN | grant |
| credits | GET | /credits/balance | CUSTOMER | getBalance |
| credits | GET | /credits/history | CUSTOMER | getHistory |
| dashboard-analytics | GET | /dashboard/salons/:salonId/analytics | SALON_OWNER, PLATFORM_ADMIN | getAnalytics |
| dashboard-bookings | GET | /dashboard/salons/:salonId/bookings | SALON_OWNER, PLATFORM_ADMIN | list |
| dashboard-bookings | GET | /dashboard/salons/:salonId/bookings/:id | SALON_OWNER, PLATFORM_ADMIN | getOne |
| dashboard-customers | POST | /dashboard/salons/:salonId/customers/:customerId/ledger/:ledgerEntryId/cancellation-courtesy/waive`, | SALON_OWNER, PLATFORM_ADMIN | waive |
| dashboard-customers | POST | /dashboard/salons/:salonId/customers/:customerId/ledger/:ledgerEntryId/cancellation-courtesy/restore`, | SALON_OWNER, PLATFORM_ADMIN | restore |
| dashboard-customers | GET | /dashboard/salons/:salonId/customers/directory`, | SALON_OWNER, PLATFORM_ADMIN | directory |
| dashboard-customers | GET | /dashboard/salons/:salonId/customers | SALON_OWNER, PLATFORM_ADMIN | list |
| dashboard-customers | GET | /dashboard/salons/:salonId/customers/:customerId`, | SALON_OWNER, PLATFORM_ADMIN | getOne |
| dashboard-customers | GET | /dashboard/salons/:salonId/customers/:customerId/history`, | SALON_OWNER, PLATFORM_ADMIN | history |
| dashboard-customers | GET | /dashboard/salons/:salonId/customers/:customerId/services`, | SALON_OWNER, PLATFORM_ADMIN | services |
| dashboard-customers | POST | /dashboard/salons/:salonId/customers/:customerId/ledger/:ledgerEntryId/waive`, | SALON_OWNER, PLATFORM_ADMIN | waiveNoShowDue |
| dashboard-customers | POST | /dashboard/salons/:salonId/customers/:customerId/ledger/:ledgerEntryId/restore`, | SALON_OWNER, PLATFORM_ADMIN | restoreNoShowDue |
| dashboard-overview | GET | /dashboard/overview | SALON_OWNER | getOverview |
| dashboard-reviews | GET | /dashboard/salons/:salonId/reviews | SALON_OWNER, PLATFORM_ADMIN | list |
| dashboard-reviews | GET | /dashboard/salons/:salonId/review-profiles | SALON_OWNER, PLATFORM_ADMIN | getReviewProfiles |
| dashboard-reviews | PUT | /dashboard/salons/:salonId/review-profiles | SALON_OWNER, PLATFORM_ADMIN | updateReviewProfiles |
| dashboard-reviews | PUT | /dashboard/salons/:salonId/reviews/:reviewId/response`, | SALON_OWNER, PLATFORM_ADMIN | respond |
| employee | GET | /employee/me | FIELD_EXECUTIVE | me |
| employee | GET | /employee/dashboard | FIELD_EXECUTIVE | dashboard |
| employee | GET | /employee/leads | FIELD_EXECUTIVE | listLeads |
| employee | POST | /employee/leads | FIELD_EXECUTIVE | createLead |
| employee | PATCH | /employee/leads/:id | FIELD_EXECUTIVE | updateLead |
| employee | POST | /employee/leads/:id/onboard | FIELD_EXECUTIVE | onboardLead |
| employee | GET | /employee/visits | FIELD_EXECUTIVE | listVisits |
| employee | POST | /employee/visits | FIELD_EXECUTIVE | createVisit |
| employee | GET | /employee/follow-ups | FIELD_EXECUTIVE | listFollowUps |
| employee | POST | /employee/follow-ups | FIELD_EXECUTIVE | createFollowUp |
| employee | PATCH | /employee/follow-ups/:id | FIELD_EXECUTIVE | updateFollowUp |
| employee | GET | /employee/leads/:id/shop | FIELD_EXECUTIVE | leadShop |
| employee | GET | /employee/leads/:id/voice-visit-logs | FIELD_EXECUTIVE | listVoiceVisitLogs |
| employee | POST | /employee/leads/:id/voice-visit-logs | FIELD_EXECUTIVE | createVoiceVisitLog |
| employee | PATCH | /employee/leads/:leadId/voice-visit-logs/:id | FIELD_EXECUTIVE | updateVoiceVisitLog |
| health | GET | /{HEALTH_PATH} | any signed-in | check |
| inventory | GET | /dashboard/salons/:salonId/inventory/categories | SALON_OWNER, PLATFORM_ADMIN | listCategories |
| inventory | POST | /dashboard/salons/:salonId/inventory/categories | SALON_OWNER, PLATFORM_ADMIN | createCategory |
| inventory | GET | /dashboard/salons/:salonId/inventory/suppliers | SALON_OWNER, PLATFORM_ADMIN | listSuppliers |
| inventory | POST | /dashboard/salons/:salonId/inventory/suppliers | SALON_OWNER, PLATFORM_ADMIN | createSupplier |
| inventory | GET | /dashboard/salons/:salonId/inventory/products | SALON_OWNER, PLATFORM_ADMIN | listProducts |
| inventory | POST | /dashboard/salons/:salonId/inventory/products | SALON_OWNER, PLATFORM_ADMIN | createProduct |
| inventory | PATCH | /dashboard/salons/:salonId/inventory/products/:productId | SALON_OWNER, PLATFORM_ADMIN | updateProduct |
| inventory | POST | /dashboard/salons/:salonId/inventory/products/:productId/movements`, | SALON_OWNER, PLATFORM_ADMIN | createMovement |
| inventory | GET | /dashboard/salons/:salonId/inventory/movements | SALON_OWNER, PLATFORM_ADMIN | listMovements |
| inventory | GET | /dashboard/salons/:salonId/inventory/report | SALON_OWNER, PLATFORM_ADMIN | report |
| notifications | GET | /notifications/mine | any signed-in | listMine |
| notifications | GET | /notifications/mine/unread-count | any signed-in | unreadCount |
| notifications | POST | /notifications/:id/read | any signed-in | markRead |
| notifications | POST | /notifications/mine/read-all | any signed-in | markAllRead |
| notifications | GET | /notifications/preferences | any signed-in | getPreferences |
| notifications | PUT | /notifications/preferences | any signed-in | setPreference |
| offers | GET | /dashboard/salons/:salonId/offers | SALON_OWNER, PLATFORM_ADMIN | list |
| offers | GET | /dashboard/salons/:salonId/offers/:offerId | SALON_OWNER, PLATFORM_ADMIN | get |
| offers | POST | /dashboard/salons/:salonId/offers | SALON_OWNER, PLATFORM_ADMIN | create |
| offers | PATCH | /dashboard/salons/:salonId/offers/:offerId | SALON_OWNER, PLATFORM_ADMIN | update |
| offers | POST | /dashboard/salons/:salonId/offers/preview | SALON_OWNER, PLATFORM_ADMIN | previewDraft |
| offers | POST | /dashboard/salons/:salonId/offers/:offerId/preview | SALON_OWNER, PLATFORM_ADMIN | previewSaved |
| offers | POST | /dashboard/salons/:salonId/offers/:offerId/publish | SALON_OWNER, PLATFORM_ADMIN | publish |
| offers | POST | /dashboard/salons/:salonId/offers/:offerId/pause | SALON_OWNER, PLATFORM_ADMIN | pause |
| offers | GET | /dashboard/salons/:salonId/offers/:offerId/stats | SALON_OWNER, PLATFORM_ADMIN | stats |
| offers | GET | /dashboard/salons/:salonId/offers | PUBLIC | list |
| offers | GET | /dashboard/salons/:salonId/offers/:offerId | PUBLIC | get |
| owner-ops | GET | /dashboard/salons/:salonId/booking-attribution/summary | SALON_OWNER, PLATFORM_ADMIN | summarize |
| owner-ops | GET | /dashboard/salons/:salonId/booking-attribution/campaigns | SALON_OWNER, PLATFORM_ADMIN | listCampaigns |
| owner-ops | POST | /dashboard/salons/:salonId/booking-attribution/campaigns | SALON_OWNER, PLATFORM_ADMIN | createCampaign |
| owner-ops | POST | /dashboard/salons/:salonId/booking-attribution/campaigns/:campaignId/revoke | SALON_OWNER, PLATFORM_ADMIN | revokeCampaign |
| owner-ops | GET | /dashboard/salons/:salonId/capabilities | SALON_OWNER | getCapabilities |
| owner-ops | GET | /dashboard/salons/:salonId/demo/status | SALON_OWNER | status |
| owner-ops | POST | /dashboard/salons/:salonId/demo/import | SALON_OWNER | import |
| owner-ops | POST | /dashboard/salons/:salonId/demo/delete-preview | SALON_OWNER | deletePreview |
| owner-ops | GET | /dashboard/salons/:salonId/demo/workspaces/:workspaceId | SALON_OWNER | getWorkspace |
| owner-ops | DELETE | /dashboard/salons/:salonId/demo | SALON_OWNER | delete |
| owner-ops | GET | /dashboard/salons/:salonId/share-links | SALON_OWNER, PLATFORM_ADMIN | getSalonShareLinks |
| owner-ops | GET | /dashboard/salons/:salonId/overview | SALON_OWNER, PLATFORM_ADMIN | getOverview |
| owner-ops | GET | /dashboard/salons/:salonId/revenue | SALON_OWNER, PLATFORM_ADMIN | getRevenue |
| owner-ops | POST | /dashboard/salons/:salonId/assistant/query | SALON_OWNER, PLATFORM_ADMIN | queryOwnerInsights |
| owner-ops | GET | /dashboard/salons/:salonId/revenue/report | SALON_OWNER, PLATFORM_ADMIN | getRevenueReport |
| owner-ops | GET | /dashboard/salons/:salonId/revenue/report.csv | SALON_OWNER, PLATFORM_ADMIN | exportRevenueReport |
| owner-ops | GET | /dashboard/salons/:salonId/revenue/report.excel.xml | SALON_OWNER, PLATFORM_ADMIN | exportRevenueReportExcel |
| owner-ops | GET | /dashboard/salons/:salonId/search | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | searchDashboard |
| owner-ops | GET | /dashboard/salons/:salonId/analytics/cancellations | SALON_OWNER, PLATFORM_ADMIN | getCancellationAnalytics |
| owner-ops | POST | /dashboard/salons/:salonId/bookings/in-shop | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | createInShopBooking |
| owner-ops | POST | /dashboard/salons/:salonId/bookings/:bookingId/cancel | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | cancelBooking |
| owner-ops | POST | /dashboard/salons/:salonId/bookings/:bookingId/reschedule | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | rescheduleBooking |
| owner-ops | POST | /dashboard/salons/:salonId/queue/customers | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | addQueueCustomer |
| owner-ops | POST | /dashboard/salons/:salonId/queue/auto-assign | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | autoAssignAll |
| owner-ops | POST | /dashboard/salons/:salonId/queue/take-next | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | takeNext |
| owner-ops | GET | /dashboard/salons/:salonId/queue/settings | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | getQueueSettings |
| owner-ops | PATCH | /dashboard/salons/:salonId/queue/settings | SALON_OWNER, PLATFORM_ADMIN | setQueueSettings |
| owner-ops | POST | /dashboard/queue-entries/:entryId/auto-assign | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | autoAssignEntry |
| owner-ops | GET | /dashboard/salons/:salonId/staff/me/work | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | getMyWork |
| owner-ops | POST | /dashboard/salons/:salonId/staff/:staffId/access/revoke | SALON_OWNER, PLATFORM_ADMIN | revokeStaffAccess |
| owner-ops | POST | /dashboard/salons/:salonId/staff/:staffId/access/restore | SALON_OWNER, PLATFORM_ADMIN | restoreStaffAccess |
| owner-ops | PATCH | /dashboard/salons/:salonId/contact-visibility | SALON_OWNER, PLATFORM_ADMIN | setContactVisibility |
| owner-ops | GET | /dashboard/salons/:salonId/billing-profile | SALON_OWNER, PLATFORM_ADMIN | getBillingProfile |
| owner-ops | PUT | /dashboard/salons/:salonId/billing-profile | SALON_OWNER, PLATFORM_ADMIN | saveBillingProfile |
| owner-ops | POST | /dashboard/salons/:salonId/invoices | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | issueInvoice |
| owner-ops | GET | /dashboard/salons/:salonId/invoices | SALON_OWNER, PLATFORM_ADMIN | listInvoices |
| owner-ops | GET | /dashboard/salons/:salonId/payments | SALON_OWNER, PLATFORM_ADMIN | listPayments |
| owner-ops | GET | /dashboard/salons/:salonId/invoices/by-source | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | invoiceBySource |
| owner-ops | GET | /dashboard/salons/:salonId/invoices/:invoiceId | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | getInvoice |
| owner-ops | GET | /dashboard/salons/:salonId/invoices/:invoiceId/pdf | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | invoicePdf |
| owner-ops | POST | /dashboard/salons/:salonId/invoices/:invoiceId/payments | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | recordInvoicePayment |
| owner-ops | POST | /dashboard/salons/:salonId/invoices/:invoiceId/void | SALON_OWNER, PLATFORM_ADMIN | voidInvoice |
| owner-ops | GET | / | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | list |
| owner-ops | GET | /:invoiceId | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | get |
| owner-ops | GET | /:invoiceId/pdf | SALON_OWNER, SALON_STAFF, PLATFORM_ADMIN | pdf |
| premium | GET | /premium/plans | any signed-in | listPlans |
| premium | GET | /premium/me | any signed-in | me |
| premium | GET | /premium/credits | any signed-in | credits |
| premium | POST | /premium/dev/activate | any signed-in | devActivate |
| public-queue | GET | /public-queue/:token | any signed-in | getInfo |
| public-queue | POST | /public-queue/:token/join | any signed-in | join |
| public-queue | POST | /public-queue/:token/guest-join | any signed-in | guestJoin |
| public-queue | GET | /dashboard/salons/:salonId/queue-qr`, | any signed-in | getQueueQr |
| push-notifications | POST | /push-devices/register | any signed-in | register |
| push-notifications | POST | /push-devices/unregister | any signed-in | unregister |
| queue | POST | /bookings/:id/check-in | CUSTOMER | checkIn |
| queue | GET | /dashboard/salons/:salonId/queue | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | getQueue |
| queue | GET | /dashboard/salons/:salonId/queue/visits | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | getQueueVisits |
| queue | GET | /dashboard/salons/:salonId/arrival-alerts | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | getArrivalAlerts |
| queue | POST | /dashboard/bookings/:id/arrive | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | arrive |
| queue | POST | /dashboard/bookings/:id/no-show | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | bookingNoShow |
| queue | POST | /dashboard/bookings/:id/correct-no-show | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | correctNoShow |
| queue | POST | /dashboard/queue-entries/:id/call | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | call |
| queue | POST | /dashboard/queue-entries/:id/arrive | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | markArrived |
| queue | POST | /dashboard/queue-entries/:id/assign | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | assign |
| queue | POST | /dashboard/queue-entries/:id/start-service | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | startService |
| queue | PATCH | /dashboard/queue-entries/:id/reassign | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | reassign |
| queue | POST | /dashboard/queue-entries/:id/no-show | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | noShow |
| queue | POST | /dashboard/queue-entries/:id/cancel | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | cancel |
| queue | POST | /dashboard/service-sessions/:id/complete | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | complete |
| queue | PATCH | /dashboard/staff/:id/status | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | updateStaffStatus |
| queue | GET | /dashboard/salons/:salonId/staff/me`, | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | getMyStaffProfile |
| queue | GET | /dashboard/salons/:salonId/capacity | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | getCapacitySummary |
| queue | POST | /dashboard/salons/:salonId/chair-occupancy/:chairId/occupy-local | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | occupyLocal |
| queue | POST | /dashboard/salons/:salonId/chair-occupancy/:chairId/free-local | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | freeLocal |
| queue | POST | /dashboard/salons/:salonId/chair-occupancy/free-all-local | SALON_STAFF, SALON_OWNER, PLATFORM_ADMIN | freeAllLocal |
| queue | GET | /queue-entries/:id/shop-contact | CUSTOMER | getShopContact |
| queue | GET | /{QUEUE_ENTRIES_PATH}/mine/active | CUSTOMER | getMyActiveEntry |
| queue | POST | /{QUEUE_ENTRIES_PATH}/:id/arrival-response | CUSTOMER | reportArrival |
| queue | POST | /{QUEUE_ENTRIES_PATH}/:id/cancel | CUSTOMER | cancelMyEntry |
| queue | POST | /salons/:salonId/queue/guest-join | any signed-in | join |
| queue | GET | /queue-entries/:id/guest-status | any signed-in | getStatus |
| queue | POST | /queue-entries/:id/guest-cancel | any signed-in | cancel |
| queue | POST | /queue-entries/:id/guest-arrival-response | any signed-in | respondArrival |
| queue | POST | /queue-entries/:id/guest-device | any signed-in | registerGuestDevice |
| queue | GET | /queue-entries/:id/guest-shop-contact | any signed-in | getShopContact |
| queue | GET | /salons/:salonId/queue/status | any signed-in | getStatus |
| queue | POST | /salons/:salonId/queue/join | any signed-in | join |
| reviews | POST | /reviews | any signed-in | create |
| reviews | PATCH | /reviews/:id | any signed-in | update |
| reviews | GET | /reviews/booking/:bookingId | any signed-in | getForBooking |
| salon-description | POST | /dashboard/salons/:salonId/description/suggestions | SALON_OWNER | suggest |
| salon-setup | POST | /dashboard/salons/:salonId/contacts/consents`, | SALON_OWNER | record |
| salon-setup | GET | /dashboard/salons/:salonId/contacts/consents`,/summary | SALON_OWNER | summary |
| salon-setup | POST | /dashboard/salons/:salonId/contacts/consents`,/withdraw | SALON_OWNER | withdraw |
| salon-setup | POST | /dashboard/salons/:salonId/contacts/consents`,/erase | SALON_OWNER | erase |
| salon-setup | POST | /dashboard/salons/:salonId/contacts/consents`,/purge-expired | SALON_OWNER | purgeExpired |
| salon-setup | POST | /dashboard/salons/:salonId/contacts`,/preview | SALON_OWNER | preview |
| salon-setup | GET | /dashboard/salons/:salonId/profile | SALON_OWNER, PLATFORM_ADMIN | getProfile |
| salon-setup | PATCH | /dashboard/salons/:salonId/profile | SALON_OWNER, PLATFORM_ADMIN | updateProfile |
| salon-setup | GET | /dashboard/salons/:salonId/location | SALON_OWNER, PLATFORM_ADMIN | getLocation |
| salon-setup | PATCH | /dashboard/salons/:salonId/location | SALON_OWNER, PLATFORM_ADMIN | proposeLocation |
| salon-setup | PATCH | /dashboard/salons/:salonId/status | SALON_OWNER, PLATFORM_ADMIN | updateStatus |
| salon-setup | GET | /dashboard/salons/:salonId/timezone | SALON_OWNER, PLATFORM_ADMIN | getTimezone |
| salon-setup | GET | /dashboard/salons/:salonId/photo-readiness | SALON_OWNER, PLATFORM_ADMIN | getPhotoReadiness |
| salon-setup | PATCH | /dashboard/salons/:salonId/timezone | SALON_OWNER, PLATFORM_ADMIN | updateTimezone |
| salon-setup | GET | /dashboard/salons/:salonId/payment-qr | SALON_OWNER, PLATFORM_ADMIN | getPaymentQr |
| salon-setup | PUT | /dashboard/salons/:salonId/payment-qr | SALON_OWNER, PLATFORM_ADMIN | setPaymentQr |
| salon-setup | PATCH | /dashboard/salons/:salonId/payment-qr | SALON_OWNER, PLATFORM_ADMIN | setUpiRouting |
| salon-setup | POST | /dashboard/salons/:salonId/payment-qr/upload`, | SALON_OWNER, PLATFORM_ADMIN | s |
| salon-setup | DELETE | /dashboard/salons/:salonId/payment-qr | SALON_OWNER, PLATFORM_ADMIN | removePaymentQr |
| salon-setup | GET | /dashboard/salons/:salonId/operating-hours | SALON_OWNER, PLATFORM_ADMIN | listOperatingHours |
| salon-setup | PUT | /dashboard/salons/:salonId/operating-hours | SALON_OWNER, PLATFORM_ADMIN | setOperatingHours |
| salon-setup | GET | /dashboard/salons/:salonId/services/salon-type`, | SALON_OWNER, PLATFORM_ADMIN | getSalonType |
| salon-setup | PATCH | /dashboard/salons/:salonId/services/salon-type`, | SALON_OWNER, PLATFORM_ADMIN | updateSalonType |
| salon-setup | GET | /dashboard/salons/:salonId/services | SALON_OWNER, PLATFORM_ADMIN | listServices |
| salon-setup | GET | /dashboard/salons/:salonId/service-categories | SALON_OWNER, PLATFORM_ADMIN | listServiceCategories |
| salon-setup | POST | /dashboard/salons/:salonId/service-categories | SALON_OWNER, PLATFORM_ADMIN | createServiceCategory |
| salon-setup | PATCH | /dashboard/salons/:salonId/service-categories/:categoryId | SALON_OWNER, PLATFORM_ADMIN | renameServiceCategory |
| salon-setup | DELETE | /dashboard/salons/:salonId/service-categories/:categoryId | SALON_OWNER, PLATFORM_ADMIN | deleteServiceCategory |
| salon-setup | POST | /dashboard/salons/:salonId/service-categories/:categoryId/subcategories | SALON_OWNER, PLATFORM_ADMIN | createServiceSubcategory |
| salon-setup | PATCH | /dashboard/salons/:salonId/service-categories/:categoryId/subcategories/:subcategoryId | SALON_OWNER, PLATFORM_ADMIN | renameServiceSubcategory |
| salon-setup | DELETE | /dashboard/salons/:salonId/service-categories/:categoryId/subcategories/:subcategoryId | SALON_OWNER, PLATFORM_ADMIN | deleteServiceSubcategory |
| salon-setup | GET | /dashboard/salons/:salonId/services/import-capabilities | SALON_OWNER, PLATFORM_ADMIN | catalogImportCapabilities |
| salon-setup | POST | /dashboard/salons/:salonId/services/import-preview | SALON_OWNER, PLATFORM_ADMIN | s |
| salon-setup | POST | /dashboard/salons/:salonId/services/import-reviewed | SALON_OWNER, PLATFORM_ADMIN | saveReviewedCatalog |
| salon-setup | POST | /dashboard/salons/:salonId/services/delete-all | SALON_OWNER, PLATFORM_ADMIN | deleteAllServices |
| salon-setup | POST | /dashboard/salons/:salonId/services/remove-all | SALON_OWNER, PLATFORM_ADMIN | removeAllServices |
| salon-setup | POST | /dashboard/salons/:salonId/services | SALON_OWNER, PLATFORM_ADMIN | createService |
| salon-setup | PATCH | /dashboard/salons/:salonId/services/:serviceId | SALON_OWNER, PLATFORM_ADMIN | updateService |
| salon-setup | GET | /dashboard/salons/:salonId/photos | SALON_OWNER, PLATFORM_ADMIN | listPhotos |
| salon-setup | POST | /dashboard/salons/:salonId/photos | SALON_OWNER, PLATFORM_ADMIN | createPhoto |
| salon-setup | POST | /dashboard/salons/:salonId/photos/upload`, | SALON_OWNER, PLATFORM_ADMIN | s |
| salon-setup | DELETE | /dashboard/salons/:salonId/photos/:photoId | SALON_OWNER, PLATFORM_ADMIN | removePhoto |
| salon-setup | GET | /dashboard/salons/:salonId/chairs | SALON_OWNER, PLATFORM_ADMIN | listChairs |
| salon-setup | POST | /dashboard/salons/:salonId/chairs | SALON_OWNER, PLATFORM_ADMIN | createChair |
| salon-setup | PATCH | /dashboard/salons/:salonId/chairs/:chairId | SALON_OWNER, PLATFORM_ADMIN | updateChair |
| salon-setup | POST | /dashboard/salons/:salonId/chairs/bulk-deactivate/preview | SALON_OWNER, PLATFORM_ADMIN | previewBulkDeactivateChairs |
| salon-setup | POST | /dashboard/salons/:salonId/chairs/bulk-deactivate/apply | SALON_OWNER, PLATFORM_ADMIN | bulkDeactivateChairs |
| salon-setup | GET | /dashboard/salons/:salonId/staff | SALON_OWNER, PLATFORM_ADMIN | listStaff |
| salon-setup | POST | /dashboard/salons/:salonId/staff | SALON_OWNER, PLATFORM_ADMIN | createStaff |
| salon-setup | PATCH | /dashboard/salons/:salonId/staff/:staffId | SALON_OWNER, PLATFORM_ADMIN | updateStaff |
| salon-setup | POST | /dashboard/salons/:salonId/staff/:staffId/resend-invite`, | SALON_OWNER, PLATFORM_ADMIN | resendInvite |
| salon-setup | GET | /dashboard/salons/:salonId/staff/:staffId/working-hours`, | SALON_OWNER, PLATFORM_ADMIN | listStaffWorkingHours |
| salon-setup | PUT | /dashboard/salons/:salonId/staff/:staffId/working-hours`, | SALON_OWNER, PLATFORM_ADMIN | setStaffWorkingHours |
| salons | GET | /cities | any signed-in | listCities |
| salons | GET | /cities/all | any signed-in | listAllCities |
| salons | GET | /cities/search | any signed-in | searchCities |
| salons | GET | /cities/:countryCode/:citySlug | any signed-in | getCity |
| salons | GET | /cities/:countryCode/:citySlug/localities | any signed-in | listLocalities |
| salons | GET | /cities/:countryCode/:citySlug/localities/:localitySlug | any signed-in | getLocality |
| salons | GET | /countries | any signed-in | listCountries |
| salons | GET | /countries/:countryId/regions | any signed-in | listRegions |
| salons | POST | /assistant/search | any signed-in | search |
| salons | GET | /favorites | CUSTOMER | list |
| salons | GET | /favorites/ids | CUSTOMER | ids |
| salons | POST | /favorites/:salonId | CUSTOMER | add |
| salons | DELETE | /favorites/:salonId | CUSTOMER | remove |
| salons | GET | /salons | any signed-in | search |
| salons | POST | /salons | any signed-in | register |
| salons | GET | /salons/mine | any signed-in | listMine |
| salons | GET | /salons/workplaces | any signed-in | listWorkplaces |
| salons | GET | /salons/mine/:salonId | any signed-in | getMine |
| salons | GET | /salons/live-stats | any signed-in | getLiveStats |
| salons | GET | /salons/service-suggestions | any signed-in | getServiceSuggestions |
| salons | GET | /salons/:countryCode/:citySlug/:salonSlug/status | any signed-in | getPublicStatus |
| salons | GET | /salons/:countryCode/:citySlug/:salonSlug | any signed-in | getProfile |
| site-metrics | POST | /site-metrics/visit | any signed-in | recordVisit |
| style-advisor | POST | /style-advisor/generate | CUSTOMER | s |
| verification | GET | /dashboard/salons/:salonId/verification | SALON_OWNER, PLATFORM_ADMIN | getForSalon |
| verification | POST | /dashboard/salons/:salonId/verification | SALON_OWNER, PLATFORM_ADMIN | submitForSalon |
| verification | GET | /dashboard/salons/:salonId/staff/:staffId/verification`, | SALON_OWNER, PLATFORM_ADMIN | getForStaff |
| verification | POST | /dashboard/salons/:salonId/staff/:staffId/verification`, | SALON_OWNER, PLATFORM_ADMIN | submitForStaff |
