> User instruction: "build this without breaking any existing functionality".

# Build FastQue Connect – AI-Powered Smart Communication System
Act as a senior full-stack software architect, Agentic AI engineer, cybersecurity expert, product manager and UI/UX designer.
Build a production-ready, scalable, intelligent, real-time communication platform called FastQue Connect, integrated into the existing FastQue application.
The objective is to create a seamless communication ecosystem connecting customers, salon owners, salon managers, stylists, freelancers and FastQue support.
Do not build just a conventional messaging system. Build an intelligent communication and booking management platform that improves customer experience, reduces cancellations, increases revenue and minimizes manual work for salon owners.
1. Existing architecture and integration
Before implementing:

* Thoroughly audit the existing FastQue repository.
* Understand the existing frontend, backend, database, authentication, booking system, live queue, CRM, customer dashboard, salon owner dashboard and admin dashboard.
* Reuse existing components, APIs, authentication and infrastructure wherever possible.
* Maintain the existing FastQue brand colors, typography and design language.
* Do not break existing features.
* Avoid creating duplicate databases or unnecessary microservices.
* Make the entire system mobile-responsive and suitable for future native mobile application integration.

2. Booking-linked communication
Automatically create a secure conversation when a customer successfully makes a booking.
Support:

* Scheduled appointments.
* Live queue bookings.
* Home service bookings.
* Freelancer and individual stylist bookings.
* Multi-service bookings.
* Group bookings.

Each conversation must be linked to the relevant booking ID, customer ID, salon ID and authorized service provider.
Display a live booking information card inside the conversation containing:

* Booking reference number.
* Salon name.
* Selected stylist.
* Selected services.
* Appointment date and time.
* Booking status.
* Estimated waiting time.
* Current queue position.
* Estimated service duration.
* Total service price.
* Payment status.

Booking information must update automatically whenever the original booking record changes.
3. Customer messaging interface
Add a dedicated Messages section to the customer dashboard.
Add a Chat with Salon button to:

* Booking confirmation page.
* Active bookings.
* Live queue screen.
* Upcoming appointments.
* Completed booking history, subject to configurable communication rules.

Support the following communication features:

* Real-time text messages.
* Images and photographs.
* Voice messages.
* Voice-to-text transcription.
* Emojis.
* PDF and permitted document attachments.
* Customer-approved location sharing.
* Message replies.
* Message reactions.
* Message editing with audit history.
* Message deletion according to permissions.
* Typing indicators.
* Online and offline status.
* Last active status with privacy settings.
* Sent, delivered and read receipts.
* Unread message counters.
* Conversation search.
* Message timestamps.
* Image previews.
* Mute notifications.
* Archive conversations.
* Block and report functionality.

Provide message templates such as:

* I am on my way.
* I have arrived.
* I am running late.
* How long is the waiting time?
* Can I change my appointment?
* Can I request a particular stylist?
* Can I add another service?
* What will be the total price?
* Can I share my preferred hairstyle?
* Where can I park?
* I need help finding the salon.

Allow customers to type any legitimate service-related question without restricting them to predefined templates.
4. Salon owner communication dashboard
Create a dedicated FastQue Connect tab in the salon owner dashboard.
Design a professional communication inbox with the following categories:

* All conversations.
* Unread.
* New booking conversations.
* Upcoming appointments.
* Live queue customers.
* Home service customers.
* Awaiting customer response.
* Awaiting salon response.
* Urgent.
* AI-handled.
* Complaints.
* Completed.
* Archived.

Include:

* Customer search.
* Booking ID search.
* Conversation filters.
* Date range filters.
* Conversation assignment.
* Priority management.
* Customer tags.
* Internal staff notes not visible to customers.
* Conversation transfer between authorized employees.
* Conversation status.
* Saved replies.
* Customer booking and service history with appropriate permissions.
* AI-generated conversation summaries.

Allow salon owners to assign communication responsibilities to receptionists, managers and stylists using role-based access control.
Prevent duplicate or conflicting responses when multiple employees are managing the same conversation.
5. AI-powered communication assistant
Build an intelligent assistant called FastQue Connect AI.
The AI assistant should understand customer intent and answer questions using authorized and verified data from:

* Salon profile.
* Salon opening hours.
* Service catalogue.
* Price list.
* Active offers.
* Stylist availability.
* Booking details.
* Live queue status.
* Salon location.
* Cancellation policies.
* Payment policies.
* Frequently asked questions.

Implement the following operating modes:
Mode A: AI Suggested Replies
AI generates recommended responses. Salon staff can approve, modify or reject them before sending.
Mode B: Automatic AI Response
AI automatically answers routine, low-risk questions using verified information when the salon enables this mode.
Mode C: Human Escalation
AI transfers the conversation to a human when:

* Customer requests human assistance.
* AI confidence is insufficient.
* A complaint is detected.
* A refund or payment dispute occurs.
* A customized price is requested.
* Customer requests an action outside approved AI permissions.
* The conversation involves sensitive or complex issues.

Clearly identify AI-generated automatic responses to customers.
Never allow AI to invent salon prices, offers, waiting times, policies or booking availability.
6. Smart intent detection
Automatically classify incoming messages into categories:

* Booking inquiry.
* Appointment modification.
* Cancellation request.
* Waiting time inquiry.
* Late arrival.
* Additional service request.
* Pricing inquiry.
* Hairstyle consultation.
* Product inquiry.
* Home service inquiry.
* Payment inquiry.
* Refund request.
* Complaint.
* General conversation.
* Emergency or safety concern.

Use intent detection to recommend the appropriate response, workflow or human escalation.
Use deterministic rules for critical operations and AI primarily for language understanding and conversation assistance.
7. Intelligent booking modification
Allow actionable messages within conversations.
Example:
Customer: Can I move my appointment from 4 PM to 5 PM?
The system should:

1. Detect the rescheduling request.
2. Check real-time salon and stylist availability.
3. Check applicable policies.
4. Present available appointment options.
5. Obtain required customer and salon approvals.
6. Update the booking using existing booking APIs.
7. Send confirmation to both parties.
8. Maintain a complete audit trail.

Support similar workflows for:

* Adding services.
* Removing services.
* Changing stylists.
* Changing appointment times.
* Requesting cancellation.
* Joining another available queue slot.
* Requesting late arrival accommodation.
* Booking additional family members.

Never let the AI silently modify confirmed bookings, payments or prices.
8. Live queue communication
Integrate directly with the FastQue live queue system.
Automatically communicate important events such as:

* Your queue position has changed.
* Your turn is approaching.
* Your stylist is ready.
* The salon is experiencing an unexpected delay.
* Your estimated waiting time has increased.
* Please arrive within the applicable arrival window.
* Your service has started.
* Your service has been completed.

Use event-driven notifications instead of continuously calling an LLM.
Include customer actions:

* I'm on my way.
* I've arrived.
* I need additional time.
* Request another time.
* Cancel my booking.

Prevent excessive notifications by using meaningful change thresholds and notification preferences.
9. Smart lateness management
When a customer communicates that they are running late:

* Identify the estimated delay.
* Check the current booking and queue status.
* Evaluate the salon's availability and late-arrival policy.
* Suggest appropriate options.
* Obtain required approvals.
* Notify affected parties.
* Update booking and queue information only after authorized confirmation.

Ensure other customers are not unfairly displaced.
10. Smart hairstyle and beauty consultation
Allow customers to upload reference photographs for:

* Haircuts.
* Hairstyles.
* Beard styles.
* Hair coloring.
* Bridal makeup.
* Nail art.
* Beauty treatments.

Allow salon professionals to respond with:

* Consultation comments.
* Recommended services.
* Estimated service duration.
* Customized quotations.
* Required preparation.
* Alternative styles.

Optionally integrate multimodal AI to help classify reference photographs and recommend relevant services from the salon's existing catalogue.
Do not make unsupported medical or guaranteed appearance claims.
11. Digital quotations and customized packages
Allow salon owners to send interactive quotation cards inside conversations.
Include:

* Service descriptions.
* Individual service prices.
* Discounts.
* Taxes.
* Total price.
* Estimated duration.
* Quotation validity.
* Terms and conditions.
* Accept, decline or request modification buttons.

Upon customer acceptance, integrate the quotation with the booking and payment systems.
Maintain version history and prevent unauthorized price changes.
Enable salons to create customized packages for weddings, parties, family bookings and multiple services.
12. Multilingual communication
Implement AI-powered translation supporting initially:

* English.
* Hindi.
* Hinglish.
* Bengali.
* Tamil.
* Telugu.
* Marathi.
* Gujarati.
* Punjabi.
* Odia.
* Kannada.
* Malayalam.

Automatically detect message language where feasible.
Allow customers and salon staff to select their preferred communication language.
Provide:

* Original message.
* Translated message.
* View original option.
* Translation settings.
* Voice-to-text in supported languages.

Cache translations securely to avoid unnecessary repeated AI costs.
13. Home service communication
Integrate the communication system with FastQue home service and freelancer bookings.
Support:

* Customer-approved location sharing.
* Estimated arrival time.
* Navigation assistance.
* Service provider arrival updates.
* Address clarification.
* Customer preparation instructions.
* Parking instructions.
* Arrival confirmation.
* Service completion confirmation.
* Safety reporting.
* Emergency support access.

Location sharing must be consent-based, time-limited and restricted to authorized booking participants.
Do not continuously track customers or service providers without their permission.
14. AI customer sentiment analysis
Analyze conversations to identify potential dissatisfaction.
Classify sentiment as:

* Positive.
* Neutral.
* Negative.
* Requires immediate attention.

Detect potential situations such as:

* Excessive waiting.
* Pricing disagreements.
* Unprofessional behavior.
* Poor service experience.
* Repeated unanswered questions.
* Potential booking cancellation.
* Refund disputes.

Create priority alerts for salon managers.
Allow escalation to FastQue support according to configurable rules.
Treat AI sentiment classification as an advisory signal, not a verified fact or automatic basis for penalties.
15. Smart follow-up and customer retention
After service completion, allow policy-compliant automated messages for:

* Thanking the customer.
* Requesting feedback.
* Providing service aftercare instructions.
* Sharing digital invoices.
* Suggesting relevant products.
* Offering loyalty rewards.
* Recommending the next appointment.
* Rebooking the same stylist.
* Providing personalized, consent-based offers.

Integrate these features with FastQue CRM, customer loyalty, marketplace and marketing systems wherever available.
Separate transactional messages from promotional messages.
Allow customers to opt out of promotional communication easily.
Do not allow uncontrolled promotional messaging or spam.
16. Smart notifications
Implement a centralized notification system supporting:

* In-app notifications.
* Web push notifications.
* Mobile push notifications when supported.
* Optional email.
* Optional WhatsApp Business API integration.
* Optional SMS fallback.

Add configurable rules for:

* Unread messages.
* Appointment changes.
* Booking confirmations.
* Queue changes.
* Urgent customer requests.
* Customized quotation updates.
* Complaint escalation.

Prevent duplicate notifications.
Keep sensitive message contents out of lock-screen notifications unless the user explicitly enables previews.
Use WhatsApp and SMS only with applicable consent, approved integrations and appropriate notification policies.
17. Complaint management and FastQue support
Allow customers to report problems directly from conversations.
Integrate with the existing FastQue support ticket system if available.
Automatically create a ticket containing:

* Ticket ID.
* Booking reference.
* Issue category.
* Customer details.
* Salon details.
* Authorized conversation context.
* Priority.
* Assigned support agent.
* Resolution deadline.
* Current status.

Provide an appropriate mechanism for salon managers and FastQue support to resolve disputes.
Allow customers to track the ticket status.
Ensure support personnel access customer conversations only for authorized and documented business purposes.
18. Smart communication analytics
Build a comprehensive analytics dashboard for salon owners.
Display:

* Total conversations.
* Active conversations.
* Unread messages.
* Unanswered customer messages.
* Average and median first response time.
* Average resolution time.
* AI automated response rate.
* Human escalation rate.
* Booking modification requests.
* Cancellation prevention rate with a clearly defined calculation.
* Customer satisfaction.
* Quotation acceptance rate.
* Additional service revenue from chat.
* Rebookings generated from chat.
* Frequently asked questions.
* Customer sentiment trends.
* Employee response performance.
* Peak communication hours.

Add daily, weekly, monthly and custom date-range filters.
Provide charts, trend indicators and authorized CSV or Excel exports.
19. FastQue admin control center
Create a Communication Management section in the FastQue admin dashboard.
Include:

* Total platform conversations.
* Active salons using communication.
* Daily and monthly message volume.
* AI-generated response volume.
* Unanswered conversation metrics.
* Complaint trends.
* Salon response performance.
* AI token consumption.
* AI cost per conversation.
* AI cost per salon.
* Translation usage.
* Media storage consumption.
* Notification delivery statistics.
* Abuse and spam reports.
* Customer satisfaction trends.
* Revenue attributed to communication workflows.

Allow administrators to configure:

* AI provider.
* AI model.
* Salon-level AI permissions.
* Message limits.
* Attachment size limits.
* Conversation retention policies.
* Booking-based communication eligibility.
* Notification rules.
* Moderation policies.
* Escalation rules.
* Subscription entitlements.
* Usage quotas.

Do not provide unrestricted administrative access to private conversations.
Implement audited, purpose-limited access.
20. Privacy and security
Implement enterprise-grade security throughout.
Requirements:

* Secure WebSocket or equivalent real-time communication.
* TLS encryption in transit.
* Encryption at rest.
* Role-based access control.
* Strict tenant isolation.
* Conversation participant verification.
* Backend authorization for every conversation operation.
* Secure media storage.
* Expiring signed media URLs.
* Attachment validation and malware scanning.
* Rate limiting.
* Spam protection.
* Abuse detection.
* Reporting and blocking.
* Audit logs.
* Secure secret management.
* Configurable data retention.
* Account deletion and data export workflows.
* Protection against prompt injection.
* Protection against XSS, CSRF and injection attacks.
* Restricted AI tool access.

Customers and salons must not need to exchange personal phone numbers to communicate.
Prevent unauthorized access to another salon's conversations, even if a malicious user knows the conversation ID.
Design for applicable Indian data protection requirements and future international privacy compliance.
Do not claim regulatory compliance without verification.
21. Communication lifecycle
Implement configurable conversation lifecycle rules.
Suggested defaults:

* Conversation begins after successful booking creation.
* Remains active before and during the appointment.
* Remains active for 7 days after service completion.
* Becomes read-only after the active communication period.
* Can be reopened through an authorized support or booking workflow.
* Complaints remain accessible until resolved according to support policies.

Cancelled bookings should retain a limited communication window for legitimate resolution.
Customers must retain appropriate access to their conversation history according to retention and privacy policies.
Make all durations configurable through the admin dashboard.
22. Recommended technical architecture
Audit existing infrastructure before selecting additional technology.
Where compatible, consider:

* Existing Next.js frontend.
* Existing backend framework.
* Existing PostgreSQL database.
* WebSockets or Socket.IO for real-time messaging.
* Redis for presence, caching and distributed events where required.
* Existing background job infrastructure.
* Secure object storage for attachments.
* Web Push or Firebase Cloud Messaging where appropriate.
* Provider-independent LLM integration.
* Retrieval-augmented generation using authorized salon data.
* PostgreSQL vector search only where semantic retrieval provides measurable value.

Avoid unnecessary infrastructure complexity.
Design for horizontal scalability, reliable message delivery, reconnect handling, message ordering, idempotency and offline synchronization.
Keep the communication system functional even if the AI provider is unavailable.
23. Database design
Create normalized database entities as appropriate, including:

* Conversations.
* Conversation participants.
* Messages.
* Message attachments.
* Message receipts.
* Message reactions.
* Conversation assignments.
* Internal notes.
* Saved replies.
* Notification events.
* AI interaction logs.
* Translation records.
* Customer consent records.
* Booking action requests.
* Customized quotations.
* Complaint escalation records.
* Communication analytics events.
* Moderation reports.
* Audit logs.

Use foreign keys, suitable indexes, tenant isolation, database migrations and transactional consistency.
Implement cursor-based pagination for large message histories.
Reuse existing customer, salon, booking, employee and payment tables.
24. Agentic AI architecture
Build modular AI capabilities that can operate independently or through a controlled orchestration layer.
Reception Agent: Answers verified routine customer questions.
Booking Agent: Handles booking-related intent and proposes authorized booking actions.
Queue Agent: Communicates queue changes and estimated waiting times.
Translation Agent: Enables multilingual communication.
Sales Agent: Recommends relevant services and products when appropriate.
Retention Agent: Handles feedback, loyalty and consent-based rebooking.
Customer Support Agent: Identifies complaints and prepares support escalations.
Supervisor Agent: Manages routing, confidence checks, permissions and human escalation.
Do not require a separate LLM invocation for every agent. Use shared orchestration, deterministic workflows and cost-efficient routing.
Use structured tool calls with validated inputs, limited permissions and auditable results.
25. AI cost optimization
Design the platform for thousands of salons across India.
Implement:

* Rule-based replies for predictable questions.
* Cached FAQ responses.
* Cached translations.
* Smaller AI models for classification.
* More capable models only for complex requests.
* Conversation summarization.
* Token limits.
* Salon-level AI budgets.
* Usage monitoring.
* Automatic budget alerts.
* Configurable AI fallback.
* Optional local LLM integration where operationally suitable.

Track actual AI usage and associated costs.
Do not make paid LLM calls for simple booking status retrieval, queue notifications or static FAQs when deterministic logic is sufficient.
26. UI/UX requirements
Maintain FastQue's existing colors and visual identity.
Create:

* Modern WhatsApp-inspired conversational experience without copying proprietary assets.
* Professional three-panel desktop salon inbox.
* Mobile-first customer messaging interface.
* Floating chat access button where appropriate.
* Real-time booking information cards.
* Interactive quotation cards.
* Quick-reply chips.
* AI suggestion panel.
* Booking confirmation controls.
* Voice message player.
* Attachment previews.
* Searchable conversation history.
* Dark mode if supported by the current application.
* Accessible design.
* Loading states.
* Empty states.
* Offline states.
* Error handling and message retry controls.

The interface should be simple enough for a small Indian salon owner with limited technical experience.
27. Subscription and monetization readiness
Make the communication system compatible with future FastQue subscription plans.
Provide configurable feature entitlements.
Basic: Real-time communication, booking updates and limited attachment support.
Professional: AI suggested replies, smart translation, advanced templates, automated reminders and analytics.
Premium: Automatic AI reception, advanced customer retention, sentiment analysis, smart quotations and advanced CRM integration.
Do not hardcode prices or activate charges without admin configuration.
28. Testing and acceptance criteria
Create comprehensive tests for:

* Customer-to-salon messaging.
* Salon-to-customer messaging.
* Multiple employee access.
* Real-time message delivery.
* Offline reconnection.
* Message delivery failures.
* Duplicate message prevention.
* Media uploads.
* Booking modification workflows.
* Unauthorized conversation access.
* Cross-salon data isolation.
* AI hallucination prevention controls.
* Prompt injection resistance.
* Human escalation.
* Multilingual communication.
* Notification delivery.
* Complaint management.
* AI cost tracking.
* High-volume concurrent messaging.

Test using representative data for multiple customers, salons, stylists and bookings.
Provide unit, integration, end-to-end and security tests.
29. Implementation strategy
Implement incrementally using feature flags.
Phase 1: Core real-time messaging, booking integration, secure attachments, salon inbox and notifications.
Phase 2: Smart booking actions, live queue communication, AI suggested replies and multilingual support.
Phase 3: Customized quotations, customer retention, complaint management and communication analytics.
Phase 4: Advanced Agentic AI automation, CRM intelligence, home service communication and monetization controls.
Before making changes, document the existing architecture and implementation plan.
Use a dedicated feature branch named `feature/fastque-connect`, following existing repository conventions.
Do not modify production data or deploy to production without authorization.
30. Expected deliverables
Deliver a fully functional implementation, not just static UI screens.
Provide:

* Working customer messaging interface.
* Working salon communication dashboard.
* Admin communication management dashboard.
* Backend APIs.
* Real-time messaging infrastructure.
* Database migrations.
* Booking and queue integrations.
* AI orchestration layer.
* Security and permission controls.
* Notification system.
* Communication analytics.
* Automated tests.
* Environment configuration documentation.
* API documentation.
* Estimated infrastructure and AI operating costs.
* Deployment and rollback instructions.

Clearly document completed features, pending features, architectural decisions, assumptions, external service requirements and known limitations.
Think like the CTO of FastQue and build a communication ecosystem that can eventually support 100,000 salons and millions of customers without requiring a complete architectural redesign.