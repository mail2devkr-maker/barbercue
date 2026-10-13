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
echo "-- final stage: the full committed migrations directory"
npx prisma migrate deploy
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
if echo "$DRIFT" | grep -Eqi 'queueAutoAssignEnabled|assignedAt|showPhoneToCustomers|salon_billing_profiles|"invoices"|invoice_lines|"payments"|notification_deliver|accessRevoked|cancelledByActor|cancellationReason|guestName|guestPhone|guestContactConsent|queue_entries_assigned_|bookings_customer_or_in_shop|createdByUserId|preferredStaffId'; then
  echo "OWNER-OPERATIONS SCHEMA DRIFT DETECTED"; exit 1
fi
echo "no owner-operations drift"
