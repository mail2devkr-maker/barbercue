-- Used only by verify-migration-chain.sh before the five platform migrations.
-- Explicitly synthetic, with no delivery/provider side effects.
INSERT INTO users (id,email,status,"updatedAt")
VALUES ('platform-legacy-customer','platform-legacy@example.test','ACTIVE',now());
INSERT INTO services (id,"salonId",name,"durationMinutes",price,"updatedAt")
VALUES ('platform-legacy-service','migration-photo-active','Synthetic legacy service',30,250,now());
INSERT INTO bookings (id,"salonId","customerId","serviceId","slotStart","slotEnd",status,source,"idempotencyKey","updatedAt")
VALUES ('platform-legacy-booking','migration-photo-active','platform-legacy-customer','platform-legacy-service',
        '2026-10-11T04:30:00Z','2026-10-11T05:00:00Z','COMPLETED','WEB','platform-legacy-booking',now());
-- The historical multi-service migration backfills this row from bookings and services.
INSERT INTO queue_entries (id,"salonId","customerId","serviceId",source,"tokenNumber",status,"updatedAt")
SELECT 'platform-legacy-queue-'||n,'migration-photo-active','platform-legacy-customer','platform-legacy-service',
       'WALK_IN',n,CASE WHEN n<=8 THEN 'COMPLETED'::"QueueEntryStatus" ELSE 'EXPIRED'::"QueueEntryStatus" END,now()
FROM generate_series(1,11) n;
INSERT INTO invoices (id,"salonId",sequence,number,"sourceType","bookingId","customerId",currency,subtotal,total,
                      "sellerLegalName","serviceDate","issuedByUserId")
SELECT 'platform-legacy-invoice','migration-photo-active',1,'SYNTHETIC-1','BOOKING','platform-legacy-booking',
       'platform-legacy-customer','INR',250,250,'Synthetic migration fixture','2026-10-11T04:30:00Z',"ownerUserId"
FROM salons WHERE id='migration-photo-active';
INSERT INTO invoice_lines (id,"invoiceId","serviceId",description,"unitPrice","lineTotal","sortOrder")
VALUES ('platform-legacy-line','platform-legacy-invoice','platform-legacy-service','Synthetic service',250,250,0);
INSERT INTO invoice_payments (id,"invoiceId","salonId",kind,method,amount,"recordedByUserId")
SELECT 'platform-legacy-payment','platform-legacy-invoice','migration-photo-active','PAYMENT','CASH',200,"ownerUserId"
FROM salons WHERE id='migration-photo-active';
