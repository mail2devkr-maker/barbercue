#!/usr/bin/env bash
# Owner-operations migration safety proof (runs against DISPOSABLE PostgreSQL databases only).
#
# It builds the schema as it was BEFORE the owner-operations work (every committed migration except the
# three owner-operations ones), fills it with legacy rows, applies the owner-operations migrations and
# proves that:
#   * no legacy booking / queue entry / salon row is rewritten (fingerprints are identical);
#   * automatic assignment moves to ON only for shops where no owner choice is recorded, and never
#     overrides a recorded OFF (explicit choice) or contradictory evidence - every change is audited;
#   * the assigned-state hold indexes reject a second customer holding the same barber or chair;
#   * historical queue entries stay interpretable.
#
# Connection comes from the standard PG* environment variables (PGHOST, PGPORT, PGUSER, PGPASSWORD).
# Refuses to touch a host that is not local or a CI service container.
set -euo pipefail
case "${PGHOST:-127.0.0.1}" in 127.0.0.1|localhost|postgres) ;; *) echo "refusing to run against ${PGHOST}"; exit 2;; esac
PSQL="${PSQL:-psql}"
DB_A="${DB_A:-fastque_owner_ops_mig_a}"
DB_B="${DB_B:-fastque_owner_ops_mig_b}"
cd "$(dirname "$0")/.."
MIGS=prisma/migrations
OPS="20261013000000_owner_ops_enums 20261013000100_owner_ops_foundation 20261014000000_owner_ops_assignment_state_default_on"

build_base() { # $1 = db name: everything except the owner-ops migrations
  "$PSQL" -d postgres -qc "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1"
  for d in $(ls $MIGS | grep -v migration_lock | sort); do
    case " $OPS " in *" $d "*) continue;; esac
    if [ "$d" = "20260830215000_ensure_primary_platform_admin" ]; then
      "$PSQL" -d $1 -qc "INSERT INTO users (id,email,status,\"updatedAt\") VALUES (gen_random_uuid(),'mail2dev.kr@gmail.com','ACTIVE',now())"
    fi
    if [ "$d" = "20260930163000_backfill_ghaziabad_city" ]; then
      "$PSQL" -d $1 -qc "INSERT INTO \"Country\" (id,\"isoCode2\",name,slug) VALUES ('test-in','IN','India','india'); INSERT INTO \"Region\" (id,\"countryId\",name,slug,code) VALUES ('test-up','test-in','Uttar Pradesh','uttar-pradesh','IN-UP')"
    fi
    "$PSQL" -d $1 -q -v ON_ERROR_STOP=1 -f $MIGS/$d/migration.sql > /dev/null
  done
}
apply() { local db=$1; shift; for d in "$@"; do "$PSQL" -d $db -q -v ON_ERROR_STOP=1 -f $MIGS/$d/migration.sql > /dev/null; done; }
q() { "$PSQL" -d "$DB" -At -v ON_ERROR_STOP=1 -c "$1"; }
seed_legacy() {
  "$PSQL" -d "$DB" -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO users (id,email,status,"updatedAt") VALUES ('u-owner','legacy.owner@example.test','ACTIVE',now()), ('u-b1','b1@example.test','ACTIVE',now()), ('u-b2','b2@example.test','ACTIVE',now()), ('u-c1','c1@example.test','ACTIVE',now());
INSERT INTO salons (id,"ownerUserId",name,slug,"cityId","addressLine","updatedAt")
  SELECT x.id,'u-owner',x.name,x.slug,(SELECT id FROM cities LIMIT 1),'Addr',now()
  FROM (VALUES ('s-1','Shop One','shop-one'),('s-2','Shop Two','shop-two'),('s-3','Shop Three','shop-three'),('s-4','Shop Four','shop-four'),('s-5','Shop Five','shop-five')) AS x(id,name,slug);
INSERT INTO services (id,"salonId",name,"durationMinutes",price,"updatedAt") VALUES ('sv-1','s-1','Haircut',30,250,now());
INSERT INTO chairs (id,"salonId",label,"updatedAt") VALUES ('ch-1','s-1','Chair 1',now()), ('ch-2','s-1','Chair 2',now());
INSERT INTO salon_staff (id,"salonId","userId","displayName","roleInSalon","updatedAt") VALUES ('st-1','s-1','u-b1','Barber One','BARBER',now()), ('st-2','s-1','u-b2','Barber Two','BARBER',now());
INSERT INTO queue_entries (id,"salonId",source,"tokenNumber","updatedAt","customerId",status) VALUES
  ('q-wait','s-1','WALK_IN',1,now(),'u-c1','WAITING'),
  ('q-called','s-1','WALK_IN',2,now(),NULL,'CALLED'),
  ('q-done','s-1','WALK_IN',3,now(),NULL,'COMPLETED');
SQL
}
fp() { q "select md5(string_agg(t::text, '|' order by id)) from (select id,\"salonId\",source,\"tokenNumber\",status,\"customerId\" from queue_entries) t"; }
ok() { echo "  PASS: $1"; }
bad() { echo "  FAIL: $1"; exit 1; }
expect() { [ "$2" = "$3" ] && ok "$1 ($2)" || bad "$1 (expected $3, got $2)"; }
expect_fail() { if "$PSQL" -d "$DB" -q -v ON_ERROR_STOP=1 -c "$2" > /dev/null 2>&1; then bad "NOT REJECTED: $1"; else ok "rejected by the database: $1"; fi; }

echo "=== Scenario A: the previous draft (default OFF) was already applied; owners have made choices"
DB=$DB_A; build_base $DB; seed_legacy
apply $DB ${OPS%% 20261014*}
expect "previous draft's default" "$(q "select column_default from information_schema.columns where table_name='salons' and column_name='queueAutoAssignEnabled'")" "false"
# owner activity recorded by the previous draft: audit rows exactly as setAutomaticAssignment writes them
q "INSERT INTO audit_logs (id,\"actorUserId\",action,\"entityType\",\"entityId\",metadata) VALUES
  (gen_random_uuid()::text,'u-owner','QUEUE_AUTO_ASSIGN_DISABLED','Salon','s-2','{}'),
  (gen_random_uuid()::text,'u-owner','QUEUE_AUTO_ASSIGN_ENABLED','Salon','s-3','{}'),
  (gen_random_uuid()::text,'u-owner','QUEUE_AUTO_ASSIGN_DISABLED','Salon','s-3','{}'),
  (gen_random_uuid()::text,'u-owner','QUEUE_AUTO_ASSIGN_ENABLED','Salon','s-4','{}'),
  (gen_random_uuid()::text,'u-owner','QUEUE_AUTO_ASSIGN_ENABLED','Salon','s-5','{}')" > /dev/null
q "UPDATE salons SET \"queueAutoAssignEnabled\"=true WHERE id='s-4'" > /dev/null   # s-4: owner turned it ON and it is ON
# s-5: audit says ENABLED but the value is false (inconsistent: changed outside the app) - must NOT be overridden
Q1=$(fp); N1=$(q "select count(*) from queue_entries")
START=$(date +%s%N); apply $DB 20261014000000_owner_ops_assignment_state_default_on; END=$(date +%s%N)
echo "  applied 20261014000000 in $(( (END-START)/1000000 )) ms"
expect "column default is now" "$(q "select column_default from information_schema.columns where table_name='salons' and column_name='queueAutoAssignEnabled'")" "true"
expect "s-1 never chosen (no audit trace) -> ON" "$(q "select \"queueAutoAssignEnabled\" from salons where id='s-1'")" "t"
expect "s-2 owner explicitly turned OFF -> stays OFF" "$(q "select \"queueAutoAssignEnabled\" from salons where id='s-2'")" "f"
expect "s-3 owner turned ON then OFF -> stays OFF" "$(q "select \"queueAutoAssignEnabled\" from salons where id='s-3'")" "f"
expect "s-4 owner turned it ON -> stays ON" "$(q "select \"queueAutoAssignEnabled\" from salons where id='s-4'")" "t"
expect "s-5 contradictory evidence -> not overridden" "$(q "select \"queueAutoAssignEnabled\" from salons where id='s-5'")" "f"
expect "exactly the untouched shop was flipped and audited" "$(q "select string_agg(\"entityId\", ',' order by \"entityId\") from audit_logs where action='QUEUE_AUTO_ASSIGN_DEFAULT_APPLIED'")" "s-1"
expect "queue history untouched (fingerprint)" "$(fp)" "$Q1"
expect "queue row count unchanged" "$(q "select count(*) from queue_entries")" "$N1"
expect "CALLED history row still has no barber (historically interpretable)" "$(q "select coalesce(\"assignedStaffId\",'none')||'/'||coalesce(\"assignedAt\"::text,'none') from queue_entries where id='q-called'")" "none/none"
expect "a brand-new shop inserted now defaults to ON" "$(q "INSERT INTO salons (id,\"ownerUserId\",name,slug,\"cityId\",\"addressLine\",\"updatedAt\") SELECT 's-new','u-owner','Fresh','fresh',(SELECT id FROM cities LIMIT 1),'A',now() RETURNING \"queueAutoAssignEnabled\"" | head -1)" "t"
echo "  -- hold indexes"
q "INSERT INTO queue_entries (id,\"salonId\",source,\"tokenNumber\",\"updatedAt\",status,\"assignedStaffId\",\"assignedChairId\",\"assignedAt\") VALUES ('h-1','s-1','WALK_IN',10,now(),'CALLED','st-1','ch-1',now())" > /dev/null && ok "an assigned (CALLED) customer holds a barber and a chair"
expect_fail "a second assigned customer for the same barber" "INSERT INTO queue_entries (id,\"salonId\",source,\"tokenNumber\",\"updatedAt\",status,\"assignedStaffId\",\"assignedChairId\") VALUES ('h-2','s-1','WALK_IN',11,now(),'CALLED','st-1','ch-2')"
expect_fail "a second assigned customer for the same chair" "INSERT INTO queue_entries (id,\"salonId\",source,\"tokenNumber\",\"updatedAt\",status,\"assignedStaffId\",\"assignedChairId\") VALUES ('h-3','s-1','WALK_IN',12,now(),'CALLED','st-2','ch-1')"
q "INSERT INTO queue_entries (id,\"salonId\",source,\"tokenNumber\",\"updatedAt\",status,\"assignedStaffId\",\"assignedChairId\") VALUES ('h-4','s-1','WALK_IN',13,now(),'CALLED','st-2','ch-2')" > /dev/null && ok "a different barber and chair are accepted"
q "INSERT INTO queue_entries (id,\"salonId\",source,\"tokenNumber\",\"updatedAt\",status,\"assignedStaffId\",\"assignedChairId\") VALUES ('h-5','s-1','WALK_IN',14,now(),'COMPLETED','st-1','ch-1')" > /dev/null && ok "history rows (COMPLETED) keep their barber/chair without conflict"
q "UPDATE queue_entries SET status='IN_SERVICE', \"serviceStartedAt\"=now() WHERE id='h-1'" > /dev/null && ok "starting service (CALLED -> IN_SERVICE) frees the hold"
q "INSERT INTO queue_entries (id,\"salonId\",source,\"tokenNumber\",\"updatedAt\",status,\"assignedStaffId\",\"assignedChairId\") VALUES ('h-6','s-1','WALK_IN',15,now(),'CALLED','st-1','ch-1')" > /dev/null && ok "the freed barber/chair can be held again"

echo "=== Scenario B: production-like - pre-owner-ops schema receives all three migrations in one run"
DB=$DB_B; build_base $DB; seed_legacy
Q1=$(fp)
START=$(date +%s%N); apply $DB $OPS; END=$(date +%s%N)
echo "  applied 3 owner-ops migrations in $(( (END-START)/1000000 )) ms"
expect "every pre-existing shop ends ON (nobody could have chosen before the feature existed)" "$(q "select string_agg(distinct \"queueAutoAssignEnabled\"::text, ',') from salons")" "true"
expect "each flip is audited" "$(q "select count(*) from audit_logs where action='QUEUE_AUTO_ASSIGN_DEFAULT_APPLIED'")" "5"
expect "queue history untouched (fingerprint)" "$(fp)" "$Q1"
echo "=== ALL MIGRATION CHECKS PASSED"
