#!/usr/bin/env bash
# Synthetic CI data only. Uses the database container's matching pg_dump/pg_restore binaries.
# This is a PostgreSQL backup/restore drill, NOT Neon PITR or production recovery certification.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${PGHOST:-}" == 127.0.0.1 ]] || {
  echo 'Recovery rehearsal requires the disposable GitHub Actions database'; exit 2;
}
: "${PG_CONTAINER_ID:?The disposable PostgreSQL service container is required}"
[[ "$PG_CONTAINER_ID" =~ ^[a-f0-9]{12,64}$ ]] || exit 2
SOURCE_DB=owner_ops_chain
RESTORED_DB=platform_release_restored
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fingerprint() {
  psql -X -qAt -v ON_ERROR_STOP=1 -d "$1" <<'SQL'
SELECT format(
  'SELECT %L || ''|'' || count(*) || ''|'' || coalesce(md5(string_agg(md5(to_jsonb(t)::text), '''' ORDER BY md5(to_jsonb(t)::text))), md5('''')) FROM %I.%I t;',
  c.relname, n.nspname, c.relname
) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname
\gexec
SELECT format('SELECT %L || ''|'' || last_value || ''|'' || is_called FROM %I.%I;',
  c.relname,n.nspname,c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='S' ORDER BY c.relname
\gexec
SQL
}

fingerprint "$SOURCE_DB" > "$WORK/source.facts"
docker exec "$PG_CONTAINER_ID" pg_dump -U postgres -Fc "$SOURCE_DB" > "$WORK/archive.dump"
docker exec -i "$PG_CONTAINER_ID" pg_restore --list < "$WORK/archive.dump" > /dev/null
# Fail if this database already exists; never drop or replace an existing database.
psql -X -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $RESTORED_DB"
docker exec -i "$PG_CONTAINER_ID" pg_restore -U postgres --exit-on-error --single-transaction -d "$RESTORED_DB" < "$WORK/archive.dump"
fingerprint "$RESTORED_DB" > "$WORK/restored.facts"
diff -u "$WORK/source.facts" "$WORK/restored.facts"

for db in "$SOURCE_DB" "$RESTORED_DB"; do
  docker exec "$PG_CONTAINER_ID" pg_dump -U postgres --schema-only --no-owner --no-privileges "$db" |
    sed '/^\\restrict /d; /^\\unrestrict /d' > "$WORK/$db.schema"
done
diff -u "$WORK/$SOURCE_DB.schema" "$WORK/$RESTORED_DB.schema"

# Test the restored financial guards using existing synthetic E2E rows. Each rejected statement
# rolls back in a PL/pgSQL subtransaction; fail if the fixture is missing or mutation is accepted.
psql -X -v ON_ERROR_STOP=1 -d "$RESTORED_DB" <<'SQL'
DO $$
DECLARE payment_id text; invoice_id text;
BEGIN
  SELECT id, "invoiceId" INTO STRICT payment_id, invoice_id FROM invoice_payments LIMIT 1;
  BEGIN
    UPDATE invoice_payments SET amount=amount WHERE id=payment_id;
    RAISE EXCEPTION 'Restored ledger accepted UPDATE';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM invoice_payments WHERE id=payment_id;
    RAISE EXCEPTION 'Restored ledger accepted DELETE';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE invoices SET total=total+1 WHERE id=invoice_id;
    RAISE EXCEPTION 'Restored invoice accepted money mutation';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
  END;
END $$;
SQL
fingerprint "$RESTORED_DB" > "$WORK/after-guards.facts"
diff -u "$WORK/restored.facts" "$WORK/after-guards.facts"
echo "PASS: $(wc -l < "$WORK/source.facts") table/sequence fingerprints match; schema, indexes, constraints, triggers and financial guards verified"
echo "Synthetic archive SHA256: $(sha256sum "$WORK/archive.dump" | cut -d ' ' -f1)"
# The archive is deliberately not uploaded: authentication fixtures can contain token hashes.
