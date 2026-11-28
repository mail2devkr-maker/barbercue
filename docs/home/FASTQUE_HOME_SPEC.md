open a new branch and build this new functionality--make sure nothin is broken and put a link of this plateform inside admin login. 

FASTQUE HOME – INTELLIGENT ON-DEMAND HOME BEAUTY AND SALON SERVICES MARKETPLACE
1. ROLE AND VISION
Act as a world-class senior full-stack software architect, marketplace product manager, UI/UX engineer, geospatial engineer, dispatch optimization expert, AI engineer, database architect, cybersecurity engineer and home-services operations expert.
Develop a complete new business vertical within the existing FastQue application called:
FastQue Home – Your Favourite Salon, At Your Doorstep.
Build an end-to-end home-services marketplace inspired by successful businesses such as Urban Company, Yes Madam, Billu Barber and other leading on-demand service platforms.
Study their publicly available functionality for inspiration without copying proprietary code, branding, content or protected designs.
FastQue Home must support two independent service provider models:

1. Salon partners offering home services through their own authorized staff.
2. Independent freelance beauty professionals offering home services directly.

Customers must be able to discover nearby service providers, compare prices, select their preferred salon or individual professional, view estimated arrival times, book immediately or schedule a future appointment, track the professional, receive services at home, pay offline and provide feedback.
Build actual working frontend, backend, database, scheduling, dispatch, tracking, operational and administrative infrastructure.
Do not stop after creating mockups or prototypes.
Exclude online payment gateway integration from this development phase.
2. NON-NEGOTIABLE: PROTECT ALL EXISTING FASTQUE FEATURES
FastQue is an existing application. Preserving existing functionality is more important than implementing any individual new feature.
Before modifying code:

* Inspect the complete repository.
* Understand the existing frontend, backend, database, APIs and authentication.
* Inspect salon, staff, service, customer and appointment entities.
* Inspect live queue management.
* Inspect scheduled booking logic.
* Inspect FastQue Talent, if implemented.
* Inspect direct commerce and marketplace functionality.
* Inspect CRM, notifications, inventory and expense management.
* Identify reusable components and infrastructure.
* Review existing uncommitted changes.
* Preserve work performed by other developers.
* Establish a baseline Git commit.
* Run existing automated tests.
* Document pre-existing failures.
* Create a dedicated feature branch named `feature/fastque-home-services`, unless already present.

Do not:

* Rewrite the application.
* Replace the existing technology stack.
* Introduce duplicate authentication systems.
* Delete or reset existing databases.
* Remove existing routes.
* Introduce incompatible API changes.
* Globally change existing design styles.
* Modify unrelated modules unnecessarily.
* Deploy to production without approval.

Protect all existing functionality, including:

* Live salon queues.
* Scheduled salon appointments.
* Customer bookings.
* Walk-in customers.
* QR check-in.
* Salon discovery.
* Salon onboarding.
* Staff management.
* CRM.
* Field sales portal.
* Inventory.
* Barcode scanning.
* Common product database.
* Product marketplace.
* FastQue direct commerce.
* FastQue Talent.
* Permanent recruitment.
* Instant staffing.
* Expense management.
* Existing dashboards and analytics.

Verify which modules actually exist. Do not create unrelated missing modules as part of this task.
Use additive, backward-compatible database migrations.
Feature flags
Introduce independent feature flags using existing configuration conventions:

* `FASTQUE_HOME_ENABLED`
* `SALON_HOME_SERVICES_ENABLED`
* `FREELANCER_HOME_SERVICES_ENABLED`
* `HOME_INSTANT_BOOKING_ENABLED`
* `HOME_SCHEDULED_BOOKING_ENABLED`
* `HOME_LIVE_TRACKING_ENABLED`
* `HOME_AI_DISPATCH_ENABLED`
* `HOME_MEMBERSHIPS_ENABLED`
* `HOME_MONETIZATION_ENABLED`

When new features are disabled, the existing FastQue application must retain its established behavior.
Disabling new bookings must not prevent existing bookings from being completed, cancelled or resolved.
3. SERVICE PROVIDER ARCHITECTURE
Create a unified home-service provider architecture supporting:

* `SALON_MANAGED`
* `INDEPENDENT_PROFESSIONAL`

Prepare for future:

* Beauty agencies.
* Franchise networks.
* Mobile salon businesses.
* Specialized beauty service companies.

Salon-managed professionals
Existing salon owners should be able to enable home services from their dashboard.
The salon remains responsible for:

* Service listings.
* Pricing.
* Staff assignment.
* Service quality.
* Products and equipment.
* Professional availability.
* Booking fulfillment.
* Payment collection.
* Customer complaints.

Customers must clearly see the salon name and the individual professional assigned.
Independent professionals
Independent barbers, hairstylists, beauticians and makeup artists should be able to register without owning or working for a salon.
Independent professionals manage:

* Their professional profile.
* Services.
* Pricing.
* Service locations.
* Availability.
* Bookings.
* Travel preferences.
* Equipment and products.
* Customer reviews.
* Earnings.

Reuse FastQue Talent professional profiles where available.
Do not require professionals to create duplicate accounts.
Maintain separate professional capabilities and permissions for:

* Employment search.
* Temporary salon assignments.
* Salon-managed home services.
* Independent home services.

A professional must explicitly consent before being enrolled into any additional service channel.
4. FASTQUE HOME CUSTOMER LANDING PAGE
Create a dedicated customer-facing home-services page using appropriate routes such as:

* `/home-services`
* `/home-services/categories`
* `/home-services/search`
* `/home-services/professionals`
* `/home-services/booking`
* `/home-services/tracking`

Follow existing repository conventions.
Add a prominent option on the existing FastQue landing page:
At Salon | At Home
Do not remove existing salon booking functionality.
Create a premium, modern, Gen Z-friendly, mobile-first experience.
Maintain existing FastQue colors, typography, logos and design tokens.
The home-services landing page should contain:

* Customer location selector.
* Saved addresses.
* Service search.
* Instant booking.
* Scheduled booking.
* Popular services.
* Men's grooming.
* Women's beauty.
* Kids' grooming.
* Family packages.
* Bridal services.
* Premium services.
* Affordable services.
* Nearby salons offering home services.
* Available independent professionals.
* Recently booked professionals.
* Favourite professionals.
* Recommended services.
* Seasonal offers.
* Service packages.
* Memberships.
* Trust and safety information.

Display actual database content rather than hardcoded fake providers or prices.
5. COMPLETE HOME-SERVICE CATALOG
Create a centralized, extensible service taxonomy.
Men's grooming

* Haircut.
* Beard trimming.
* Shaving.
* Hair styling.
* Hair coloring.
* Hair wash.
* Head massage.
* Facial.
* Cleanup.
* Manicure.
* Pedicure.
* Grooming packages.

Women's beauty services

* Haircut.
* Hair styling.
* Hair wash and blow-dry.
* Hair coloring.
* Root touch-up.
* Hair spa.
* Facials.
* Cleanup.
* Threading.
* Waxing.
* Manicure.
* Pedicure.
* Nail art.
* Saree draping.
* Party makeup.
* Bridal makeup.
* Pre-bridal packages.

Kids and family services

* Kids' haircuts.
* Family grooming packages.
* Senior citizen grooming.
* Multiple-person bookings.

Additional configurable categories

* Spa and massage services.
* Wedding services.
* Event grooming.
* Corporate grooming.
* Society grooming camps.
* Specialized beauty treatments.

Only enable categories that meet FastQue's professional qualification, safety and operational requirements.
Do not enable invasive or medical cosmetic procedures through ordinary beauty-professional accounts.
Service attributes
Each service should support:

* Service ID.
* Service name.
* Category.
* Subcategory.
* Description.
* Images.
* Standard duration.
* Preparation duration.
* Cleanup duration.
* Required skills.
* Required equipment.
* Product requirements.
* Customer preparation instructions.
* Eligibility requirements.
* Safety instructions.
* Add-on services.
* Service variants.
* Cancellation policy.
* Pricing model.
* Service status.

Reuse the existing salon service database and synonym architecture where appropriate.
Create provider-specific home-service offers without modifying existing in-salon service prices.
6. SALON OWNER – HOME SERVICES DASHBOARD
Add a new tab to the existing salon owner dashboard:
Home Services
Create sub-tabs:

* Overview.
* My Home Services.
* Service Pricing.
* Professional Assignment.
* Availability.
* Service Areas.
* Incoming Bookings.
* Upcoming Bookings.
* Active Services.
* Completed Services.
* Cancellations.
* Customer Reviews.
* Earnings.
* Settlement Records.
* Promotions.
* Settings.

Enable home services
Provide an onboarding wizard allowing salon owners to:

1. Enable the home-service feature.
2. Accept applicable provider terms.
3. Select service categories.
4. Assign eligible professionals.
5. Define prices.
6. Configure service areas.
7. Set travel rules.
8. Define operating hours.
9. Configure booking acceptance.
10. Submit for verification or approval.

Home-service listing creation
Allow salon owners to:

* Select existing salon services.
* Add home-service-specific offerings.
* Define home-service price.
* Define service duration.
* Define travel fee.
* Define minimum order amount.
* Define required products.
* Define available staff.
* Define availability.
* Enable or disable individual services.

Example:
In-salon haircut: ₹200.
Home haircut: ₹299.
Home haircut and beard package: ₹399.
Do not modify in-salon prices when home-service prices are edited.
7. FREELANCER REGISTRATION
Create an independent professional onboarding workflow.
Reuse existing FastQue Talent profiles where possible.
Support professionals such as:

* Barbers.
* Hair stylists.
* Beauticians.
* Makeup artists.
* Bridal makeup artists.
* Nail technicians.
* Spa professionals.
* Hair color specialists.
* Freelance beauty professionals.

Registration fields

* Full name.
* Profile photograph.
* Mobile number.
* Email.
* Current city.
* Operating locality.
* Professional category.
* Skills.
* Years of experience.
* Languages.
* Portfolio photographs.
* Portfolio videos.
* Training certificates.
* Service qualifications.
* Available service categories.
* Service prices.
* Travel radius.
* Available days.
* Available working hours.
* Travel mode.
* Equipment availability.
* Products carried.
* Emergency contact.
* Relevant verification information.

Provide Hindi and English registration.
Support optional voice-assisted onboarding using existing configured AI or speech recognition infrastructure.
Allow field executives to assist professionals with registration after obtaining consent.
Do not create publicly visible professional profiles without the person's consent.
Do not require Aadhaar by default.
Collect only verification information that is necessary and lawfully permitted.
8. PROFESSIONAL PROFILE AND DISCOVERY
Create detailed customer-facing professional profiles.
Include:

* Professional name.
* Profile photograph.
* Provider type.
* Associated salon, if applicable.
* Experience.
* Skills.
* Portfolio.
* Available services.
* Pricing.
* Verified qualifications.
* Completed services.
* Customer ratings.
* Genuine reviews.
* Service coverage.
* Available appointment slots.
* Estimated arrival time.
* Languages.
* Favourite or rebook option.

Clearly label:
Salon Professional – Associated with [Salon Name]
or
Independent FastQue Professional
Do not display private addresses, verification documents or unnecessary personal contact details.
Allow customers to:

* Book a specific professional.
* Select a preferred salon.
* Request any available professional.
* Save a favourite professional.
* Rebook a previously used professional.
* Compare multiple professionals.

Where a specific professional is selected, do not silently assign a different individual.
Any replacement must be communicated to the customer and approved where required.
9. LOCATION AND ADDRESS MANAGEMENT
Create a complete location-aware service infrastructure.
Customer address fields:

* House or flat number.
* Building or society.
* Street.
* Locality.
* Landmark.
* City.
* State.
* PIN code.
* Latitude and longitude, where provided.
* Address type.
* Access instructions.
* Customer contact details.

Support:

* Current location with permission.
* Manual address selection.
* Map pin selection.
* Saved addresses.
* Multiple addresses.
* Home.
* Work.
* Other addresses.
* Apartment and society search where available.

Use existing map and location providers where possible.
Create a provider-independent mapping adapter.
Potential configurable integrations:

* Google Maps Platform.
* Mapbox.
* HERE.
* OpenStreetMap-based geocoding and routing services.
* Self-hosted routing infrastructure where feasible.

Do not activate paid services without approval.
Respect provider usage limits, licenses and production-use requirements.
Provide manual location entry and conservative serviceability fallback when mapping services are unavailable.
Do not present straight-line distance as actual road distance.
10. SERVICE AREA AND GEOSPATIAL SEARCH
Allow every salon and independent professional to configure service coverage.
Support:

* Service radius in kilometers.
* Selected PIN codes.
* Selected localities.
* Selected residential societies.
* Selected cities.
* Polygon-based coverage areas where supported.
* Maximum travel time.
* Minimum booking value by area.
* Travel surcharge by distance.
* Restricted service areas.
* Service-specific coverage.

Use geographic indexing appropriate to the existing database architecture.
If PostgreSQL is used, evaluate PostGIS or compatible geospatial functionality without introducing unnecessary infrastructure.
Search for providers based on:

* Customer location.
* Service area.
* Required skills.
* Service eligibility.
* Available appointment time.
* Price.
* Provider preferences.
* Equipment availability.
* Travel feasibility.

Do not show providers as bookable solely because their registered salon is geographically nearby.
A provider must be eligible, available and able to reach the customer.
11. UNIFIED PROFESSIONAL AVAILABILITY ENGINE
This is a critical architecture requirement.
A professional may have multiple types of commitments:

* In-salon scheduled appointment.
* Active salon queue customer.
* Upcoming salon queue assignment.
* Home-service appointment.
* FastQue Talent temporary staffing assignment.
* Travel time.
* Preparation time.
* Break.
* Personal unavailability.
* Salon opening hours.
* Independent professional working hours.

Create a unified availability service or compatibility layer that considers all relevant commitments.
Do not duplicate or replace existing scheduling logic unnecessarily.
Availability rules
A professional must not:

* Be double-booked.
* Receive overlapping salon and home appointments.
* Accept overlapping temporary staffing assignments.
* Be assigned to a home service while already serving a salon customer.
* Be scheduled without sufficient travel time.
* Be assigned outside working hours without approval.
* Be scheduled without required preparation and cleanup time.

Support:

* Recurring working schedules.
* Custom schedules.
* Holidays.
* Breaks.
* Time-off requests.
* Available now.
* Unavailable.
* Scheduled availability.
* Service-specific availability.
* Travel commitments.
* Maximum daily appointments.

Use database-level concurrency protection and transactional booking holds.
If legacy scheduling systems do not share a common reservation mechanism, implement a safe integration layer before enabling cross-channel bookings.
Do not claim double-booking protection unless it works across all connected booking channels.
12. SALON CAPACITY PROTECTION
Home services must not negatively affect a salon's in-store business.
Provide configurable rules allowing salon owners to define:

* Minimum number of professionals remaining in the salon.
* Maximum staff available for home visits.
* Dedicated home-service staff.
* Shared salon and home-service staff.
* Maximum simultaneous home bookings.
* Maximum travel distance.
* Minimum booking value.
* Peak-hour restrictions.
* Weekend restrictions.
* Manual approval requirements.

Example:
A salon has 5 barbers.
The owner requires at least 3 barbers to remain in the salon.
FastQue must not dispatch more than 2 barbers for simultaneous home appointments.
If the salon is experiencing high queue demand, prevent automatic dispatch when it would violate the owner's configured staffing rules.
Allow the system to recommend changes, but do not silently alter established salon staffing policies.
13. INTELLIGENT ETA CALCULATION ENGINE
Develop an accurate estimated-time-of-arrival engine.
ETA must consider:

1. Professional's earliest actual availability.
2. Remaining duration of the current service.
3. Preparation time.
4. Professional's current or expected departure location.
5. Road travel distance.
6. Estimated road travel time.
7. Traffic conditions, where available.
8. Travel mode.
9. Parking time.
10. Building or apartment access.
11. Uncertainty buffer.
12. Existing future appointments.

For immediate bookings, calculate:
Earliest departure = maximum of current time and confirmed professional availability, plus required preparation time.
Estimated arrival = earliest departure + road travel duration + access and uncertainty buffers.
Estimated completion = estimated arrival + requested service duration + applicable cleanup time.
Avoid double-counting preparation or travel time when already included in scheduled commitments.
Example
Current appointment remaining: 15 minutes.
Preparation time: 5 minutes.
Estimated road travel: 12 minutes.
Traffic and access buffer: 5 minutes.
Estimated arrival: 37 minutes from now.
Requested service duration: 30 minutes.
Estimated completion: 67 minutes from now, excluding any additional cleanup.
Display customer-friendly arrival windows rather than unjustified exact promises.
Example:
Estimated arrival: 35–45 minutes
ETA confidence
Maintain ETA confidence indicators based on:

* Freshness of professional availability.
* Last known location.
* Routing provider availability.
* Traffic information.
* Service-duration accuracy.
* Historical travel performance.

If reliable travel information is unavailable:

* Display an approximate arrival estimate.
* Clearly indicate that it is estimated.
* Use conservative buffers.
* Avoid false real-time tracking claims.

Recalculate ETA when:

* Professional accepts booking.
* Previous appointment is delayed.
* Professional begins travel.
* Traffic changes where available.
* Professional location changes materially.
* Customer address changes.
* An operational delay is reported.

Notify affected customers when ETA changes significantly.
14. INSTANT BOOKING
Provide a prominent option:
Book Now
Support immediate bookings for eligible services and providers.
Customer workflow:

1. Select home-service address.
2. Select service.
3. Choose salon or independent professional.
4. View estimated arrival time.
5. Review total price.
6. Confirm booking request.
7. Receive professional acceptance.
8. Track professional arrival.
9. Receive service.
10. Pay offline.
11. Confirm completion.
12. Submit review.

Allow three booking preferences:
Select a specific professional
Booking is offered only to the selected professional.
Select a specific salon
Salon assigns an eligible authorized professional.
Fastest available professional
FastQue searches eligible participating providers according to availability, ETA, skills and customer preferences.
Do not represent an unaccepted request as a confirmed booking.
Do not promise a fixed 15-minute or 30-minute arrival unless the actual scheduling and operational evidence supports it.
15. SCHEDULED HOME SERVICES
Allow customers to select a future appointment.
Support:

* Today.
* Tomorrow.
* Specific date.
* Specific time.
* Morning.
* Afternoon.
* Evening.
* Weekend.
* Multiple services.
* Multiple family members.
* Recurring bookings.

Generate available appointment slots dynamically.
Do not hardcode slots that are not actually available.
Consider travel from the previous appointment and travel to the next appointment.
A scheduled appointment is valid only if:

* The professional can finish previous commitments.
* Required travel is feasible.
* Requested service duration fits.
* Necessary equipment is available.
* Future confirmed appointments are not disrupted.
* Salon staffing constraints are satisfied.

Use temporary booking holds during checkout.
Release expired holds automatically.
Store timestamps consistently and display them in the relevant local timezone.
Use India Standard Time for India-facing appointments.
16. INTELLIGENT PROFESSIONAL MATCHING
Create a matching engine that ranks eligible professionals using relevant factors.
Mandatory eligibility checks:

* Required skill.
* Required verification status.
* Active account.
* Service area.
* Current or scheduled availability.
* Price eligibility.
* Required equipment.
* Customer-requested professional preferences.
* No overlapping commitments.
* Salon capacity rules.

Ranking factors may include:

* Estimated arrival time.
* Service price.
* Rating.
* Relevant service experience.
* Completion reliability.
* Customer's favourite professional.
* Previous positive service history.
* Travel efficiency.
* Professional's workload and preferences.

Create explainable matching results.
Examples:

* Fastest available.
* Previously booked.
* Lowest total price.
* Highly rated.
* Closest eligible professional.

Do not use sensitive personal characteristics as hidden ranking factors.
Support reasonable customer privacy and comfort preferences only where appropriate and lawfully permitted.
Make sponsored listings clearly identifiable.
Do not rank paid listings ahead of mandatory safety or eligibility requirements.
17. PROFESSIONAL DISPATCH AND ACCEPTANCE
Build a configurable dispatch engine.
Support:

* Direct assignment by salon owner.
* Professional-specific booking request.
* Automatic recommendation.
* Automatic invitation to eligible professionals.
* Sequential dispatch.
* Limited parallel dispatch.
* Manual dispatcher assignment.

Dispatch workflow
Booking requested → Eligible professionals identified → Invitation sent → Professional accepts → Assignment confirmed.
If a professional rejects or fails to respond:

* Expire the invitation.
* Search other eligible professionals if the customer permits.
* Notify the customer when delays occur.
* Offer rescheduling or cancellation.

Do not create duplicate confirmed assignments.
Use atomic assignment acceptance.
When multiple professionals receive invitations, only the eligible accepted assignment selected by the system should be finalized.
Other invitations must expire or be withdrawn.
Support configurable acceptance windows.
Do not pressure independent professionals to accept assignments or penalize reasonable refusals.
18. LIVE PROFESSIONAL TRACKING
Create a customer-facing tracking page.
Display:

* Professional assigned.
* Professional photograph.
* Provider name.
* Current booking status.
* Estimated arrival window.
* Last updated time.
* Route progress, when supported.
* Contact professional.
* Contact support.
* Share booking details.
* Reschedule or cancel, if eligible.

Professional location tracking must:

* Require informed permission.
* Operate only for the relevant active booking.
* Be restricted to authorized viewers.
* Stop after completion or cancellation.
* Clearly indicate when tracking is unavailable.
* Apply appropriate data retention limits.

Do not continuously track freelancers outside active service assignments.
Do not expose another customer's address or previous appointment location.
Provide a status-only tracking fallback if the professional denies location permission or browser background tracking is unavailable.
Do not claim real-time background GPS tracking works if the existing web application cannot reliably provide it.
Prepare the architecture for a future native mobile professional application where necessary.
19. COMPLETE BOOKING LIFECYCLE
Implement a controlled server-side booking state machine.
Standard statuses:

* Draft.
* Booking requested.
* Awaiting assignment.
* Professional invited.
* Professional accepted.
* Confirmed.
* Preparation started.
* On the way.
* Arrived.
* Service check-in completed.
* Service in progress.
* Service completed.
* Payment pending.
* Payment confirmed.
* Closed.

Exception statuses:

* Assignment rejected.
* No professional available.
* Booking expired.
* Reschedule requested.
* Cancelled by customer.
* Cancelled by professional.
* Cancelled by salon.
* Customer no-show.
* Professional no-show.
* Address issue.
* Service interrupted.
* Replacement requested.
* Complaint raised.
* Dispute under review.
* Dispute resolved.

Maintain independent state for:

* Booking.
* Assignment.
* Travel.
* Service completion.
* Payment.
* Complaint.
* Refund or service credit.

Do not treat service completion as payment confirmation.
Maintain full timestamped booking history.
20. SERVICE START AND COMPLETION VERIFICATION
Reuse existing FastQue QR infrastructure only where safe.
Create independent home-service verification.
Support:

* Customer start OTP.
* Booking-specific QR code.
* Professional arrival confirmation.
* Service start timestamp.
* Service completion confirmation.
* Customer completion OTP where appropriate.
* Service end timestamp.
* Actual duration.
* Additional services.
* Customer-approved price adjustments.

OTP or QR codes must:

* Be scoped to the specific booking.
* Expire.
* Be protected from reuse.
* Be rate-limited.
* Not expose customer credentials.

Provide audited administrative exception handling if verification fails.
Do not prevent a professional or customer from reporting an emergency due to missing OTP confirmation.
21. ADVANCED HOME-SERVICE PRICING
Create flexible provider-specific pricing.
Support:

* Fixed service price.
* Service variant pricing.
* Professional experience-based pricing.
* Salon-specific pricing.
* Independent professional pricing.
* Premium professional pricing.
* Distance-based travel charge.
* Minimum booking value.
* Group-service discount.
* Family package.
* Weekend surcharge.
* Peak-time surcharge.
* Product charge.
* Equipment charge.
* Platform service fee.
* Applicable taxes.
* Promotional discount.

Display all mandatory charges before booking confirmation.
Example:
Haircut: ₹299.
Beard trimming: ₹99.
Travel charge: ₹49.
Discount: ₹50.
Final payable: ₹397.
Do not introduce hidden fees after booking confirmation.
Any additional service or additional charge must require explicit customer approval.
Store a historical pricing snapshot with each booking.
Allow pricing changes to affect only future bookings.
Support authorized maximum and minimum pricing rules where FastQue chooses to configure them.
22. PRODUCT AND SERVICE COST TRANSPARENCY
Inspired by transparent home-service pricing models, allow configurable breakdowns for:

* Professional service cost.
* Products consumed.
* Disposable materials.
* Travel fee.
* Equipment usage.
* Platform fee.
* Taxes.

For eligible services, allow:

* Professional brings products.
* Customer provides approved products.
* Premium product selection.
* Brand-specific product selection.
* Single-use product kits.

Do not permit customer-supplied products where professional safety or service quality requires specific approved materials.
Show product information, quantity and price where applicable.
Reuse existing FastQue product and inventory databases.
Allow salon-managed home services to reserve and consume eligible salon inventory.
Allow independent professionals to maintain their own product inventory where required.
Prevent duplicate inventory deductions.
Record actual product consumption without exposing confidential wholesale costs.
23. HOME-SERVICE SHOPPING BAG
Allow customers to select multiple compatible services.
Examples:

* Haircut and beard trimming.
* Facial and cleanup.
* Manicure and pedicure.
* Family haircuts.
* Bridal makeup package.

Group services based on:

* Provider.
* Professional.
* Address.
* Appointment time.
* Required skills.
* Compatibility.
* Service duration.

If one professional can perform all selected services, offer a combined appointment.
If multiple professionals are required, clearly identify separate appointments.
Calculate total appointment duration based on whether services occur sequentially or in parallel.
Show all service groups before checkout.
Do not silently split or partially confirm bookings without customer consent.
24. CHECKOUT – NO ONLINE PAYMENT GATEWAY
Build complete home-service checkout.
Support registered customers and secure guest booking where feasible.
For guest bookings, require verified contact information before exposing sensitive booking or tracking details.
Collect:

* Customer name.
* Mobile number.
* Service address.
* Selected service.
* Provider preference.
* Appointment date and time.
* Special instructions.
* Applicable product preferences.
* Payment method.

Payment methods initially:

* Cash after service.
* Direct UPI payment to the service provider.
* Other approved offline methods.

Do not integrate:

* Razorpay.
* Stripe.
* PayPal.
* Online card processing.
* Online UPI payment gateways.
* Unlicensed wallets.
* Escrow.

Build an extensible payment interface for future regulated payment integration.
Do not collect card details.
Do not falsely claim FastQue has processed or received money when payment occurred directly between customer and provider.
Clearly identify who collects the payment and who issues the invoice.
25. PROFESSIONAL MOBILE DASHBOARD
Create a dedicated mobile-first professional dashboard.
Navigation:

* Home.
* Go Online.
* My Availability.
* Incoming Requests.
* Today's Schedule.
* Upcoming Bookings.
* Active Service.
* Navigation.
* My Services.
* My Pricing.
* My Service Area.
* My Portfolio.
* Reviews.
* Earnings.
* Payment Records.
* Inventory.
* Safety and Support.
* Settings.

Professional home dashboard
Display:

* Availability status.
* Today's bookings.
* Upcoming appointment.
* Current booking.
* Expected travel time.
* Today's earnings.
* Weekly earnings.
* Outstanding payments.
* Service rating.
* Recommended availability periods.

Provide a clear Go Online / Go Offline control.
Going offline prevents new instant requests but does not silently cancel existing accepted appointments.
Allow professionals to:

* Accept bookings.
* Decline bookings.
* View address after authorized assignment.
* Open external navigation.
* Report delays.
* Mark on the way.
* Confirm arrival.
* Start service.
* Add customer-approved services.
* Complete service.
* Record offline payment.
* Report safety concerns.
* Request support.

26. FREELANCER EARNINGS AND SALON FINANCIAL MANAGEMENT
Create separate financial reporting models.
Independent professional earnings
Track:

* Completed service value.
* Travel charges.
* Product charges.
* Approved tips.
* Professional earnings.
* FastQue platform fees.
* Discounts.
* Outstanding customer payments.
* Amount confirmed received.
* Adjustments.
* Disputed amounts.

Salon-managed service earnings
Track:

* Total home-service revenue.
* Revenue by professional.
* Service revenue.
* Product revenue.
* Travel revenue.
* Staff payouts.
* Travel expenses.
* Product consumption costs.
* Platform fees.
* Gross contribution.

Allow salon owners to configure professional compensation:

* Fixed salary.
* Fixed amount per home service.
* Percentage-based incentive.
* Travel allowance.
* Overtime compensation.
* Performance incentives.

Do not automatically alter existing salon payroll or staff compensation records.
Integrate with existing expense management through explicit authorized accounting records.
Avoid double-counting revenue or expenses.
27. CUSTOMER DASHBOARD
Enhance the existing customer account with:

* Home-Service Bookings.
* Upcoming Home Services.
* Active Booking.
* Track Professional.
* Booking History.
* Favourite Professionals.
* Saved Addresses.
* Rebook Service.
* My Packages.
* Memberships.
* Reviews.
* Invoices.
* Complaints.
* Support.

Do not remove existing:

* Salon appointments.
* Queue history.
* Product orders.
* Customer marketplace features.

Clearly distinguish:

* At-salon bookings.
* Home-service bookings.
* Product orders.

Allow secure guest booking retrieval.
Do not expose booking information solely through predictable IDs.
28. PACKAGES, MEMBERSHIPS AND RECURRING BOOKINGS
Build configurable promotional and membership infrastructure.
Service packages
Support:

* Men's monthly grooming.
* Haircut and beard combo.
* Facial packages.
* Wedding packages.
* Family packages.
* Senior citizen packages.
* Premium beauty packages.

Memberships
Support configurable benefits:

* Discounted services.
* Reduced travel charges.
* Priority booking.
* Free eligible add-ons.
* Service credits.
* Family sharing.
* Preferred professional benefits.

Recurring booking
Allow:

* Weekly.
* Biweekly.
* Monthly.
* Custom recurrence.

Example:
Haircut at home every 3 weeks with the same barber.
Verify availability before each future appointment is confirmed.
Do not automatically assign another professional without respecting customer preferences.
Support pausing, editing and cancelling recurring bookings.
Keep paid membership activation disabled until the business model and payment arrangements are explicitly approved.
29. RESIDENTIAL SOCIETY AND GROUP BOOKING
Create a differentiated feature particularly useful in Indian residential societies.
Name:
FastQue Home Community
Allow residents in the same apartment complex or locality to coordinate bookings.
Example:
Five residents in the same society book haircuts on Sunday.
A professional visits the society and serves customers sequentially.
This can reduce travel time and improve professional utilization.
Support:

* Society service campaigns.
* Group booking requests.
* Minimum participation.
* Multiple customer appointments.
* Group discounts.
* Professional schedule optimization.
* Society-specific promotions.
* Individual customer payments.
* Individual booking confirmation.
* Family group appointments.

Do not expose residential addresses or personal information between unrelated customers.
Clearly specify when a group discount is conditional on minimum participation.
If the required group size is not reached, ask customers to approve any price change before proceeding.
30. PROFESSIONAL QUALITY AND VERIFICATION
Develop a comprehensive verification and onboarding process.
Support:

* Mobile verification.
* Identity verification where justified.
* Professional experience verification.
* Training certificate verification.
* References.
* Practical skill assessment.
* Equipment verification.
* Hygiene training.
* Service-specific qualification.
* Background checks through authorized processes where appropriate.

Verification statuses:

* Not submitted.
* Pending.
* Under review.
* Verified.
* Rejected.
* Expired.
* Suspended.

Maintain:

* Verification date.
* Verified by.
* Verification scope.
* Supporting evidence.
* Review date.
* Audit history.

Only display verified badges corresponding to actual completed checks.
Do not represent basic phone verification as a background or skill verification.
Do not promise absolute safety based on a verification badge.
Create category-specific quality requirements.
Require higher qualification and safety review for specialized treatments.
31. TRUST, SAFETY AND HYGIENE
Customer and professional safety must be a core infrastructure requirement.
Customer safety features

* Verified provider information.
* Assigned professional details.
* Booking sharing.
* Emergency contact information.
* Support access.
* Incident reporting.
* Unauthorized replacement prevention.
* Service start verification.
* Hygiene checklist.
* Service-specific safety instructions.

Professional safety features

* Verified customer contact where feasible.
* Address access only after authorized assignment.
* Booking sharing with a trusted contact.
* Emergency support access.
* Unsafe-location reporting.
* Harassment reporting.
* Right to discontinue unsafe service.
* Non-payment dispute reporting.
* Incident escalation.
* Ability to decline unsafe assignments.

Hygiene workflow
Provide configurable checklists covering:

* Sanitized tools.
* Clean equipment.
* Disposable materials.
* Product expiry.
* Appropriate protective materials.
* Clean service area.
* Waste collection.
* Cleanup after completion.

For services involving chemicals, dyes or other potentially irritating products, support applicable safety instructions and required professional assessments.
Do not provide medical assurances or allow unqualified medical treatments.
Emergency support buttons must clearly indicate what they actually do.
Do not imply FastQue operates a 24/7 emergency response center unless that service genuinely exists.
Provide clear guidance to contact appropriate local emergency services when necessary.
32. RATINGS, REVIEWS AND QUALITY ASSURANCE
Allow customers to review completed home services.
Rating categories:

* Service quality.
* Professional behavior.
* Punctuality.
* Hygiene.
* Price transparency.
* Overall satisfaction.

Allow professionals to submit private or appropriately governed feedback regarding:

* Customer communication.
* Address accuracy.
* Service conditions.
* Payment experience.
* Safety concerns.

Implement:

* Verified booking-based reviews.
* Review moderation.
* Duplicate prevention.
* Abuse reporting.
* Right to respond.
* Review disputes.
* Appeals.
* Fraud detection.

Do not allow fabricated reviews.
Do not publicly expose sensitive customer feedback.
Do not create opaque professional blacklists.
33. CUSTOMER SUPPORT, CANCELLATIONS AND SERVICE GUARANTEE
Reuse the existing FastQue support architecture where appropriate.
Create home-service categories:

* Professional delayed.
* Professional did not arrive.
* Incorrect professional assigned.
* Service quality issue.
* Hygiene issue.
* Pricing dispute.
* Payment issue.
* Product issue.
* Safety concern.
* Cancellation.
* Rescheduling.
* Replacement request.
* Refund request.

Support:

* Booking-linked tickets.
* Photos and attachments.
* Ticket priority.
* Assigned support executive.
* Escalation.
* Internal notes.
* Customer communication.
* Resolution history.

Create configurable cancellation policies covering:

* Before confirmation.
* After professional acceptance.
* Before travel.
* After travel begins.
* Professional cancellation.
* Customer no-show.
* Professional no-show.
* Unsafe service conditions.
* Emergency exceptions.

Show policies before booking confirmation.
Avoid unfair automatic penalties.
Support configurable service correction or re-service policies.
Do not advertise service guarantees that FastQue cannot operationally fulfill.
Record approved offline refunds or service credits without integrating a payment gateway.
34. NOTIFICATION AND COMMUNICATION SYSTEM
Build a reliable event-driven notification system.
Reuse existing configured providers where possible.
Support:

* In-app notifications.
* Email.
* SMS adapters.
* Approved WhatsApp Business integrations.
* Push notifications where supported.

Customer notification events:

* Booking requested.
* Booking confirmed.
* Professional assigned.
* Appointment reminder.
* Professional preparing.
* Professional on the way.
* ETA changed.
* Professional arrived.
* Service started.
* Service completed.
* Payment confirmation.
* Cancellation.
* Rescheduling.
* Replacement.
* Review request.
* Support updates.

Professional notification events:

* New booking request.
* Booking acceptance deadline.
* Booking confirmed.
* Upcoming appointment.
* Travel reminder.
* Customer address update.
* Booking cancelled.
* Payment reminder.
* Review received.
* Dispute update.

Salon owner notifications:

* New home-service booking.
* Staff assignment required.
* Staff availability conflict.
* Professional delay.
* Customer cancellation.
* Service completion.
* Payment discrepancy.

Use notification retries, event deduplication, consent, preference controls and delivery logs.
Do not send unauthorized bulk WhatsApp messages.
Do not claim delivery unless confirmed by the external provider.
35. FASTQUE AI HOME-SERVICE AGENTS
Use existing AI infrastructure where available.
Do not introduce mandatory expensive external AI services.
AI Discovery Agent
Interpret customer requests such as:
"Find me a barber who can come to my home within 30 minutes."
"Book my regular hairstylist for Sunday morning."
"Find a female beautician for facial and waxing under ₹1,500."
Convert natural language into structured search requirements.
Display actual eligible providers and appointment options.
Do not fabricate availability.
AI Dispatch Agent
Recommend professionals based on:

* Availability.
* Road travel time.
* Skills.
* Service duration.
* Existing commitments.
* Professional preferences.
* Salon staffing limits.
* Customer preferences.

Use deterministic scheduling and routing rules for final eligibility.
An LLM must not be the sole authority for booking feasibility or availability.
AI ETA Prediction Agent
Improve ETA estimates using historical information:

* Actual service durations.
* Actual travel durations.
* Appointment delays.
* Time of day.
* Area.
* Service category.
* Professional-specific duration patterns.

Use reliable historical records.
Show uncertainty when insufficient data exists.
AI Workforce Advisor
Analyze salon queue and appointment demand.
Recommend when salon staff could safely provide home services.
Example:
"Your salon typically has low in-store demand from 2 PM to 4 PM on weekdays. Consider enabling home-service appointments during this period."
AI Pricing Advisor
Recommend pricing based on:

* Service duration.
* Travel expense.
* Product consumption.
* Local market data where legitimately available.
* Historical customer demand.
* Professional earnings.
* Profitability.

Do not automatically change prices without configured authorization.
AI Customer Retention Agent
Recommend:

* Rebooking reminders.
* Repeat grooming schedules.
* Relevant packages.
* Favourite professional bookings.
* Opt-in personalized promotions.

AI Quality and Fraud Agent
Flag:

* Repeated no-shows.
* Duplicate bookings.
* Suspicious location changes.
* Fake reviews.
* Repeated service complaints.
* Unauthorized price adjustments.
* Suspicious payment records.

Require human review before significant enforcement actions.
36. FASTQUE ADMIN – HOME SERVICES
Create a separate top-level admin tab:
FastQue Home
Sub-tabs:

1. Overview.
2. Home-Service Catalog.
3. Salon Providers.
4. Independent Professionals.
5. Professional Verification.
6. Active Bookings.
7. Scheduled Bookings.
8. Dispatch Center.
9. Live Operations.
10. Service Areas.
11. Pricing.
12. Promotions.
13. Society Campaigns.
14. Packages and Memberships.
15. Quality and Hygiene.
16. Safety Incidents.
17. Customer Complaints.
18. Payments and Settlements.
19. Commissions.
20. Training.
21. AI Insights.
22. Analytics and Reports.
23. Settings.

Use existing admin dashboard design patterns.
Include search, filters, pagination, date ranges, authorized bulk actions and exports.
Do not expose sensitive documents or live locations to unauthorized staff.
37. CENTRAL DISPATCH CONTROL CENTER
Create an operational dispatch dashboard.
Display:

* Active bookings.
* Unassigned bookings.
* Professionals available now.
* Professionals preparing.
* Professionals traveling.
* Professionals serving customers.
* Delayed professionals.
* At-risk appointments.
* Cancelled bookings.
* Replacement requirements.
* Service incidents.

Provide a map-based operational view where mapping infrastructure is configured.
Allow authorized dispatchers to:

* Search eligible professionals.
* Review availability.
* View ETA.
* Recommend reassignment.
* Contact relevant parties.
* Coordinate replacements.
* Resolve booking conflicts.
* Reschedule bookings with approval.
* Escalate safety concerns.

Do not silently override professional acceptance or customer-selected professional preferences.
Maintain audit history of manual dispatch actions.
38. BUSINESS MONETIZATION
Build a configurable revenue architecture.
Do not hardcode pricing or commissions.
Support:
Salon commission
FastQue charges an agreed fee on completed eligible home-service bookings.
Independent professional commission
FastQue charges an agreed platform fee on completed eligible services.
Fixed booking fee
Configurable fixed fee per completed appointment.
Premium listing
Optional clearly labeled sponsored visibility.
Salon home-service subscription
Monthly fee for additional home-service management tools.
Customer membership
Configurable recurring membership benefits.
Society service campaigns
Configurable group booking fees.
Product and kit sales
Professionals purchase supplies through FastQue Commerce where available.
Training and verification services
Optional professional training and verification programs.
Example configurable fee experiments:

* Salon commission: 5–10%.
* Independent professional commission: 8–15%.
* Fixed booking fee: ₹20–₹49.
* Optional premium professional plan: ₹299/month.

These are editable business assumptions, not mandatory rates.
Clearly disclose all provider fees.
Do not charge commissions for cancelled or unsuccessful services unless explicitly justified by a disclosed policy.
Keep monetization disabled until explicitly activated by authorized FastQue administrators.
Support manual invoicing, offline fee collection and outstanding balance tracking.
39. BUSINESS ANALYTICS AND REPORTING
Create comprehensive analytics for FastQue Home.
Booking analytics

* Total booking requests.
* Confirmed bookings.
* Completed bookings.
* Unassigned bookings.
* Instant bookings.
* Scheduled bookings.
* Cancelled bookings.
* Repeat bookings.
* Booking conversion rate.
* Average order value.

ETA and dispatch analytics

* Average estimated arrival time.
* Actual arrival time.
* ETA prediction error.
* Assignment acceptance rate.
* Average time to assign.
* On-time arrival rate.
* Professional delays.
* Booking fulfillment rate.
* Travel time per booking.
* Distance per booking.

Professional analytics

* Total professionals.
* Verified professionals.
* Active professionals.
* Available professionals.
* Professional utilization.
* Earnings per hour.
* Completed services.
* Cancellation rate.
* Repeat customer rate.
* Salon-managed vs independent professional performance.

Financial analytics

* Gross service booking value.
* FastQue commission revenue.
* Subscription revenue.
* Provider earnings.
* Salon revenue.
* Travel charges.
* Product revenue.
* Discounts.
* Refunds.
* Outstanding platform fees.
* Contribution margin.

Market intelligence

* Most popular services.
* City-wise demand.
* Locality-wise demand.
* Society-wise demand.
* Peak booking hours.
* Price sensitivity.
* Service coverage gaps.
* Professional supply gaps.
* Service cancellation patterns.

Allow daily, weekly, monthly, quarterly, yearly and custom date filters.
Do not count the entire service booking value as FastQue revenue if FastQue earns only a commission.
Use actual transaction records.
40. FIELD SALES AND CRM INTEGRATION
Extend existing FastQue field sales and CRM systems.
Allow field executives to:

* Identify salons willing to offer home services.
* Assist salon owners in listing services.
* Register freelance professionals with consent.
* Collect relevant verification information.
* Schedule practical skill assessments.
* Conduct onboarding training.
* Register residential society leads.
* Coordinate society campaigns.
* Follow up with inactive providers.

Track:

* Salon home-service activations.
* Independent professionals onboarded.
* Verified professionals.
* Published services.
* First completed booking.
* Active service providers.
* Society campaigns.
* Completed bookings.
* Repeat usage.

Do not incentivize executives solely on raw registrations.
Prioritize genuine activation and successful services.
41. DATABASE ARCHITECTURE
Inspect existing database architecture before creating tables.
Reuse suitable existing entities.
Potential new or extended entities:

* Home-service provider profiles.
* Professional capabilities.
* Home-service categories.
* Home-service definitions.
* Provider service listings.
* Professional service assignments.
* Provider service areas.
* Professional schedules.
* Unified availability records.
* Booking holds.
* Home-service bookings.
* Home-service booking items.
* Booking price snapshots.
* Dispatch requests.
* Professional invitations.
* Booking assignments.
* Travel commitments.
* ETA estimates.
* Active tracking sessions.
* Booking status history.
* Service check-in.
* Service completion records.
* Customer addresses.
* Product consumption records.
* Offline payment records.
* Professional earnings.
* Platform fee records.
* Provider settlements.
* Service packages.
* Memberships.
* Recurring bookings.
* Society campaigns.
* Verification records.
* Hygiene checklists.
* Reviews.
* Safety incidents.
* Support disputes.
* Notifications.
* Audit logs.

Implement:

* Foreign keys.
* Unique constraints.
* Geographic indexes where supported.
* Appropriate query indexes.
* Transaction management.
* Atomic assignment.
* Idempotency.
* Concurrency protection.
* Data validation.
* Status histories.
* Safe migrations.

Do not duplicate professional identities across Talent, Salon Staff and Home Services.
Keep service-provider permissions separate.
Protect historical booking and financial records.
42. SECURITY, PRIVACY AND COMPLIANCE
Implement strong security appropriate to home visits and location-sensitive services.
Include:

* Role-based access control.
* Provider-level authorization.
* Server-side validation.
* Booking ownership verification.
* Secure guest booking access.
* Rate limiting.
* Secure OTP generation.
* Secure file uploads.
* Private document storage.
* Audit logging.
* Encryption where appropriate.
* Secrets protection.
* Location consent management.
* Data retention controls.
* Account deletion and data export mechanisms.
* Fraud reporting.
* User blocking.
* Incident escalation.

Protect:

* Home addresses.
* Live professional location.
* Identity documents.
* Private customer details.
* Financial records.
* Internal verification records.

Only reveal customer address details to professionals authorized to fulfill the booking.
Stop location sharing when the booking ends.
Restrict independent professional registration to adults initially.
For children's services, require appropriate parent or guardian involvement.
Implement configurable disclosures and operational controls supporting applicable Indian data protection, consumer protection, taxation, professional safety, employment and platform requirements.
Do not assume software implementation alone establishes legal compliance.
FastQue must obtain appropriate operational and legal review before launching home services commercially.
43. PERFORMANCE AND SCALABILITY
Design for future support of:

* Thousands of salons.
* Hundreds of thousands of professionals.
* Multiple Indian cities.
* Concurrent booking requests.
* Large service catalogs.
* High-volume location updates.
* Large notification volumes.

Implement:

* Optimized geographic search.
* Server-side pagination.
* Efficient availability calculations.
* Routing result caching where permitted.
* Background jobs.
* Asynchronous notifications.
* Event deduplication.
* Efficient database queries.
* Appropriate indexes.
* Image compression.
* Lazy loading.
* Controlled location update frequencies.

Avoid unnecessary infrastructure complexity.
Do not allow home-service traffic or location updates to degrade existing salon booking and live queue performance.
Measure relevant endpoint performance before and after implementation.
44. UI/UX DESIGN REQUIREMENTS
Maintain existing FastQue brand colors and typography.
Create a modern, premium and mobile-first user experience inspired by leading on-demand service marketplaces.
Do not copy proprietary competitor designs.
Include:

* Attractive service cards.
* Professional profile cards.
* Service comparison.
* Transparent pricing.
* Availability indicators.
* ETA labels.
* Map-based discovery where configured.
* Simple calendar selection.
* Sticky booking buttons.
* Clear provider identification.
* Booking timeline.
* Professional tracking.
* Visual service categories.
* Responsive layouts.
* Skeleton loading.
* Empty states.
* Error recovery.
* Accessible typography.

Optimize for low-cost Android devices, slow networks and users with limited technical experience.
Provide Hindi and English support for critical workflows.
Make salon-managed professionals and independent professionals clearly distinguishable at every stage.
45. MANDATORY TESTING
Run existing regression tests before and after implementation.
Customer tests

1. Customer location selection.
2. Manual address entry.
3. Service search.
4. Salon home-service discovery.
5. Independent professional discovery.
6. Service price comparison.
7. Specific professional booking.
8. Specific salon booking.
9. Fastest available professional booking.
10. Instant booking.
11. Scheduled booking.
12. Multiple-service booking.
13. Family booking.
14. Guest booking.
15. Offline payment selection.
16. Booking cancellation.
17. Rescheduling.
18. Rebooking.
19. Reviews.

Provider tests

20. Salon home-service activation.
21. Home-service listing creation.
22. Professional assignment.
23. Independent professional registration.
24. Availability management.
25. Service area management.
26. Home-service pricing.
27. Professional acceptance.
28. Professional rejection.
29. Professional cancellation.
30. Travel status updates.
31. Service check-in.
32. Service completion.
33. Payment confirmation.

Scheduling and ETA tests

34. Existing salon appointment conflict.
35. Existing live queue conflict.
36. FastQue Talent shift conflict.
37. Simultaneous booking attempts.
38. Double-booking prevention.
39. Salon minimum staff protection.
40. Travel-time validation.
41. Appointment preparation buffer.
42. Appointment overrun.
43. ETA recalculation.
44. Routing provider failure.
45. Stale location data.
46. GPS permission denial.
47. Scheduled slot feasibility.
48. Booking hold expiration.
49. Replacement professional assignment.
50. Concurrent invitation acceptance.

Security and operations tests

51. Unauthorized customer address access.
52. Unauthorized live tracking access.
53. Location tracking termination.
54. Cross-provider data isolation.
55. OTP expiration and replay prevention.
56. Fake payment confirmation prevention.
57. Unauthorized price changes.
58. Customer support escalation.
59. Safety incident reporting.
60. Feature flag behavior.
61. Database migration safety.
62. Notification deduplication.
63. Mobile responsiveness.
64. Existing queue management regression.
65. Existing salon booking regression.
66. Existing marketplace regression.
67. Existing inventory regression.
68. Existing FastQue Talent regression.
69. Existing CRM regression.
70. Performance comparison.

Do not modify existing tests merely to make new failures appear successful.
Resolve material regressions introduced by the new module.
Report pre-existing failures separately.
46. IMPLEMENTATION PHASES
Phase 0 – Architecture and system protection

* Repository analysis.
* Baseline testing.
* Feature branch.
* Dependency assessment.
* Feature flags.
* Migration strategy.
* Scheduling integration assessment.

Phase 1 – Provider foundation

* Salon home-service activation.
* Freelancer registration.
* Professional profiles.
* Service catalog.
* Provider-specific pricing.
* Service areas.
* Admin navigation.

Phase 2 – Customer discovery

* Home-services landing page.
* Service search.
* Provider comparison.
* Address management.
* Geospatial discovery.
* Professional portfolios.

Phase 3 – Booking and availability

* Unified availability engine.
* Salon capacity protection.
* Instant booking.
* Scheduled booking.
* ETA calculation.
* Booking holds.
* Professional dispatch.

Phase 4 – Service execution

* Professional mobile dashboard.
* Assignment acceptance.
* Travel updates.
* Live tracking where supported.
* OTP/QR verification.
* Service completion.
* Offline payment records.

Phase 5 – Operations and quality

* Admin dispatch center.
* Verification.
* Safety.
* Hygiene.
* Notifications.
* Reviews.
* Customer support.
* Disputes.
* Cancellations and replacements.

Phase 6 – Business growth

* Packages.
* Membership architecture.
* Society campaigns.
* Recurring bookings.
* Revenue management.
* Analytics.
* CRM integration.

Phase 7 – Advanced AI

* Natural-language discovery.
* Intelligent matching.
* ETA improvement.
* Workforce recommendations.
* Pricing recommendations.
* Customer retention.
* Fraud risk detection.

Phase 8 – Final testing and deployment preparation

* Regression testing.
* Security testing.
* Availability concurrency testing.
* Performance testing.
* Mobile testing.
* Database migration validation.
* Documentation.
* Rollback preparation.

Complete each phase independently.
Create logical Git commits after each stable phase.
Do not allow optional AI, external map integrations or future modules to block completion of the core service workflow.
When an external integration is unavailable, implement a transparent functional fallback wherever feasible.
47. FINAL DELIVERABLES
Provide:

1. Working frontend.
2. Working backend.
3. Dedicated Git feature branch.
4. Database migrations.
5. Database relationship diagram.
6. Service-provider architecture diagram.
7. Unified scheduling architecture.
8. ETA calculation documentation.
9. Dispatch algorithm documentation.
10. Customer booking workflow.
11. Salon provider workflow.
12. Freelancer workflow.
13. Tracking workflow.
14. Offline payment workflow.
15. Safety and verification workflow.
16. API documentation.
17. Role and permission matrix.
18. Feature flag documentation.
19. External map provider configuration.
20. Notification configuration.
21. AI configuration.
22. Automated test results.
23. Regression test comparison.
24. Screenshots of customer website.
25. Screenshots of professional dashboard.
26. Screenshots of salon home-service dashboard.
27. Screenshots of admin dispatch dashboard.
28. List of all modified files.
29. Shared-component impact report.
30. Deployment instructions.
31. Rollback instructions.
32. External integration costs and requirements.
33. Remaining blockers and limitations.
34. Feature-by-feature completion matrix.

Classify each feature as:

* Implemented and verified.
* Implemented but not verified.
* Requires external configuration.
* Blocked.
* Not implemented.

Do not falsely claim functionality is operational if it has not been tested.
FINAL EXECUTION INSTRUCTION
Begin with a complete inspection of the existing FastQue repository.
Build FastQue Home as an independent but deeply integrated home-services marketplace.
Customers must be able to book any eligible, available and authorized barber, stylist or beauty professional from participating salons or independent professional accounts.
Provide accurate availability, realistic ETA, transparent pricing, immediate or scheduled bookings, professional dispatch, home-service tracking, service verification, offline payment records, reviews, customer support and comprehensive operational management.
Reuse FastQue Talent professional identities, salon information, service catalogs, inventory, CRM, notifications and authentication wherever appropriate.
Do not create duplicate systems unnecessarily.
Do not disrupt existing salon queues or scheduled bookings.
Do not dispatch salon staff when doing so violates salon capacity requirements.
Do not integrate online payment gateways.
Do not activate paid external services without approval.
Do not deploy to production without explicit authorization.
Make safe routine implementation decisions independently, document assumptions and execute the development in controlled phases.
Build actual functionality, not just UI mockups.
The objective is to make FastQue a complete salon and home beauty ecosystem, combining the convenience of Urban Company and Yes Madam with the power of India's existing independent salon network.
Preserving all existing FastQue functionality is non-negotiable.
