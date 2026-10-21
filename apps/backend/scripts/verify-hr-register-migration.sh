#!/usr/bin/env bash
# HR permanent employee-ID register migration rehearsal on a DISPOSABLE PostgreSQL database (issue #283).
#
# Builds a "production-shaped" pre-HR database (every committed migration BEFORE the HR migration, plus synthetic existing
# staff), applies the HR migration to it, and proves:
#   1. no existing employee_profiles / users row changed (fingerprints before == after);
#   2. every existing profile became exactly one register person with its ORIGINAL code (reserved block included),
#      an active login = ACTIVE episode, a suspended one = EXITED (never invented as "joined");
#   3. the migration adds no schema drift against schema.prisma (the drift report is identical before and after);
#   4. the integrity triggers exist.
#
#   PGHOST/PGPORT/PGUSER[/PGPASSWORD]  a disposable local server
#   HR_DB                              database name to (re)create, default fastque_hr_migration
#   BASE_SCHEMA                        path to the pre-HR schema.prisma (default: origin/master's, via git)
set -euo pipefail
cd "$(dirname "$0")/.."
HR_MIGRATION="20261022100000_hr_permanent_employee_register"
DB="${HR_DB:-fastque_hr_migration}"
case "$DB" in fastque_hr_*) ;; *) echo "refusing: database name must start with fastque_hr_"; exit 2;; esac
case "${PGHOST:-127.0.0.1}" in 127.0.0.1|localhost|postgres) ;; *) echo "refusing: PGHOST must be a local disposable server"; exit 2;; esac
PSQL="${PSQL:-psql}"

"$PSQL" -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
for d in $(ls prisma/migrations | grep -v migration_lock | sort); do
  if [ "$d" = "$HR_MIGRATION" ]; then break; fi
  if [ "$d" = "20260830215000_ensure_primary_platform_admin" ]; then
    "$PSQL" -X -d "$DB" -qc "INSERT INTO users (id,email,status,\"updatedAt\") VALUES (gen_random_uuid(),'mail2dev.kr@gmail.com','ACTIVE',now())"
  fi
  if [ "$d" = "20260930163000_backfill_ghaziabad_city" ]; then
    "$PSQL" -X -d "$DB" -qc "INSERT INTO \"Country\" (id,\"isoCode2\",name,slug) VALUES ('test-in','IN','India','india'); INSERT INTO \"Region\" (id,\"countryId\",name,slug,code) VALUES ('test-up','test-in','Uttar Pradesh','uttar-pradesh','IN-UP')"
  fi
  "$PSQL" -X -d "$DB" -q -v ON_ERROR_STOP=1 -f "prisma/migrations/$d/migration.sql" > /dev/null
done
echo "pre-HR database built: $("$PSQL" -X -d "$DB" -Atc "select count(*) from information_schema.tables where table_schema='public'") tables"
"$PSQL" -X -d "$DB" -q -v ON_ERROR_STOP=1 -f scripts/hr-register-seed-existing.sql

FINGERPRINT="select md5(coalesce(string_agg(t::text, '|' order by id), '')) from %s t"
before_profiles="$("$PSQL" -X -d "$DB" -Atc "$(printf "$FINGERPRINT" employee_profiles)")"
before_users="$("$PSQL" -X -d "$DB" -Atc "$(printf "$FINGERPRINT" users)")"

PLAIN_URL="postgresql://${PGUSER:-postgres}@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/$DB"
[ -n "${PGPASSWORD:-}" ] && PLAIN_URL="postgresql://${PGUSER}:$(python3 -c 'import sys,urllib.parse as u; print(u.quote(sys.argv[1], safe=""))' "$PGPASSWORD")@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/$DB"
SCHEMA_URL="$PLAIN_URL?schema=public&sslmode=disable"
export DATABASE_URL="$SCHEMA_URL" DIRECT_DATABASE_URL="$SCHEMA_URL"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if [ -n "${BASE_SCHEMA:-}" ]; then cp "$BASE_SCHEMA" "$TMP/base.prisma"; else git show origin/master:apps/backend/prisma/schema.prisma > "$TMP/base.prisma"; fi
npx prisma migrate diff --from-url "$SCHEMA_URL" --to-schema-datamodel "$TMP/base.prisma" --script > "$TMP/drift-before.sql"

echo "== applying $HR_MIGRATION to the pre-HR database"
start="$(date +%s%N)"
"$PSQL" -X -d "$DB" -q -v ON_ERROR_STOP=1 -f "prisma/migrations/$HR_MIGRATION/migration.sql" > /dev/null
echo "applied in $(( ($(date +%s%N) - start) / 1000000 )) ms"

after_profiles="$("$PSQL" -X -d "$DB" -Atc "$(printf "$FINGERPRINT" employee_profiles)")"
after_users="$("$PSQL" -X -d "$DB" -Atc "$(printf "$FINGERPRINT" users)")"
[ "$before_profiles" = "$after_profiles" ] || { echo "FAIL: employee_profiles changed"; exit 1; }
[ "$before_users" = "$after_users" ] || { echo "FAIL: users changed"; exit 1; }
echo "existing employee_profiles and users unchanged (fingerprints identical)"

expect() { # $1 = description, $2 = sql returning 't'
  [ "$("$PSQL" -X -d "$DB" -Atc "$2")" = "t" ] || { echo "FAIL: $1"; exit 1; }
  echo "ok: $1"
}
expect "three existing staff became three register persons" "select count(*) = 3 from hr_persons where origin = 'EXISTING_PROFILE'"
expect "original codes preserved incl. the reserved block" "select array_agg(\"employeeCode\" order by \"employeeCode\") = array['FQ-FE-00007','FQ-FE-00101','FQ-FE-00102'] from hr_persons"
expect "every person is linked to its own profile" "select count(*) = 0 from hr_persons p left join employee_profiles ep on ep.id = p.\"employeeProfileId\" and ep.\"employeeCode\" = p.\"employeeCode\" where ep.id is null"
expect "active logins are ACTIVE, the suspended one is EXITED (never invented as joined)" "select count(*) filter (where status='ACTIVE') = 2 and count(*) filter (where status='EXITED') = 1 from hr_employment_episodes"
expect "no offer was fabricated for staff hired before the register" "select count(*) = 0 from hr_offer_versions"
expect "integrity triggers are installed" "select count(*) >= 12 from pg_trigger where tgname like 'hr\\_%' or tgname like 'employee_profiles_hr_%'"

npx prisma migrate diff --from-url "$SCHEMA_URL" --to-schema-datamodel prisma/schema.prisma --script > "$TMP/drift-after.sql"
if diff -q "$TMP/drift-before.sql" "$TMP/drift-after.sql" > /dev/null; then
  echo "ok: the HR migration adds no schema drift (report identical before and after: $(grep -c '^-- ' "$TMP/drift-after.sql") pre-existing items)"
else
  echo "FAIL: schema drift changed"; diff "$TMP/drift-before.sql" "$TMP/drift-after.sql" || true; exit 1
fi
echo "HR migration rehearsal PASSED on $DB"
