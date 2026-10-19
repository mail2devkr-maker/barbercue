#!/usr/bin/env bash
# Full committed migration chain on a DISPOSABLE PostgreSQL database: validate the schema, apply every
# migration with `prisma migrate deploy`, confirm Prisma considers the database up to date, verify the
# migration checksums, and prove the owner-operations schema has no drift against schema.prisma.
#
#   DATABASE_URL  the database to deploy into (must be empty and disposable)
#
# Two committed migrations assume rows that exist in a real database but not in an empty one (this is
# true on master, independent of the owner-operations work):
#   20260830215000_ensure_primary_platform_admin  needs the platform admin's user row
#   20260930163000_backfill_ghaziabad_city        needs the India country and the Uttar Pradesh region
# `prisma migrate deploy` cannot pause between migrations, so the chain is applied in stages with the
# same prerequisite rows inserted in between; the final stage runs the real, full migrations directory,
# so Prisma's own bookkeeping and checksums cover the whole chain.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL (a disposable database) is required}"
case "$DATABASE_URL" in *@127.0.0.1*|*@localhost*|*@postgres*) ;; *) echo "refusing to deploy migrations to a non-local database"; exit 2;; esac
PSQL="${PSQL:-psql}"
PLAIN_URL="${DATABASE_URL%%\?*}"   # psql does not understand Prisma's ?schema= parameter
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

stage() { # $1 = apply only migrations that sort BEFORE this name
  rm -rf "$STAGING/prisma"; mkdir -p "$STAGING/prisma/migrations"
  cp prisma/schema.prisma "$STAGING/prisma/schema.prisma"
  cp prisma/migrations/migration_lock.toml "$STAGING/prisma/migrations/"
  for d in prisma/migrations/*/; do
    n="$(basename "$d")"
    if [[ "$n" < "$1" ]]; then cp -r "$d" "$STAGING/prisma/migrations/$n"; fi
  done
  echo "-- stage: migrations before $1"
  npx prisma migrate deploy --schema "$STAGING/prisma/schema.prisma"
}

echo "== prisma validate"
npx prisma validate
echo "== prisma migrate deploy, in stages (prerequisite rows inserted between them)"
stage "20260830215000_ensure_primary_platform_admin"
"$PSQL" "$PLAIN_URL" -v ON_ERROR_STOP=1 -qc "INSERT INTO users (id,email,status,\"updatedAt\") VALUES (gen_random_uuid(),'mail2dev.kr@gmail.com','ACTIVE',now())"
stage "20260930163000_backfill_ghaziabad_city"
"$PSQL" "$PLAIN_URL" -v ON_ERROR_STOP=1 -qc "INSERT INTO \"Country\" (id,\"isoCode2\",name,slug) VALUES ('test-in','IN','India','india'); INSERT INTO \"Region\" (id,\"countryId\",name,slug,code) VALUES ('test-up','test-in','Uttar Pradesh','uttar-pradesh','IN-UP')"
echo "== prepare synthetic legacy data before the platform feature migrations"
stage "20261017010000_booking_attribution_campaigns"
"$PSQL" "$PLAIN_URL" -v ON_ERROR_STOP=1 -qc "INSERT INTO salons (id,\"ownerUserId\",name,slug,\"cityId\",\"addressLine\",status,\"updatedAt\") SELECT fixture.id,owner.id,fixture.name,fixture.slug,c.id,'Migration fixture',fixture.status,now() FROM (VALUES ('migration-photo-active','Migration Active','migration-photo-active','ACTIVE'::\"SalonStatus\"),('migration-photo-suspended','Migration Suspended','migration-photo-suspended','SUSPENDED'::\"SalonStatus\"),('migration-photo-pending','Migration Pending','migration-photo-pending','PENDING'::\"SalonStatus\")) AS fixture(id,name,slug,status) CROSS JOIN LATERAL (SELECT id FROM users WHERE email='mail2dev.kr@gmail.com' ORDER BY id LIMIT 1) owner CROSS JOIN LATERAL (SELECT id FROM cities ORDER BY id LIMIT 1) c"
"$PSQL" "$PLAIN_URL" -X -v ON_ERROR_STOP=1 -f scripts/platform-legacy-fixture.sql
# Rehearse the taxonomy migration against populated pre-migration service rows. The two labels
# intentionally differ only by surrounding spaces/case: one canonical node should be reused while
# every historical text label and booking/queue/invoice reference remains untouched.
stage "20261019130000_service_category_tree"
"$PSQL" "$PLAIN_URL" -v ON_ERROR_STOP=1 -qc "UPDATE services SET category='Hair', subcategory='Cut' WHERE id='platform-legacy-service'; INSERT INTO services (id,\"salonId\",name,\"durationMinutes\",price,category,subcategory,\"updatedAt\") VALUES ('platform-legacy-service-2','migration-photo-active','Synthetic second legacy service',25,175,' hair ',' cut ',now())"
# Remember every original column of every existing table. Additive columns and new tables must
# not change a single existing value. Migration bookkeeping is expected to change and excluded.
"$PSQL" "$PLAIN_URL" -X -qAt -v ON_ERROR_STOP=1 > "$STAGING/legacy-fingerprints.sql" <<'SQL'
SELECT format(
  'SELECT %L || ''|'' || count(*) || ''|'' || coalesce(md5(string_agg(md5(to_jsonb(t)::text), '''' ORDER BY md5(to_jsonb(t)::text))), md5('''')) FROM (SELECT %s FROM %I.%I) t;',
  table_name, string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position), table_schema, table_name
)
FROM information_schema.columns
WHERE table_schema='public' AND table_name<>'_prisma_migrations'
  AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname='public')
GROUP BY table_schema,table_name ORDER BY table_name;
SQL
"$PSQL" "$PLAIN_URL" -X -qAt -v ON_ERROR_STOP=1 -f "$STAGING/legacy-fingerprints.sql" > "$STAGING/before.facts"
echo "-- final stage: the full committed migrations directory"
START_NS=$(date +%s%N)
npx prisma migrate deploy
echo "All pending migrations applied in $(( ($(date +%s%N)-START_NS)/1000000 )) ms (includes Prisma startup)"
"$PSQL" "$PLAIN_URL" -X -qAt -v ON_ERROR_STOP=1 -f "$STAGING/legacy-fingerprints.sql" > "$STAGING/after.facts"
diff -u "$STAGING/before.facts" "$STAGING/after.facts"
echo "PASS: $(wc -l < "$STAGING/before.facts") historical table fingerprints unchanged across platform migrations"
TAXONOMY_IDS="$("$PSQL" "$PLAIN_URL" -At -v ON_ERROR_STOP=1 -c "SELECT count(DISTINCT \"categoryId\" || ':' || \"subcategoryId\") FROM services WHERE id IN ('platform-legacy-service','platform-legacy-service-2') AND \"categoryId\" IS NOT NULL AND \"subcategoryId\" IS NOT NULL")"
if [[ "$TAXONOMY_IDS" != "1" ]]; then echo "legacy services did not converge on the same canonical taxonomy IDs"; exit 1; fi
echo "PASS: case/space-equivalent legacy labels resolve to one stable salon-scoped category/subcategory pair"
TAXONOMY_LABELS="$("$PSQL" "$PLAIN_URL" -At -v ON_ERROR_STOP=1 -c "SELECT string_agg(category || '/' || subcategory, '|' ORDER BY id) FROM services WHERE id IN ('platform-legacy-service','platform-legacy-service-2')")"
if [[ "$TAXONOMY_LABELS" != "Hair/Cut| hair / cut " ]]; then echo "legacy free-text labels changed during taxonomy backfill: $TAXONOMY_LABELS"; exit 1; fi
echo "PASS: original legacy category/subcategory labels remain byte-for-byte unchanged"
PHOTO_FLAGS="$("$PSQL" "$PLAIN_URL" -At -v ON_ERROR_STOP=1 -c "SELECT string_agg(id||':'||coalesce(\"shopPhotoRequirementGrandfathered\"::text,'NULL'), ',' ORDER BY id) FROM salons WHERE id LIKE 'migration-photo-%'")"
if [[ "$PHOTO_FLAGS" != "migration-photo-active:NULL,migration-photo-pending:NULL,migration-photo-suspended:NULL" ]]; then
  echo "photo grandfather marker migration unexpectedly rewrote legacy rows: $PHOTO_FLAGS"; exit 1
fi
echo "photo grandfather marker migration preserved NULL legacy markers for ACTIVE/SUSPENDED/PENDING fixtures"
echo "== prisma migrate status"
npx prisma migrate status
echo "== migration checksums"
node scripts/verify-migration-checksums.js
echo "== schema drift (the database the migrations built vs schema.prisma)"
# Diffing the database we just built (rather than replaying migrations on a shadow database, which would
# hit the same prerequisite rows) shows exactly what the committed migrations produce.
DRIFT="$(npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script)"
echo "$DRIFT" | sed 's/^/   /'
# Items that already differ on master are reported, but nothing owner-operations may differ.
if echo "$DRIFT" | grep -Eqi 'queueAutoAssignEnabled|assignedAt|showPhoneToCustomers|shopPhotoRequirementGrandfathered|salon_billing_profiles|"invoices"|invoice_lines|"payments"|notification_deliver|accessRevoked|cancelledByActor|cancellationReason|guestName|guestPhone|guestContactConsent|queue_entries_assigned_|bookings_customer_or_in_shop|createdByUserId|preferredStaffId'; then
  echo "OWNER-OPERATIONS SCHEMA DRIFT DETECTED"; exit 1
fi
echo "no owner-operations drift"
if echo "$DRIFT" | grep -Eqi 'salon_location_proposals|SalonLocationProposal'; then
  echo "SALON-LOCATION-VERIFICATION SCHEMA DRIFT DETECTED"; exit 1
fi
echo "no salon-location-verification drift"
if echo "$DRIFT" | grep -Eqi 'inventory_|Inventory|owner_demo_|OwnerDemo|booking_attribution_campaigns|attributionCampaignId|BookingAttributionCampaign|subcategory|service_categories|service_subcategories|categoryId'; then
  echo "PLATFORM OR SERVICE-TAXONOMY SCHEMA DRIFT DETECTED"; exit 1
fi
echo "no inventory, demo-workspace, attribution or service-taxonomy drift"
