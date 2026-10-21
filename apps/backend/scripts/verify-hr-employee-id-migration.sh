#!/usr/bin/env bash
# Populated pre-HR -> HR migration preservation rehearsal. Runs only on a disposable local PostgreSQL
# service/container. Creates and drops its own uniquely named database; it never targets the supplied
# DATABASE_URL database itself.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL must identify a disposable local PostgreSQL instance}"
case "$DATABASE_URL" in *@127.0.0.1*|*@localhost*|*@postgres*) ;; *) echo "refusing a non-local DATABASE_URL"; exit 2;; esac
case "${PGHOST:-127.0.0.1}" in 127.0.0.1|localhost|postgres) ;; *) echo "refusing a non-local PGHOST"; exit 2;; esac

PSQL="${PSQL:-psql}"
DB="fastque_hr_backfill_${RANDOM}_$$"
STAGING="$(mktemp -d)"
BASE_URL="${DATABASE_URL%%\?*}"
QUERY_SUFFIX=""
if [[ "$DATABASE_URL" == *\?* ]]; then QUERY_SUFFIX="?${DATABASE_URL#*\?}"; fi
export DATABASE_URL="${BASE_URL%/*}/${DB}${QUERY_SUFFIX}"
PLAIN_URL="${DATABASE_URL%%\?*}"
DB_CREATED=0

cleanup() {
  if [ "$DB_CREATED" = 1 ]; then
    "$PSQL" "${BASE_URL%/*}/postgres" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
  rm -rf "$STAGING"
}
trap cleanup EXIT

stage_before() {
  local stop_before="$1"
  rm -rf "$STAGING/prisma"
  mkdir -p "$STAGING/prisma/migrations"
  cp prisma/schema.prisma "$STAGING/prisma/schema.prisma"
  cp prisma/migrations/migration_lock.toml "$STAGING/prisma/migrations/"
  for dir in prisma/migrations/*/; do
    local name
    name="$(basename "$dir")"
    if [[ "$name" < "$stop_before" ]]; then cp -r "$dir" "$STAGING/prisma/migrations/$name"; fi
  done
  npx prisma migrate deploy --schema "$STAGING/prisma/schema.prisma"
}

echo "== create isolated HR backfill database: $DB"
"$PSQL" "${BASE_URL%/*}/postgres" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$DB\""
DB_CREATED=1
echo "== apply current migration history up to (but excluding) the HR registry migration"
stage_before "20260830215000_ensure_primary_platform_admin"
"$PSQL" "$PLAIN_URL" -v ON_ERROR_STOP=1 -qc "INSERT INTO users (id,email,status,\"updatedAt\") VALUES ('hr-legacy-admin','mail2dev.kr@gmail.com','ACTIVE',now())"
stage_before "20260930163000_backfill_ghaziabad_city"
"$PSQL" "$PLAIN_URL" -v ON_ERROR_STOP=1 -qc "INSERT INTO \"Country\" (id,\"isoCode2\",name,slug) VALUES ('hr-test-in','IN','India','india'); INSERT INTO \"Region\" (id,\"countryId\",name,slug,code) VALUES ('hr-test-up','hr-test-in','Uttar Pradesh','uttar-pradesh','IN-UP')"
stage_before "20261022120000_hr_employee_identity_registry"

echo "== seed one synthetic legacy employee profile before HR migration"
"$PSQL" "$PLAIN_URL" -v ON_ERROR_STOP=1 -qc "INSERT INTO users (id,email,status,\"updatedAt\") VALUES ('hr-backfill-user','hr-backfill@example.test','ACTIVE',now()); INSERT INTO employee_profiles (id,\"userId\",\"employeeCode\",\"fullName\",\"joinedAt\",\"createdAt\",\"updatedAt\") VALUES ('hr-backfill-profile','hr-backfill-user','FQ-FE-00427','Synthetic Legacy Employee','2025-01-02T00:00:00Z',now(),now())"
BEFORE_USERS="$("$PSQL" "$PLAIN_URL" -Atqc 'SELECT count(*) FROM users')"
BEFORE_PROFILES="$("$PSQL" "$PLAIN_URL" -Atqc 'SELECT count(*) FROM employee_profiles')"

echo "== apply only the real pending HR migration with Prisma bookkeeping"
npx prisma migrate deploy

expect() { [ "$2" = "$3" ] && echo "  PASS: $1" || { echo "  FAIL: $1 (expected $3, got $2)"; exit 1; }; }
expect "legacy users preserved" "$("$PSQL" "$PLAIN_URL" -Atqc 'SELECT count(*) FROM users')" "$BEFORE_USERS"
expect "legacy employee profiles preserved" "$("$PSQL" "$PLAIN_URL" -Atqc 'SELECT count(*) FROM employee_profiles')" "$BEFORE_PROFILES"
expect "the old employee code is preserved and linked once" "$("$PSQL" "$PLAIN_URL" -Atqc "SELECT count(*) FROM employee_profiles p JOIN employee_identities i ON i.id=p.\"employeeIdentityId\" WHERE p.id='hr-backfill-profile' AND p.\"employeeCode\"='FQ-FE-00427' AND i.\"employeeCode\"='FQ-FE-00427'")" "1"
expect "legacy verification remains pending, not inferred from profile data" "$("$PSQL" "$PLAIN_URL" -Atqc "SELECT \"verificationStatus\" FROM employee_identities WHERE \"employeeCode\"='FQ-FE-00427'")" "NEEDS_REVIEW"
expect "legacy employment history requires explicit HR reconciliation" "$("$PSQL" "$PLAIN_URL" -Atqc "SELECT \"historyStatus\" FROM employee_identities WHERE \"employeeCode\"='FQ-FE-00427'")" "NEEDS_REVIEW"
expect "legacy episode retained for review" "$("$PSQL" "$PLAIN_URL" -Atqc "SELECT count(*) FROM employee_employment_episodes WHERE \"identityId\"=(SELECT id FROM employee_identities WHERE \"employeeCode\"='FQ-FE-00427')")" "1"
expect "allocator continues above the existing maximum" "$("$PSQL" "$PLAIN_URL" -Atqc "SELECT nextval('employee_code_sequence')")" "428"
expect "code namespace triggers exist" "$("$PSQL" "$PLAIN_URL" -Atqc "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('employee_identities_code_guard','employee_profiles_code_guard')")" "2"
if "$PSQL" "$PLAIN_URL" -v ON_ERROR_STOP=1 -qc "UPDATE employee_identities SET \"employeeCode\"='FQ-FE-00428' WHERE \"employeeCode\"='FQ-FE-00427'" >/dev/null 2>&1; then
  echo "  FAIL: an existing employee code was mutable"; exit 1
else
  echo "  PASS: database rejects employee code reassignment"
fi
echo "== populated HR migration preservation rehearsal passed"
